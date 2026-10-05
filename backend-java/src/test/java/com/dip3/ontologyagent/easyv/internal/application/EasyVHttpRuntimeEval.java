package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.execution.AnalysisWorker;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.support.JsonCodec;
import java.net.CookieManager;
import java.net.URI;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

/** 仅由 live IT 调用；HTTP 请求不 mock Controller，统计不 mock Cube 或模型。 */
final class EasyVHttpRuntimeEval {
  private final ApplicationContext app;
  private final List<EasyVAnalysisModel.PlanDecision> decisions;
  private final List<String> responses;
  private final JsonCodec json;
  private final JdbcTemplate jdbc;
  private final String base;
  private final HttpClient http = HttpClient.newBuilder().cookieHandler(new CookieManager())
      .connectTimeout(Duration.ofSeconds(10)).build();
  private final List<Map<String, Object>> rounds = new ArrayList<>();

  EasyVHttpRuntimeEval(ApplicationContext app, List<EasyVAnalysisModel.PlanDecision> decisions, List<String> responses, int port) {
    this.app = app; this.decisions = decisions; this.responses = responses; this.base = "http://127.0.0.1:" + port;
    this.json = app.getBean(JsonCodec.class); this.jdbc = app.getBean(JdbcTemplate.class);
  }

  void verify() throws Exception {
    var fixtures = new EasyVObjectToolEval(app, decisions);
    var principal = app.getBean(EasyVScopeResolver.class).executionPrincipal(fixtures.prepareAnalyst("http-eval"));
    app.getBean(IdentityAccountService.class).resetPassword(Long.parseLong(principal.userId()), "isolated-runtime-eval-password");
    var dataset = fixtures.publish("http-eval-full", false);
    var expected = jdbc.queryForMap("""
        select count(*) as "parsedCount", sum(l.block_count) as "blockTotal", sum(l.component_count) as "componentTotal"
        from facts.easyv_prototype_layout l join facts.easyv_ai_application a on a.app_id=l.app_id
        where l.product_version_id=? and a.product_version_id=? and a.user_id=16 and not a.is_deleted and l.parse_status='ok'
        """, dataset.productVersionIds().get("easyv-prototype-layout"), dataset.productVersionIds().get("easyv-ai-application"));
    assertEquals(2, jdbc.queryForObject("select count(*) from facts.easyv_prototype_layout where product_version_id=?", Integer.class,
        dataset.productVersionIds().get("easyv-prototype-layout")));
    assertTrue(expected.values().stream().allMatch(value -> ((Number) value).longValue() == 1));
    Map<String, Object> report = new LinkedHashMap<>();
    report.put("model", System.getenv("LLM_PROVIDER_MODEL")); report.put("evaluatedAt", Instant.now().toString());
    report.put("scope", "real model, Cube, Redis, HTTP and production Worker; disposable PostgreSQL source fixtures");
    report.put("independentSql", expected); report.put("rounds", rounds);
    try {
      var login = post("/api/auth/login", Map.of("account", "http-eval-analyst", "password", "isolated-runtime-eval-password", "next", "/workspace"));
      assertEquals("/workspace", redirect(login));
      assertTrue(login.headers().firstValue("Set-Cookie").orElseThrow().startsWith("dip3_session="));
      report.put("login", Map.of("status", login.statusCode(), "location", redirect(login)));
      var created = post("/api/analysis/sessions", Map.of("question",
          "统计已解析原型数、区域总数、图表组件总数；列出对应的原型版式对象，读取它的区域和组件，依据真实数据说明。"));
      String path = redirect(created);
      String session = path.substring(path.lastIndexOf('/') + 1);
      String execution = queryParam(redirect(post("/api/analysis/sessions/" + session + "/execute", Map.of())), "executionId");
      var root = run(session, execution, dataset);
      var tools = calls(root).stream().map(call -> call.get("tool")).collect(Collectors.toSet());
      assertTrue(tools.containsAll(Set.of("query_metrics", "query_objects", "traverse_objects")), () -> "缺少统计/对象/关系工具：" + tools);
      expected.forEach((key, value) -> assertEquals(((Number) value).longValue(), metric(root, "easyv-prototype-layout", key), "统计须与独立 SQL 一致：" + key));
      var references = references(root);
      assertTrue(references.stream().map(ref -> ref.get("objectKey")).collect(Collectors.toSet())
          .containsAll(Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component")));
      var block = references.stream().filter(ref -> "easyv-prototype-block".equals(ref.get("objectKey"))).findFirst().orElseThrow();
      var selection = Map.of("executionId", execution, "datasetVersionSetId", dataset.publicationId(), "reference", block);
      var followUp = post("/api/analysis/sessions/" + session + "/follow-ups", Map.of("question",
          "这个区域共有多少图表组件？评估它的当前方案与候选方案，依据实际统计和比较结果回答。", "objectSelection", json.write(selection)));
      String followUpId = queryParam(redirect(followUp), "followUpId");
      var followExecution = post("/api/analysis/sessions/" + session + "/execute", Map.of("followUpId", followUpId));
      String selectedExecution = queryParam(redirect(followExecution), "executionId");
      var selected = run(session, selectedExecution, dataset);
      assertEquals(selection, map(selected.get("planSnapshot")).get("_objectSelection"));
      boolean countsComponents = calls(selected).stream().filter(call -> "query_metrics".equals(call.get("tool")))
          .map(call -> map(map(call.get("input")).get("intent")))
          .anyMatch(intent -> "easyv-prototype-component".equals(intent.get("object")) && ((List<?>) intent.get("measures")).contains("count"));
      assertEquals(1, countsComponents ? metric(selected, "easyv-prototype-component", "count")
          : metric(selected, "easyv-prototype-block", "componentTotal"));
      var selectedQueries = maps(map(map(selected.get("planSnapshot")).get("_resolvedContext")).get("queries"));
      assertTrue(selectedQueries.stream().map(query -> map(query.get("intent"))).anyMatch(intent ->
          (countsComponents ? "easyv-prototype-component" : "easyv-prototype-block").equals(intent.get("object"))
              && maps(intent.get("filters")).contains(Map.of("member", "blockKey", "operator", "equals", "values", List.of(block.get("objectId"))))));
      assertTrue(calls(selected).stream().map(call -> call.get("tool")).collect(Collectors.toSet())
          .containsAll(Set.of("query_metrics", "assess_scheme")));
      var comparison = maps(selected.get("resultBlocks")).stream().filter(item -> "scheme-comparison".equals(item.get("type")))
          .map(item -> map(item.get("result"))).findFirst().orElseThrow();
      assertEquals("evaluated", comparison.get("status"));
      assertEquals(2, maps(map(comparison.get("comparison")).get("candidates")).size());
      var listed = get("/api/analysis/sessions/" + session + "/follow-ups");
      assertEquals(200, listed.statusCode());
      assertEquals(selectedExecution, json.list(listed.body()).getFirst().get("resultExecutionId"));
      for (var round : rounds) {
        var snapshot = get("/internal/analysis/sessions/" + session + "/executions/" + round.get("executionId") + "/snapshot");
        assertEquals(200, snapshot.statusCode()); assertEquals(round.get("snapshot"), json.map(snapshot.body()));
      }
      var unauthenticated = HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(base + "/internal/analysis/sessions/" + session
          + "/executions/" + execution + "/snapshot")).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(401, unauthenticated.statusCode()); assertEquals("AUTH_REQUIRED", json.map(unauthenticated.body()).get("code"));
      report.put("unauthenticatedRead", Map.of("status", unauthenticated.statusCode(), "code", "AUTH_REQUIRED"));
      var accounts = app.getBean(IdentityAccountService.class);
      var other = accounts.provision("http-eval-other", "隔离评测用户17", "isolated-runtime-eval-password",
          "tool-eval", "local", List.of("EASYV_ANALYST"), principal.userId());
      accounts.bindSubject(other.id(), "easyv", "userId", "17", principal.userId());
      var otherHttp = HttpClient.newBuilder().cookieHandler(new CookieManager()).build();
      var otherLogin = otherHttp.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/login"))
          .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(
              "account=http-eval-other&password=isolated-runtime-eval-password&next=%2Fworkspace")).build(), HttpResponse.BodyHandlers.ofString());
      assertEquals("/workspace", redirect(otherLogin));
      var forbidden = otherHttp.send(HttpRequest.newBuilder(URI.create(base + "/internal/analysis/sessions/" + session
          + "/executions/" + execution + "/snapshot")).GET().build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(404, forbidden.statusCode()); assertEquals("SESSION_NOT_FOUND", json.map(forbidden.body()).get("code"));
      report.put("otherOwnerRead", Map.of("status", forbidden.statusCode(), "code", "SESSION_NOT_FOUND"));
      report.put("pass", true);
    } catch (Exception | AssertionError failure) {
      report.put("pass", false); report.put("error", failure.toString()); throw failure;
    } finally {
      Files.createDirectories(Path.of("target", "eval"));
      Files.writeString(Path.of("target", "eval", "easyv-http-runtime-report.json"), json.write(report));
    }
  }

