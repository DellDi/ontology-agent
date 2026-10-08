package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.ResolvedTimeRange;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * 真实模型规划评测门禁（live-integration profile）：对评测集逐题调用真实模型规划 + Java 编译，
 * 按期望判分并输出报告 target/eval/easyv-planning-report.{json,md}。
 *
 * <p>判分规则：
 * <ul>
 *   <li>status 必须一致（ready / clarify / unsupported）；规划校验失败或其他错误记为不通过</li>
 *   <li>ready：每个期望查询须匹配一个不同的产出查询（允许额外查询）；anyOf 任一候选命中即可；
 *       alternatives 为多组等价查询集合，任一组整体命中即可</li>
 *   <li>查询匹配：object 相同；期望 measures ⊆ 产出 measures；dimensions、filters 集合完全一致（缺省为空）；
 *       granularity 一致（缺省不分桶）；时间属性一致（缺省对象默认时间）；解析后区间一致（all 或 from/to）；
 *       对比区间一致（缺省无对比）；期望声明 limit 时必须一致</li>
 *   <li>时间正确：带 time 标签的题，按 object + 时间属性 + 解析区间 + 对比区间存在匹配</li>
 *   <li>门禁：整体通过率 ≥ gate.overallPassRate，time 题时间正确率 ≥ gate.timePassRate</li>
 * </ul>
 */
