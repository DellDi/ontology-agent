package com.dip3.ontologyagent.semantic.internal.adapter.out.cube;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/**
 * Cube REST 适配器：以短时 JWT 携带冻结版本与授权范围（由 cube.js queryRewrite 强制注入），
 * 处理 Continue wait 轮询，把 queryRewrite 的 SEMANTIC_* 拒绝码原样上抛（fail loud），
 * 并在未指定 Top N 时把达到行数上限视为截断失败。
 */
@Component
public final class CubeSemanticQueryAdapter implements SemanticQueryPort {
  private static final Pattern SEMANTIC_CODE = Pattern.compile("(SEMANTIC_[A-Z_]+):\\s*(.*)", Pattern.DOTALL);
  private static final Duration TOKEN_TTL = Duration.ofMinutes(5);
  private static final Duration POLL_INTERVAL = Duration.ofMillis(300);
  private static final int ERROR_TEXT_LIMIT = 300;

  private final JsonCodec json;
  private final RestClient http;
  private final String apiUrl;
  private final String secret;
  private final Duration timeout;

  public CubeSemanticQueryAdapter(JsonCodec json, BackendProperties properties) {
    this.json = json;
    var config = properties.cube();
    var requestFactory = new SimpleClientHttpRequestFactory();
    requestFactory.setConnectTimeout(config.timeout());
    requestFactory.setReadTimeout(config.timeout());
    this.http = RestClient.builder().requestFactory(requestFactory).build();
    this.apiUrl = config.apiUrl().replaceAll("/+$", "");
    this.secret = config.apiSecret();
    this.timeout = config.timeout();
  }

  @Override
  public SemanticQueryResult execute(CompiledSemanticQuery query, AccessContext access) {
    String token = token(access);
    boolean compare = query.compareRange() != null;
    Map<String, Object> response = post("/load", query.cubeQuery(), token, compare);
    List<Map<String, Object>> rows;
    List<Map<String, Object>> compareRows = List.of();
    if (compare) {
      Object results = response.get("results");
      if (!(results instanceof List<?> list) || list.size() != 2) {
        throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎对比查询未返回两个区间的结果。");
      }
      rows = rows(query, data(list.get(0)));
      compareRows = rows(query, data(list.get(1)));
    } else {
      rows = rows(query, data(response));
    }
    if (query.intent().limit() == null
        && (rows.size() >= SemanticQueryCompiler.ROW_CAP || compareRows.size() >= SemanticQueryCompiler.ROW_CAP)) {
      throw new BackendException("SEMANTIC_RESULT_TRUNCATED",
          "语义查询达到 " + SemanticQueryCompiler.ROW_CAP + " 行上限，禁止基于截断结果回答。");
    }
    return new SemanticQueryResult(rows, compareRows, sql(query, token));
  }

  @Override
  public DataCoverage coverage(CompiledSemanticQuery query, AccessContext access) {
    CompiledSemanticQuery.CoverageProbe probe = query.coverage();
    Map<String, Object> cubeQuery = Map.of(
        "measures", List.of(probe.fromMember(), probe.toMember()), "timezone", query.zone().getId());
    List<Map<String, Object>> data = data(post("/load", cubeQuery, token(access), false));
    if (data.size() != 1) {
      throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎覆盖区间查询应返回一行。");
    }
    Object from = data.getFirst().get(probe.fromMember());
    Object to = data.getFirst().get(probe.toMember());
    if (from == null || to == null) return new DataCoverage(null, null);
    return new DataCoverage(date(from, query), date(to, query));
  }

  private LocalDate date(Object epochSeconds, CompiledSemanticQuery query) {
    try {
      double seconds = new BigDecimal(epochSeconds.toString()).doubleValue();
      return Instant.ofEpochMilli((long) Math.floor(seconds * 1000)).atZone(query.zone()).toLocalDate();
    } catch (NumberFormatException error) {
      throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎覆盖区间返回了非数值结果。", error);
    }
  }