  private Map<String, Object> run(String session, String execution, DatasetVersionSet dataset) throws Exception {
    decisions.clear(); responses.clear();
    String streamPath = "/api/analysis/sessions/" + session + "/stream?executionId=" + execution;
    var stream = http.sendAsync(HttpRequest.newBuilder(URI.create(base + streamPath)).timeout(Duration.ofMinutes(3))
        .GET().build(), HttpResponse.BodyHandlers.ofString());
    assertTrue(app.getBean(AnalysisWorker.class).runOne("http-runtime-eval"));
    var snapshotResponse = get("/internal/analysis/sessions/" + session + "/executions/" + execution + "/snapshot");
    assertEquals(200, snapshotResponse.statusCode());
    var snapshot = json.map(snapshotResponse.body());
    var round = new LinkedHashMap<String, Object>();
    round.put("executionId", execution); round.put("snapshot", snapshot); round.put("planningDecisions", List.copyOf(decisions)); round.put("providerResponses", List.copyOf(responses)); rounds.add(round);
    System.out.printf("EasyV HTTP eval execution=%s status=%s error=%s%n", execution, snapshot.get("status"), snapshot.get("errorCode"));
    var streamed = stream.get(3, TimeUnit.MINUTES);
    round.put("sseStatus", streamed.statusCode()); round.put("sseFrames", streamed.body());
    var audit = jdbc.queryForList("select tool_name,kind,status,input::text,output::text,error_code,error_message from platform.agent_invocations where execution_id=? order by created_at,id", execution);
    round.put("audit", audit);
    assertEquals("completed", snapshot.get("status"), () -> "Worker 失败：" + snapshot.get("errorCode") + " " + snapshot.get("failurePoint"));
    assertEquals(dataset.publicationId(), snapshot.get("datasetVersionSetId"));
    assertEquals(200, streamed.statusCode()); assertTrue(streamed.headers().firstValue("content-type").orElseThrow().startsWith("text/event-stream"));
    var events = app.getBean(ExecutionRepository.class).listAfter(session, execution, (String) snapshot.get("ownerUserId"), 0);
    long eventDurationMs = Duration.between(events.getFirst().timestamp(), events.getLast().timestamp()).toMillis();
    assertTrue(eventDurationMs > 30_000, "真实 HTTP 流必须跨过原容器 30 秒超时并收到完成事件");
    round.put("eventDurationMs", eventDurationMs);
    String expectedFrames = events.stream().map(event -> "data: " + json.write(event) + "\n\n").collect(Collectors.joining());
    assertEquals(expectedFrames, streamed.body()); assertEquals("completed", events.getLast().status());
    assertTrue(events.getLast().terminal()); assertEquals(snapshot.get("resultBlocks"), json.list(json.write(events.getLast().renderBlocks())));
    long after = events.get(events.size() / 2).sequence();
    var resumed = get(streamPath + "&afterSequence=" + after);
    assertEquals(200, resumed.statusCode());
    assertEquals(events.stream().filter(event -> event.sequence() > after).map(event -> "data: " + json.write(event) + "\n\n").collect(Collectors.joining()), resumed.body());
    round.put("sseAfterSequence", after); round.put("sseResumed", resumed.body());
    for (var reference : references(snapshot)) {
      assertEquals(Map.of("easyv-prototype-layout", "app-16", "easyv-prototype-block", "16:page-1__b_1", "easyv-prototype-component", "16:c1")
          .get(reference.get("objectKey")), reference.get("objectId"));
      assertEquals(dataset.productVersionIds().get(reference.get("objectKey")), reference.get("productVersionId"));
    }

    assertTrue(audit.stream().allMatch(row -> "completed".equals(row.get("status"))));
    for (var row : audit) if ("subtool".equals(row.get("kind"))) {
      var input = json.map(row.get("input"));
      if (input.containsKey("productVersions")) {
        assertEquals(dataset.productVersionIds(), input.get("productVersions"));
        assertEquals(Map.of("all", false, "values", Map.of("userId", List.of("16"))), input.get("scope"));
      }
      if ("query_metrics".equals(row.get("tool_name"))) assertTrue(json.map(row.get("output")).get("sql") instanceof String sql && !sql.isBlank());
    }
    assertEquals(1, audit.stream().filter(row -> "agent-run".equals(row.get("kind"))).count()); round.put("audit", audit);
    assertEquals("published", jdbc.queryForObject("select dispatch_status from platform.jobs where id=?", String.class, execution));
    return snapshot;
  }