@Testcontainers
@SpringBootTest(properties = {
    "dip3.worker.enabled=false",
    "dip3.easyv.enabled=true",
    "dip3.easyv.source.enabled=false",
    "spring.main.web-application-type=none"
})
@ContextConfiguration(initializers = EasyVPlanningEvalIT.RequiredEnvironment.class)
class EasyVPlanningEvalIT {
  private static final String DATASET = "/eval/easyv-planning-eval.json";
  private static final Path REPORT_DIR = Path.of("target", "eval");
  private static final List<String> REQUIRED_ENVIRONMENT = List.of(
      "LLM_PROVIDER_BASE_URL", "LLM_PROVIDER_API_KEY", "LLM_PROVIDER_MODEL",
      "LLM_PROVIDER_MODE", "LLM_PROVIDER_TOOL_CALLING", "LLM_PROVIDER_STRUCTURED_OUTPUT");
  private static final ObjectMapper MAPPER = new ObjectMapper().findAndRegisterModules()
      .enable(SerializationFeature.INDENT_OUTPUT);

  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
    registry.add("spring.datasource.username", POSTGRES::getUsername);
    registry.add("spring.datasource.password", POSTGRES::getPassword);
    registry.add("spring.data.redis.url", () -> "redis://127.0.0.1:1");
    registry.add("dip3.cube.api-url", () -> "http://127.0.0.1:1/cubejs-api/v1");
    registry.add("dip3.cube.api-secret", () -> "easyv-planning-eval-cube-secret-unused-entropy");
    providerProperties(registry);
  }

  static void providerProperties(DynamicPropertyRegistry registry) {
    registry.add("spring.ai.openai.base-url", () -> required("LLM_PROVIDER_BASE_URL"));
    registry.add("spring.ai.openai.api-key", () -> required("LLM_PROVIDER_API_KEY"));
    registry.add("spring.ai.openai.chat.model", () -> required("LLM_PROVIDER_MODEL"));
    registry.add("spring.ai.openai.chat.max-retries", () -> "0");
    registry.add("spring.ai.openai.chat.parallel-tool-calls", () -> "false");
    registry.add("dip3.ai.provider.mode", () -> required("LLM_PROVIDER_MODE"));
    registry.add("dip3.ai.provider.tool-calling", () -> required("LLM_PROVIDER_TOOL_CALLING"));
    registry.add("dip3.ai.provider.structured-output", () -> required("LLM_PROVIDER_STRUCTURED_OUTPUT"));
    registry.add("spring.ai.chat.memory.repository.jdbc.initialize-schema", () -> "never");
    registry.add("dip3.session-secret", () -> "easyv-planning-eval-session-secret-with-entropy");
    registry.add("dip3.redis-key-prefix", () -> "easyv-planning-eval");
    registry.add("dip3.neo4j.uri", () -> "bolt://127.0.0.1:1");
    registry.add("dip3.neo4j.username", () -> "neo4j");
    registry.add("dip3.neo4j.password", () -> "unused-easyv-planning-eval-password");
    registry.add("dip3.neo4j.database", () -> "neo4j");
  }

  @BeforeAll
  static void migrate() {
    MigrationTestSupport.migrate(POSTGRES);
  }

  @Autowired EasyVSemanticAgent agent;
  @Autowired SemanticModel semantic;
  @Autowired org.springframework.context.ApplicationContext application;
  @MockitoSpyBean EasyVAnalysisModel model;
  @MockitoSpyBean org.springframework.ai.openai.OpenAiChatModel provider;
  private final List<EasyVAnalysisModel.PlanDecision> planningDecisions = new ArrayList<>();
  private final List<String> providerChunks = new ArrayList<>();

  @BeforeEach
  void recordRealModelDecisions() {
    org.mockito.Mockito.doAnswer(invocation -> {
      var decision = (EasyVAnalysisModel.PlanDecision) invocation.callRealMethod();
      planningDecisions.add(decision);
      return decision;
    }).when(model).plan(org.mockito.ArgumentMatchers.any());
    org.mockito.Mockito.doAnswer(invocation -> {
      @SuppressWarnings("unchecked")
      var response = (reactor.core.publisher.Flux<org.springframework.ai.chat.model.ChatResponse>) invocation.callRealMethod();
      return response.doOnNext(chunk -> providerChunks.add(chunk.getResult().getOutput().getText()));
    }).when(provider).stream(org.mockito.ArgumentMatchers.any(org.springframework.ai.chat.prompt.Prompt.class));
  }

  @Test
  void realModelObjectToolsUsePublishedFactsAndCurrentAnalystScope() throws Exception {
    new EasyVObjectToolEval(application, planningDecisions).verify();
  }

  @Test
  void realModelWorkerPersistsSelectedFollowUpsAndHistory() throws Exception {
    new EasyVObjectToolEval(application, planningDecisions).verifyWorkerFollowUps();
  }

  @Test
  void realModelConclusionKeepsTopNSeparateFromFullTotals() throws Exception {
    Map<String, Object> dataset;
    try (InputStream input = Objects.requireNonNull(getClass().getResourceAsStream("/eval/easyv-topn-conclusion-eval.json"))) {
      dataset = MAPPER.readValue(input, new TypeReference<>() {});
    }
    List<Map<String, Object>> report = new ArrayList<>();
    for (var item : maps(dataset.get("cases"))) {
      var results = maps(item.get("results"));
      var answer = model.compose(new EasyVAnalysisModel.ComposeRequest((String) item.get("question"),
          "EasyV 用户 3 的数据", results, List.of(), 30000), text -> {});
      String text = answer.markdown().replaceAll("[\\s*`，,:：]", "");
      boolean wrongTotal = java.util.regex.Pattern.compile("(?:符合条件的原型|全部原型|原型总数|全量原型)(?:数|量)?(?:一共|总共|共|只有|为|是|仅有|仅|共有|计|有)*[3三](?:个|[。；]|$)").matcher(text).find();
      boolean citationsValid = !answer.citations().isEmpty() && answer.citations().stream().allMatch(citation -> results.stream()
          .filter(result -> result.get("id").equals(citation.query())).anyMatch(result -> {
            var rows = maps(result.get("rows"));
            return citation.row() >= 0 && citation.row() < rows.size() && rows.get(citation.row()).containsKey(citation.field());
          }));
      boolean totalCited = !Boolean.TRUE.equals(item.get("hasTotal")) || (text.contains("5")
          && answer.citations().contains(new EasyVAnalysisModel.Citation("q2", 0, "count")));
      report.add(Map.of("id", item.get("id"), "input", results, "answer", answer,
          "pass", !wrongTotal && citationsValid && totalCited && !text.contains("limit") && !text.contains("totalRows")));
    }
    Files.createDirectories(REPORT_DIR);
    Files.writeString(REPORT_DIR.resolve("easyv-topn-conclusion-report.json"), MAPPER.writeValueAsString(report));
    assertTrue(report.stream().allMatch(item -> Boolean.TRUE.equals(item.get("pass"))),
        "Top N 结论回归未通过，详见 target/eval/easyv-topn-conclusion-report.json");
  }

  @Test
  void realModelComparisonRegression() throws Exception {
    Map<String, Object> dataset;
    try (InputStream input = Objects.requireNonNull(getClass().getResourceAsStream(DATASET), DATASET)) {
      dataset = MAPPER.readValue(input, new TypeReference<>() {});
    }
    Set<String> ids = Set.of("c01", "c02", "c03", "c04", "c05", "u05", "f02");
    List<Map<String, Object>> results = maps(dataset.get("cases")).stream()
        .filter(item -> ids.contains(item.get("id")))
        .map(item -> evaluate(item, Instant.parse((String) dataset.get("anchoredAt")))).toList();
    Files.createDirectories(REPORT_DIR);
    Files.writeString(REPORT_DIR.resolve("easyv-comparison-regression.json"), MAPPER.writeValueAsString(results));
    assertTrue(results.stream().allMatch(result -> Boolean.TRUE.equals(result.get("pass"))),
        () -> "对比规划回归未通过，详见 " + REPORT_DIR.resolve("easyv-comparison-regression.json").toAbsolutePath());
  }

  @Test
  void realModelPlanningMeetsReleaseGate() throws Exception {
    Map<String, Object> dataset;
    try (InputStream input = Objects.requireNonNull(getClass().getResourceAsStream(DATASET), DATASET)) {
      dataset = MAPPER.readValue(input, new TypeReference<>() {});
    }
    Instant anchoredAt = Instant.parse((String) dataset.get("anchoredAt"));
    Map<String, Object> gate = map(dataset.get("gate"));
    double overallGate = ((Number) gate.get("overallPassRate")).doubleValue();
    double timeGate = ((Number) gate.get("timePassRate")).doubleValue();

    List<Map<String, Object>> results = new ArrayList<>();
    for (Map<String, Object> item : maps(dataset.get("cases"))) {
      Map<String, Object> result = evaluate(item, anchoredAt);
      results.add(result);
      System.out.printf(Locale.ROOT, "EasyV planning eval %d: %s status=%s pass=%s timePass=%s durationMs=%s errorCode=%s%n",
          results.size(), result.get("id"), result.get("status"), result.get("pass"), result.get("timePass"),
          result.get("durationMs"), result.getOrDefault("errorCode", "none"));
    }

    long passed = results.stream().filter(r -> Boolean.TRUE.equals(r.get("pass"))).count();
    List<Map<String, Object>> timeCases = results.stream()
        .filter(r -> strings(r.get("tags")).contains("time")).toList();
    long timePassed = timeCases.stream().filter(r -> Boolean.TRUE.equals(r.get("timePass"))).count();
    double overallRate = (double) passed / results.size();
    double timeRate = timeCases.isEmpty() ? 1.0 : (double) timePassed / timeCases.size();

    Map<String, Object> summary = new LinkedHashMap<>();
    summary.put("model", System.getenv("LLM_PROVIDER_MODEL"));
    summary.put("anchoredAt", anchoredAt.toString());
    summary.put("evaluatedAt", Instant.now().toString());
    summary.put("total", results.size());
    summary.put("passed", passed);
    summary.put("overallPassRate", overallRate);
    summary.put("timeTotal", timeCases.size());
    summary.put("timePassed", timePassed);
    summary.put("timePassRate", timeRate);
    summary.put("gate", gate);
    summary.put("byTag", byTag(results));
    Map<String, Object> report = new LinkedHashMap<>();
    report.put("summary", summary);
    report.put("cases", results);
    Files.createDirectories(REPORT_DIR);
    Files.writeString(REPORT_DIR.resolve("easyv-planning-report.json"), MAPPER.writeValueAsString(report));
    Files.writeString(REPORT_DIR.resolve("easyv-planning-report.md"), markdown(summary, results));

    assertTrue(overallRate >= overallGate && timeRate >= timeGate,
        () -> String.format(Locale.ROOT, "规划评测未达门禁：整体 %d/%d=%.3f（门槛 %.2f），时间 %d/%d=%.3f（门槛 %.2f）；详见 %s",
            passed, results.size(), overallRate, overallGate, timePassed, timeCases.size(), timeRate, timeGate,
            REPORT_DIR.resolve("easyv-planning-report.md").toAbsolutePath()));
  }

  private Map<String, Object> evaluate(Map<String, Object> item, Instant anchoredAt) {
    planningDecisions.clear();
    providerChunks.clear();
    Map<String, Object> expect = map(item.get("expect"));
    String expectedStatus = (String) expect.get("status");
    List<Map<String, Object>> previous = item.get("previousQueries") == null ? List.of() : maps(item.get("previousQueries"));
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("id", item.get("id"));
    result.put("tags", item.get("tags"));
    result.put("question", item.get("question"));
    result.put("expectedStatus", expectedStatus);
    long started = System.nanoTime();
    String status;
    List<CompiledSemanticQuery> produced = List.of();
    try {
      produced = agent.planQueries((String) item.get("question"), anchoredAt, Map.of(), previous);
      status = "ready";
    } catch (BackendException error) {
      status = switch (error.code()) {
        case "EASYV_CLARIFICATION_REQUIRED" -> "clarify";
        case "EASYV_QUESTION_UNSUPPORTED" -> "unsupported";
        default -> "error";
      };
      result.put("errorCode", error.code());
      result.put("message", error.getMessage());
    } catch (RuntimeException error) {
      status = "error";
      result.put("errorCode", error.getClass().getSimpleName());
      result.put("message", error.getMessage());
    }
    result.put("durationMs", (System.nanoTime() - started) / 1_000_000L);
    result.put("planningDecisions", List.copyOf(planningDecisions));
    if ("error".equals(status)) result.put("providerResponse", String.join("", providerChunks));
    result.put("status", status);
    result.put("produced", produced.stream().map(this::describe).toList());

    boolean pass;
    boolean timePass;
    if (!expectedStatus.equals(status)) {
      pass = false;
      timePass = false;
      result.put("reason", "status 期望 " + expectedStatus + "，实际 " + status);
    } else if (!"ready".equals(status)) {
      pass = true;
      timePass = true;
    } else {
      List<Object> alternatives = expect.containsKey("alternatives")
          ? list(expect.get("alternatives")) : List.of(expect.get("queries"));
      List<CompiledSemanticQuery> compiled = produced;
      pass = false;
      timePass = false;
      for (Object alternative : alternatives) {
        List<List<Map<String, Object>>> expected = maps(alternative).stream()
            .map(query -> query.containsKey("anyOf") ? maps(query.get("anyOf")) : List.of(query)).toList();
        pass |= assign(expected, compiled, 0, new boolean[compiled.size()], false);
        timePass |= assign(expected, compiled, 0, new boolean[compiled.size()], true);
      }
      if (!pass) result.put("reason", timePass ? "时间正确但查询结构不符" : "时间或查询结构不符");
    }
    result.put("pass", pass);
    result.put("timePass", timePass);
    return result;
  }

  private boolean assign(List<List<Map<String, Object>>> expected, List<CompiledSemanticQuery> produced, int index,
                         boolean[] used, boolean timeOnly) {
    if (index == expected.size()) return true;
    for (int i = 0; i < produced.size(); i += 1) {
      if (used[i]) continue;
      CompiledSemanticQuery candidate = produced.get(i);
      boolean matched = expected.get(index).stream()
          .anyMatch(spec -> timeOnly ? timeMatches(spec, candidate) : matches(spec, candidate));
      if (!matched) continue;
      used[i] = true;
      if (assign(expected, produced, index + 1, used, timeOnly)) return true;
      used[i] = false;
    }
    return false;
  }

  private boolean timeMatches(Map<String, Object> spec, CompiledSemanticQuery query) {
    if (!spec.get("object").equals(query.objectKey())) return false;
    String expectedTime = spec.get("timeDimension") == null
        ? semantic.require(query.objectKey()).defaultTimeProperty() : (String) spec.get("timeDimension");
    if (!expectedTime.equals(timeDimension(query))) return false;
    if (!rangeMatches(spec.get("range"), query.range())) return false;
    Object compare = spec.get("compare");
    if (compare == null) return query.compareRange() == null;
    return query.compareRange() != null && rangeMatches(compare, query.compareRange());
  }

  private boolean matches(Map<String, Object> spec, CompiledSemanticQuery query) {
    if (!timeMatches(spec, query)) return false;
    QueryIntent intent = query.intent();
    if (!intent.measures().containsAll(strings(spec.get("measures")))) return false;
    if (!new TreeSet<>(strings(spec.getOrDefault("dimensions", List.of())))
        .equals(new TreeSet<>(intent.dimensions()))) return false;
    Set<String> expectedFilters = maps(spec.getOrDefault("filters", List.of())).stream()
        .map(filter -> filterKey((String) filter.get("member"), (String) filter.get("operator"),
            strings(filter.get("values"))))
        .collect(Collectors.toCollection(TreeSet::new));
    Set<String> producedFilters = intent.filters().stream()
        .map(filter -> filterKey(filter.member(), lower(filter.operator()), filter.values()))
        .collect(Collectors.toCollection(TreeSet::new));
    if (!expectedFilters.equals(producedFilters)) return false;
    if (!Objects.equals(spec.get("granularity"), query.granularity())) return false;
    return spec.get("limit") == null || Objects.equals(((Number) spec.get("limit")).intValue(), intent.limit());
  }

  private static boolean rangeMatches(Object expected, ResolvedTimeRange range) {
    if ("all".equals(expected)) return range.allData();
    Map<String, Object> bounds = map(expected);
    return !range.allData() && bounds.get("from").equals(String.valueOf(range.from()))
        && bounds.get("to").equals(String.valueOf(range.to()));
  }

  private String timeDimension(CompiledSemanticQuery query) {
    String dimension = query.intent().time() == null ? null : query.intent().time().dimension();
    return dimension == null || dimension.isBlank()
        ? semantic.require(query.objectKey()).defaultTimeProperty() : dimension;
  }

  private Map<String, Object> describe(CompiledSemanticQuery query) {
    Map<String, Object> out = new LinkedHashMap<>();
    out.put("intent", QueryIntentCodec.write(query.intent()));
    out.put("timeDimension", timeDimension(query));
    out.put("range", range(query.range()));
    out.put("compare", query.compareRange() == null ? null : range(query.compareRange()));
    out.put("granularity", query.granularity());
    return out;
  }

  private static Object range(ResolvedTimeRange range) {
    return range.allData() ? "all" : range.from() + "~" + range.to();
  }

  private static String filterKey(String member, String operator, List<String> values) {
    return member + "|" + operator + "|" + new TreeSet<>(values);
  }

  private static String lower(Enum<?> value) {
    return value.name().toLowerCase(Locale.ROOT).replace('_', '-');
  }

  private static Map<String, Object> byTag(List<Map<String, Object>> results) {
    Map<String, Object> out = new LinkedHashMap<>();
    results.stream().flatMap(r -> strings(r.get("tags")).stream()).distinct().sorted().forEach(tag -> {
      List<Map<String, Object>> tagged = results.stream().filter(r -> strings(r.get("tags")).contains(tag)).toList();
      long passed = tagged.stream().filter(r -> Boolean.TRUE.equals(r.get("pass"))).count();
      out.put(tag, passed + "/" + tagged.size());
    });
    return out;
  }

  private static String markdown(Map<String, Object> summary, List<Map<String, Object>> results) {
    StringBuilder md = new StringBuilder("# EasyV 规划评测报告\n\n");
    md.append(String.format(Locale.ROOT, "- 模型：%s%n- 锚点：%s；评测时间：%s%n- 整体通过：%s/%s（%.1f%%）%n- 时间正确：%s/%s（%.1f%%）%n- 门禁：%s%n- 分类：%s%n%n",
        summary.get("model"), summary.get("anchoredAt"), summary.get("evaluatedAt"),
        summary.get("passed"), summary.get("total"), 100 * (double) summary.get("overallPassRate"),
        summary.get("timePassed"), summary.get("timeTotal"), 100 * (double) summary.get("timePassRate"),
        summary.get("gate"), summary.get("byTag")));
    md.append("| id | 结果 | 时间 | 状态 | 问题 | 说明 |\n|---|---|---|---|---|---|\n");
    for (Map<String, Object> r : results) {
      md.append("| ").append(r.get("id"))
          .append(" | ").append(Boolean.TRUE.equals(r.get("pass")) ? "通过" : "**失败**")
          .append(" | ").append(Boolean.TRUE.equals(r.get("timePass")) ? "✓" : "✗")
          .append(" | ").append(r.get("status"))
          .append(" | ").append(r.get("question"))
          .append(" | ").append(Objects.toString(r.getOrDefault("reason", r.getOrDefault("errorCode", "")), ""))
          .append(" |\n");
    }
    return md.toString();
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> map(Object value) {
    return (Map<String, Object>) value;
  }

  @SuppressWarnings("unchecked")
  private static List<Map<String, Object>> maps(Object value) {
    return (List<Map<String, Object>>) value;
  }

  @SuppressWarnings("unchecked")
  private static List<Object> list(Object value) {
    return (List<Object>) value;
  }

  @SuppressWarnings("unchecked")
  private static List<String> strings(Object value) {
    return value == null ? List.of() : (List<String>) value;
  }

  private static String required(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) throw new IllegalStateException("规划评测缺少环境变量 " + name);
    return value.trim();
  }

  static final class RequiredEnvironment implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
      List<String> missing = REQUIRED_ENVIRONMENT.stream()
          .filter(name -> System.getenv(name) == null || System.getenv(name).isBlank()).toList();
      if (!missing.isEmpty()) {
        throw new IllegalStateException("规划评测缺少环境变量：" + String.join(", ", missing));
      }
    }
  }
}