  private String sql(CompiledSemanticQuery query, String token) {
    Map<String, Object> cubeQuery = query.cubeQuery();
    if (query.compareRange() != null) {
      Map<String, Object> primary = new LinkedHashMap<>(cubeQuery);
      Map<String, Object> time = new LinkedHashMap<>(timeDimension(cubeQuery));
      time.remove("compareDateRange");
      time.put("dateRange", List.of(query.range().from().toString(), query.range().to().toString()));
      primary.put("timeDimensions", List.of(time));
      cubeQuery = primary;
    }
    Map<String, Object> response = post("/sql", cubeQuery, token, false);
    if (response.get("sql") instanceof Map<?, ?> sql && sql.get("sql") instanceof List<?> parts && !parts.isEmpty()) {
      return parts.size() > 1 ? parts.get(0) + "\n-- params: " + json.write(parts.get(1)) : String.valueOf(parts.get(0));
    }
    throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎未返回生成 SQL。");
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> timeDimension(Map<String, Object> cubeQuery) {
    return ((List<Map<String, Object>>) cubeQuery.get("timeDimensions")).getFirst();
  }

  private Map<String, Object> post(String path, Map<String, Object> cubeQuery, String token, boolean multi) {
    Instant deadline = Instant.now().plus(timeout);
    Map<String, Object> request = multi ? Map.of("query", cubeQuery, "queryType", "multi") : Map.of("query", cubeQuery);
    while (true) {
      String body;
      try {
        body = http.post().uri(apiUrl + path).contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", token).body(request).retrieve().body(String.class);
      } catch (RestClientResponseException error) {
        throw rejected(error.getStatusCode().value(), error.getResponseBodyAsString(StandardCharsets.UTF_8), error);
      } catch (RestClientException error) {
        throw new BackendException("SEMANTIC_ENGINE_UNAVAILABLE", "语义查询引擎不可用（" + apiUrl + "）。", error);
      }
      if (body == null || body.isBlank()) {
        throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎返回空响应。");
      }
      Map<String, Object> response = json.map(body);
      if (!"Continue wait".equals(response.get("error"))) {
        if (response.get("error") != null) throw rejected(200, body, null);
        return response;
      }
      if (Instant.now().isAfter(deadline)) {
        throw new BackendException("SEMANTIC_QUERY_TIMEOUT", "语义查询超过 " + timeout.toMillis() + "ms 仍未完成。");
      }
      try {
        Thread.sleep(POLL_INTERVAL.toMillis());
      } catch (InterruptedException interrupted) {
        Thread.currentThread().interrupt();
        throw new BackendException("SEMANTIC_QUERY_INTERRUPTED", "语义查询等待被中断。", interrupted);
      }
    }
  }

  private BackendException rejected(int status, String body, Throwable cause) {
    String message = body;
    try {
      Object error = json.map(body).get("error");
      if (error != null) message = error.toString();
    } catch (RuntimeException ignored) {
      // 非 JSON 错误体：保留原文诊断
    }
    Matcher matcher = SEMANTIC_CODE.matcher(message == null ? "" : message);
    if (matcher.find()) {
      return new BackendException(matcher.group(1), "语义查询被拒绝：" + truncate(matcher.group(2)), cause);
    }
    return new BackendException("SEMANTIC_QUERY_FAILED",
        "语义查询失败（HTTP " + status + "）：" + truncate(message), cause);
  }

  private static String truncate(String text) {
    if (text == null) return "";
    String trimmed = text.strip();
    return trimmed.length() <= ERROR_TEXT_LIMIT ? trimmed : trimmed.substring(0, ERROR_TEXT_LIMIT) + "…";
  }

  private static List<Map<String, Object>> data(Object response) {
    if (!(response instanceof Map<?, ?> map) || !(map.get("data") instanceof List<?> list)) {
      throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎响应缺少 data 数组。");
    }
    List<Map<String, Object>> rows = new ArrayList<>(list.size());
    for (Object item : list) {
      if (!(item instanceof Map<?, ?> row)) {
        throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎 data 中存在非对象记录。");
      }
      Map<String, Object> copy = new LinkedHashMap<>();
      row.forEach((key, value) -> copy.put(String.valueOf(key), value));
      rows.add(copy);
    }
    return rows;
  }

  private static List<Map<String, Object>> rows(CompiledSemanticQuery query, List<Map<String, Object>> data) {
    List<Map<String, Object>> rows = new ArrayList<>(data.size());
    for (Map<String, Object> raw : data) {
      Map<String, Object> row = new LinkedHashMap<>();
      for (CompiledSemanticQuery.Column column : query.columns()) {
        if (!raw.containsKey(column.member())) {
          throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎结果缺少字段 " + column.member() + "。");
        }
        row.put(column.key(), value(column, raw.get(column.member())));
      }
      rows.add(Collections.unmodifiableMap(row));
    }
    return rows;
  }

  private static Object value(CompiledSemanticQuery.Column column, Object value) {
    if (value == null) return null;
    return switch (column.kind()) {
      case MEASURE -> number(column, value);
      case TIME -> {
        String text = value.toString();
        yield text.length() >= 10 ? text.substring(0, 10) : text;
      }
      case DIMENSION -> column.type() == com.dip3.ontologyagent.semantic.api.OntologyProperty.Type.NUMBER
          ? number(column, value) : value;
    };
  }

  private static Number number(CompiledSemanticQuery.Column column, Object value) {
    try {
      BigDecimal decimal = new BigDecimal(value.toString());
      if (decimal.scale() <= 0 || decimal.stripTrailingZeros().scale() <= 0) {
        return decimal.longValueExact();
      }
      return decimal.doubleValue();
    } catch (NumberFormatException | ArithmeticException error) {
      throw new BackendException("SEMANTIC_RESPONSE_INVALID", "语义引擎字段 " + column.member() + " 返回了非数值结果。", error);
    }
  }

  private String token(AccessContext access) {
    Map<String, Object> scope = access.scope().all()
        ? Map.of("mode", "all")
        : Map.of("mode", "scoped", "values", access.scope().values());
    long issuedAt = Instant.now().getEpochSecond();
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("iat", issuedAt);
    payload.put("exp", issuedAt + TOKEN_TTL.toSeconds());
    payload.put("productVersions", access.productVersions());
    payload.put("scope", scope);
    try {
      String header = base64(json.write(Map.of("alg", "HS256", "typ", "JWT")));
      String unsigned = header + "." + base64(json.write(payload));
      Mac mac = Mac.getInstance("HmacSHA256");
      mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
      return unsigned + "." + Base64.getUrlEncoder().withoutPadding()
          .encodeToString(mac.doFinal(unsigned.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new BackendException("SEMANTIC_TOKEN_FAILED", "语义引擎访问令牌生成失败。", error);
    }
  }

  private static String base64(String value) {
    return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
  }
}