  private long metric(Map<String, Object> snapshot, String objectKey, String key) {
    var sources = calls(snapshot).stream().filter(call -> "query_metrics".equals(call.get("tool")))
        .filter(call -> objectKey.equals(map(map(call.get("input")).get("intent")).get("object")))
        .map(call -> "easyv-query:" + call.get("id")).collect(Collectors.toSet());
    return maps(map(snapshot.get("conclusionState")).get("evidence")).stream()
        .filter(item -> sources.contains(item.get("source")))
        .flatMap(item -> maps(item.get("rows")).stream()).map(item -> item.get(key))
        .filter(Number.class::isInstance).map(Number.class::cast).mapToLong(Number::longValue).findFirst().orElseThrow();
  }
  private List<Map<String, Object>> calls(Map<String, Object> snapshot) {
    return EasyVAgentTools.readTrace(map(map(snapshot.get("planSnapshot")).get("_resolvedContext")).get("toolCalls"));
  }
  private List<Map<String, Object>> references(Map<String, Object> snapshot) {
    return calls(snapshot).stream().flatMap(call -> maps(call.get("references")).stream()).toList();
  }
  private Map<String, Object> map(Object value) { return json.map(json.write(value)); }
  private List<Map<String, Object>> maps(Object value) { return json.list(json.write(value)); }
  private HttpResponse<String> get(String path) throws Exception {
    return http.send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofMinutes(3)).GET().build(), HttpResponse.BodyHandlers.ofString());
  }
  private HttpResponse<String> post(String path, Map<String, String> fields) throws Exception {
    String body = fields.entrySet().stream().map(entry -> encode(entry.getKey()) + "=" + encode(entry.getValue())).collect(Collectors.joining("&"));
    return http.send(HttpRequest.newBuilder(URI.create(base + path)).timeout(Duration.ofMinutes(3))
        .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
  }
  private String redirect(HttpResponse<String> response) {
    assertEquals(303, response.statusCode(), response::body); return response.headers().firstValue("Location").orElseThrow();
  }
  private static String queryParam(String location, String name) {
    return Arrays.stream(URI.create(location).getRawQuery().split("&")).map(item -> item.split("=", 2))
        .filter(item -> item[0].equals(name)).map(item -> URLDecoder.decode(item[1], StandardCharsets.UTF_8)).findFirst().orElseThrow();
  }
  private static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
}
