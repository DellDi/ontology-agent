package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.execution.AnalysisWorker;
import com.dip3.ontologyagent.execution.ExecutionSnapshot;
import com.dip3.ontologyagent.followup.AnalysisFollowUpService;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.ingestion.internal.application.*;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapService;
import com.dip3.ontologyagent.support.JsonCodec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.util.*;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;

/** 仅由 live IT 调用：隔离库中的源 fixture 经过正式发布/物化，再执行真实模型和正式对象工具。 */
final class EasyVObjectToolEval {
  private final ApplicationContext app;
  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  private final List<EasyVAnalysisModel.PlanDecision> decisions;

  EasyVObjectToolEval(ApplicationContext app, List<EasyVAnalysisModel.PlanDecision> decisions) {
    this.app = app;
    this.jdbc = app.getBean(JdbcTemplate.class);
    this.json = app.getBean(JsonCodec.class);
    this.decisions = decisions;
  }

  AuthSession prepareAnalyst(String prefix) {
    long adminId = account(prefix + "-admin", "PLATFORM_ADMIN");
    var admin = new AuthSession("tool-eval-admin", String.valueOf(adminId), "隔离评测管理员",
        new AccessScope("tool-eval", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
    app.getBean(OntologyBootstrapService.class).bootstrap(admin, "tool-eval-bootstrap");
    long analystId = account(prefix + "-analyst", "EASYV_ANALYST");
    jdbc.update("insert into identity.subject_bindings(account_id,source_key,subject_key,subject_value) values (?,'easyv','userId','16')", analystId);
    var worker = new AuthSession("tool-eval-worker", String.valueOf(analystId), "隔离评测用户",
        new AccessScope("tool-eval", List.of(), List.of(), List.of()), Instant.MAX);
    return worker;
  }

  void verify() throws Exception {
    var worker = prepareAnalyst("tool-eval");
    var full = publish("tool-eval-full", false);
    var oldProducts = new LinkedHashMap<>(full.productVersionIds());
    oldProducts.remove("easyv-scheme-library");
    var old = app.getBean(IngestionPersistencePort.class).freezeVersionSet(
        new IngestionPersistencePort.VersionSetPublication("tool-eval-old", oldProducts, full.capturedAt(), "test"));
    var empty = publish("tool-eval-empty", true);
    List<Map<String, Object>> results = new ArrayList<>();
    results.add(run("objects-relations", "查看原型版式对象列表，读取第一条版式详情，再查看它包含的区域和区域里的组件。请依据实际对象说明结构。", full, worker,
        Set.of("query_objects", "read_object", "traverse_objects"), null));
    results.add(run("scheme-comparison", "查看原型区域对象，评估第一个区域的当前方案和候选方案适配条件，给出候选比较依据。", full, worker,
        Set.of("query_objects", "assess_scheme"), "evaluated"));
    results.add(run("old-library", "查看原型区域对象，评估第一个区域的当前方案和候选方案适配条件，缺少输入时请明确说明。", old, worker,
        Set.of("query_objects", "assess_scheme"), "SCHEME_LIBRARY_NOT_RETAINED"));
    results.add(run("empty-objects", "查看原型版式对象，如果没有对象请明确说明，不要编造对象。", empty, worker,
        Set.of("query_objects"), "empty"));
    Files.createDirectories(Path.of("target", "eval"));
    var report = Map.of("model", System.getenv("LLM_PROVIDER_MODEL"), "evaluatedAt", Instant.now().toString(),
        "scope", "real model and production services; source fixtures and analyst identity only in disposable Testcontainers PostgreSQL",
        "cases", results);
    Files.writeString(Path.of("target", "eval", "easyv-object-tool-report.json"), json.write(report));
    assertTrue(results.stream().allMatch(result -> Boolean.TRUE.equals(result.get("pass"))),
        "对象工具真实模型验收未通过，详见 target/eval/easyv-object-tool-report.json");
  }

  void verifyWorkerFollowUps() throws Exception {
    var principal = app.getBean(EasyVScopeResolver.class).executionPrincipal(prepareAnalyst("worker-eval"));
    var owner = app.getBean(com.dip3.ontologyagent.auth.AuthSessionRepository.class).create(
        new com.dip3.ontologyagent.auth.AuthIdentity(principal.userId(), principal.displayName(), principal.scope()));
    var dataset = publish("worker-eval-full", false);
    var analyses = app.getBean(AnalysisService.class);
    var followUps = app.getBean(AnalysisFollowUpService.class);
    var session = analyses.createSession(owner, "查看 EasyV 原型区域对象列表及详情，依据实际对象说明结构。");
    List<Map<String, Object>> rounds = new ArrayList<>();
    try {
      var root = runWorker(session.id(), analyses.submit(session.id(), owner, "root", "trace-worker-root"), owner, rounds);
      var calls = EasyVAgentTools.readTrace(((Map<?, ?>) root.planSnapshot().get("_resolvedContext")).get("toolCalls"));
      var reference = calls.stream().flatMap(call -> ((List<?>) call.get("references")).stream())
          .map(raw -> json.map(json.write(raw))).filter(ref -> "easyv-prototype-block".equals(ref.get("objectKey")))
          .findFirst().orElseThrow();
      var selection = ObjectSelection.read(Map.of("executionId", root.executionId(), "datasetVersionSetId", dataset.publicationId(), "reference", reference));
      // 发布更新集合后仍须以被选历史对象的原集合执行，不能悄悄切换版本。
      var newer = publish("worker-eval-newer", false);
      var selected = followUps.createSelected(session.id(), owner, "评估这个区域的当前方案和候选方案，给出完整比较依据。", selection);
      assertEquals(dataset.publicationId(), selected.datasetVersionSetId());
      assertNotEquals(newer.publicationId(), selected.datasetVersionSetId());
      var assessment = runWorker(session.id(), followUps.submit(session.id(), selected.id(), owner, "selected", "trace-worker-selected"), owner, rounds);
      assertEquals(selection.snapshot(), assessment.planSnapshot().get("_objectSelection"));
      assertTrue(assessment.resultBlocks().stream().anyMatch(block -> "scheme-comparison".equals(block.get("type"))
          && "evaluated".equals(((Map<?, ?>) block.get("result")).get("status"))));
      // 从实际保存的区域追问快照继续选择，保留父轮次和版本，不手工构造执行上下文。
      var nextSelection = new ObjectSelection(assessment.executionId(), dataset.publicationId(), selection.reference());
      var next = followUps.createSelected(session.id(), owner, "这个区域里包含哪些组件？读取组件详情，依据真实组件说明图表类型。", nextSelection);
      assertEquals(selected.id(), next.parentFollowUpId());
      assertEquals(assessment.executionId(), next.referencedExecutionId());
      var components = runWorker(session.id(), followUps.submit(session.id(), next.id(), owner, "components", "trace-worker-components"), owner, rounds);
      var nextCalls = EasyVAgentTools.readTrace(((Map<?, ?>) components.planSnapshot().get("_resolvedContext")).get("toolCalls"));
      assertTrue(nextCalls.stream().flatMap(call -> ((List<?>) call.get("references")).stream())
          .map(raw -> json.map(json.write(raw))).anyMatch(ref -> "easyv-prototype-component".equals(ref.get("objectKey")) && "16:c1".equals(ref.get("objectId"))));
      assertEquals(2, followUps.list(session.id(), owner).size());
      var ordinary = followUps.create(session.id(), owner, "刚才这个组件属于哪个区域？读取对应区域详情。", next.id());
      assertEquals(newer.publicationId(), ordinary.datasetVersionSetId());
      var current = runWorker(session.id(), followUps.submit(session.id(), ordinary.id(), owner, "ordinary", "trace-worker-ordinary"), owner, rounds);
      assertEquals(newer.publicationId(), current.datasetVersionSetId());
      assertFalse(current.planSnapshot().containsKey("_objectSelection"));
      var currentCalls = EasyVAgentTools.readTrace(((Map<?, ?>) current.planSnapshot().get("_resolvedContext")).get("toolCalls"));
      var currentReferences = currentCalls.stream().flatMap(call -> ((List<?>) call.get("references")).stream())
          .map(raw -> json.map(json.write(raw))).toList();
      assertTrue(currentReferences.stream().anyMatch(ref -> "easyv-prototype-block".equals(ref.get("objectKey")) && "16:page-1__b_1".equals(ref.get("objectId"))));
      currentReferences.forEach(ref -> assertEquals(newer.productVersionIds().get(ref.get("objectKey")), ref.get("productVersionId")));
      assertEquals(3, followUps.list(session.id(), owner).size());
      for (var round : rounds) {
        String execution = (String) round.get("executionId");
        var replay = analyses.snapshot(session.id(), execution, owner).orElseThrow();
        assertEquals(round.get("snapshot"), json.map(json.write(replay)));
        assertEquals(execution.equals(current.executionId()) ? newer.publicationId() : dataset.publicationId(), replay.datasetVersionSetId());
      }
    } finally {
      Files.createDirectories(Path.of("target", "eval"));
      Files.writeString(Path.of("target", "eval", "easyv-worker-followup-report.json"), json.write(Map.of(
          "model", System.getenv("LLM_PROVIDER_MODEL"), "evaluatedAt", Instant.now().toString(),
          "scope", "real model, production Worker, persisted events and history; disposable PostgreSQL source fixtures", "rounds", rounds)));
    }
  }

  private ExecutionSnapshot runWorker(String sessionId, String executionId, AuthSession owner, List<Map<String, Object>> rounds) {
    decisions.clear();
    assertTrue(app.getBean(AnalysisWorker.class).runOne("live-object-eval"));
    var analyses = app.getBean(AnalysisService.class);
    var snapshot = analyses.snapshot(sessionId, executionId, owner).orElseThrow();
    var events = analyses.events(sessionId, executionId, owner, 0);
    var report = new LinkedHashMap<String, Object>();
    report.put("executionId", executionId); report.put("snapshot", json.map(json.write(snapshot)));
    report.put("events", events); report.put("planningDecisions", List.copyOf(decisions)); rounds.add(report);
    System.out.printf("EasyV worker eval: execution=%s status=%s error=%s events=%d%n", executionId, snapshot.status(), snapshot.errorCode(), events.size());
    assertEquals("completed", snapshot.status(), () -> "Worker failed: " + snapshot.errorCode() + " " + snapshot.failurePoint());
    var versionSet = app.getBean(DatasetVersionSetRegistry.class).requireFrozen(snapshot.datasetVersionSetId(), EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS);
    var calls = EasyVAgentTools.readTrace(((Map<?, ?>) snapshot.planSnapshot().get("_resolvedContext")).get("toolCalls"));
    assertFalse(calls.stream().anyMatch(call -> "query_metrics".equals(call.get("tool"))));
    for (var call : calls) for (var raw : (List<?>) call.get("references")) {
      var reference = json.map(json.write(raw));
      assertEquals(Map.of("easyv-prototype-layout", "app-16", "easyv-prototype-block", "16:page-1__b_1",
          "easyv-prototype-component", "16:c1").get(reference.get("objectKey")), reference.get("objectId"));
      assertEquals(versionSet.productVersionIds().get(reference.get("objectKey")), reference.get("productVersionId"));
    }
    var audit = jdbc.queryForList("select tool_name,kind,status,input::text,output::text from platform.agent_invocations where execution_id=? order by created_at,id", executionId);
    assertTrue(audit.stream().allMatch(row -> "completed".equals(row.get("status"))));
    assertEquals(1, audit.stream().filter(row -> "agent-run".equals(row.get("kind"))).count());
    report.put("audit", audit);
    assertTrue(events.getLast().terminal()); assertEquals("completed", events.getLast().status());
    assertEquals(snapshot.resultBlocks(), events.getLast().renderBlocks());
    assertTrue(events.stream().anyMatch(event -> "tool-started".equals(event.kind())));
    assertTrue(events.stream().anyMatch(event -> "tool-completed".equals(event.kind())));
    long last = 0;
    for (var event : events) { assertTrue(event.sequence() > last); last = event.sequence(); }
    var resumed = analyses.events(sessionId, executionId, owner, events.get(events.size() / 2).sequence());
    assertEquals(events.subList(events.size() / 2 + 1, events.size()), resumed);
    assertTrue(analyses.events(sessionId, executionId, owner, last).isEmpty());
    // 正式 SSE controller、签名 Cookie 与会话读取；直接消费 body，不声称覆盖浏览器/HTTP 代理。
    var request = new org.springframework.mock.web.MockHttpServletRequest();
    var authenticator = app.getBean(com.dip3.ontologyagent.auth.CookieSessionAuthenticator.class);
    request.setCookies(new jakarta.servlet.http.Cookie(com.dip3.ontologyagent.auth.CookieSessionAuthenticator.COOKIE_NAME,
        authenticator.createCookieValue(owner.sessionId())));
    long after = events.get(events.size() / 2).sequence();
    var stream = app.getBean(com.dip3.ontologyagent.analysis.AnalysisController.class)
        .stream(sessionId, executionId, String.valueOf(after), request);
    assertEquals("text/event-stream;charset=utf-8", stream.getHeaders().getContentType().toString());
    var output = new java.io.ByteArrayOutputStream();
    try { stream.getBody().writeTo(output); }
    catch (java.io.IOException failure) { throw new java.io.UncheckedIOException(failure); }
    String frames = output.toString(java.nio.charset.StandardCharsets.UTF_8);
    assertEquals(resumed.stream().map(event -> "data: " + json.write(event) + "\n\n").collect(java.util.stream.Collectors.joining()), frames);
    report.put("sseAfterSequence", after); report.put("sseFrames", frames);
    return snapshot;
  }

  private Map<String, Object> run(String id, String question, DatasetVersionSet dataset, AuthSession worker,
      Set<String> requiredTools, String expected) {
    decisions.clear();
    var sessions = app.getBean(AnalysisSessionRepository.class);
    var executions = app.getBean(ExecutionRepository.class);
    var scopes = app.getBean(EasyVScopeResolver.class);
    var ontology = app.getBean(OntologyRepository.class).currentPublished();
    var scope = scopes.resolveScope(scopes.executionPrincipal(worker));
    var binding = new CapabilityBinding(EasyVCapabilityRegistration.ID, ontology.versionId(), scope);
    var session = sessions.create(worker, question, Map.of());
    String execution = executions.submit(session, id, "trace-" + id, binding, dataset.publicationId()).executionId();
    var job = executions.claim("worker-" + id, Duration.ofMinutes(3)).orElseThrow();
    assertEquals(execution, job.executionId());
    Map<String, Object> report = new LinkedHashMap<>();
    report.put("id", id); report.put("question", question); report.put("executionId", execution);
    report.put("datasetVersionSetId", dataset.publicationId()); report.put("scope", scope);
    try {
      var turn = new AgentTurn(ExecutionRepository.INITIAL_EXECUTION_CONTRACT, session.id(), question,
          null, null, Map.of(), Map.of(), Instant.parse("2026-10-04T00:00:00Z"));
      var result = app.getBean(EasyVSemanticAgent.class).execute(worker, turn, execution, ontology, dataset.publicationId(), scope,
          "trace-" + id, job.workerId(), ExecutionProgress.NOOP);
      var trace = EasyVAgentTools.readTrace(((Map<?, ?>) result.plan().get("_resolvedContext")).get("toolCalls"));
      report.put("toolCalls", trace); report.put("conclusion", result.conclusion());
      report.put("renderBlocks", result.renderBlocks());
      Set<String> tools = new HashSet<>(); trace.forEach(call -> tools.add((String) call.get("tool")));
      assertTrue(tools.containsAll(requiredTools), () -> "缺少请求所需工具：" + tools);
      assertFalse(tools.contains("query_metrics"), "这些对象问题不应绕到不可用的 Cube 查询");
      for (var call : trace) for (var raw : (List<?>) call.get("references")) {
        var reference = json.map(json.write(raw));
        assertEquals(Map.of("easyv-prototype-layout", "app-16", "easyv-prototype-block", "16:page-1__b_1",
            "easyv-prototype-component", "16:c1").get(reference.get("objectKey")), reference.get("objectId"),
            "必须逐项匹配用户 16 的实际源对象 ID，不能返回用户 17 的对象");
        assertEquals(dataset.productVersionIds().get(reference.get("objectKey")), reference.get("productVersionId"));
      }
      if (id.equals("objects-relations")) {
        Set<Object> types = new HashSet<>();
        trace.forEach(call -> ((List<?>) call.get("references")).forEach(ref -> types.add(json.map(json.write(ref)).get("objectKey"))));
        assertTrue(types.containsAll(Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component")),
            "必须读到真实版式、区域和组件，只有工具调用名称不算验收通过");
      }
      if (expected != null && !expected.equals("empty")) {
        var block = result.renderBlocks().stream().filter(b -> b.get("type").equals("scheme-comparison")).findFirst().orElseThrow();
        var assessment = (Map<?, ?>) block.get("result");
        assertEquals(expected, assessment.get(expected.equals("evaluated") ? "status" : "reason"));
        if (expected.equals("evaluated")) {
          var comparison = (Map<?, ?>) assessment.get("comparison");
          var candidates = (List<?>) comparison.get("candidates");
          assertEquals(2, candidates.size());
          assertTrue(candidates.stream().anyMatch(candidate -> ((Map<?, ?>) candidate).get("score") instanceof Number));
        }
      }
      if ("empty".equals(expected)) {
        assertEquals(1, result.evidence().size());
        assertEquals(0, result.evidence().getFirst().rows().getFirst().get("resultRows"));
      }
      var children = jdbc.queryForList("select tool_name,status,input::text,output::text from platform.agent_invocations where execution_id=? and kind='subtool' order by input->>'id'", execution);
      assertEquals(trace.size(), children.size());
      assertTrue(children.stream().allMatch(child -> child.get("status").equals("completed")));
      for (var child : children) {
        var input = json.map(child.get("input"));
        assertEquals(dataset.productVersionIds(), input.get("productVersions"));
        assertEquals(Map.of("all", false, "values", Map.of("userId", List.of("16"))), input.get("scope"));
      }
      report.put("audit", children); report.put("pass", true);
    } catch (RuntimeException | AssertionError failure) {
      report.put("pass", false); report.put("error", failure.toString());
    } finally {
      report.put("planningDecisions", List.copyOf(decisions));
      executions.fail(execution, job.workerId(), "TEST_END", "isolated evaluation cleanup", "trace-" + id);
    }
    System.out.printf("EasyV object tool eval: %s pass=%s%n", id, report.get("pass"));
    return report;
  }

  private long account(String account, String role) {
    long id = jdbc.queryForObject("insert into identity.accounts(account,display_name,organization_id) values (?,?,'tool-eval') returning id", Long.class, account, account);
    jdbc.update("insert into identity.role_grants(account_id,role_code) values (?,?)", id, role);
    return id;
  }

  DatasetVersionSet publish(String run, boolean empty) {
    var persistence = app.getBean(IngestionPersistencePort.class);
    var catalog = app.getBean(SourceCatalogPort.class).loadActiveSource("easyv");
    var codec = app.getBean(SourceBatchCodec.class);
    persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(run, "easyv", IngestionRun.Mode.FULL,
        IngestionRun.TriggerType.BOOTSTRAP, "test", "trace-" + run, Map.of("fixture", run)));
    persistence.startSourceRun(run);
    Map<String, String> sources = new LinkedHashMap<>();
    persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(run, catalog.datasets().stream().map(dataset -> {
      String version = run + "-" + dataset.datasetKey(); sources.put(dataset.datasetKey(), version);
      return new IngestionPersistencePort.SourceDatasetReservation(version, dataset.datasetKey(), null, Map.of("fixture", run), dataset.schemaVersion());
    }).toList()));
    List<IngestionPersistencePort.SourceDatasetPublication> publications = new ArrayList<>();
    for (var dataset : catalog.datasets()) {
      List<SourceRow> rows = empty ? List.of() : fixture(dataset);
      var receipts = rows.isEmpty() ? List.<IngestionPersistencePort.SourceBatchReceipt>of() : List.of(persistence.appendSourceBatch(
          new IngestionPersistencePort.SourceBatchAppend(sources.get(dataset.datasetKey()), 1, rows.size(), codec.encode(dataset, rows))));
      publications.add(new IngestionPersistencePort.SourceDatasetPublication(dataset.datasetKey(), receipts.size(), rows.size(),
          SourceBatchManifest.aggregate(receipts).contentHash(), Map.of("complete", true)));
    }
    persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(run, publications));
    var products = new TreeSet<>(EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS);
    products.addAll(Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component", "easyv-scheme-library"));
    Map<String, String> versions = new LinkedHashMap<>();
    for (String key : products) {
      var product = app.getBean(ProductCatalogPort.class).loadActiveProduct(key).product();
      Map<String, String> inputs = new LinkedHashMap<>();
      product.inputs().forEach(input -> inputs.put(input.inputKey(), sources.get(input.datasetKey())));
      versions.put(key, app.getBean(ProductMaterializer.class).materialize(new ProductMaterializer.Command(run + "-run-" + key, key,
          run + "-version-" + key, ProductMaterializationRun.Mode.FULL, ProductMaterializationRun.TriggerType.BOOTSTRAP,
          "test", "trace-" + run, inputs)).id());
    }
    if (!empty) {
      assertEquals(2, jdbc.queryForObject("select count(*) from facts.easyv_prototype_layout where product_version_id=? and parse_status='ok'", Integer.class, versions.get("easyv-prototype-layout")));
      assertEquals(2, jdbc.queryForObject("select count(*) from facts.easyv_prototype_block where product_version_id=?", Integer.class, versions.get("easyv-prototype-block")));
      assertEquals(2, jdbc.queryForObject("select count(*) from facts.easyv_prototype_component where product_version_id=?", Integer.class, versions.get("easyv-prototype-component")));
    }
    return persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication(run + "-set", versions, Instant.now(), "test"));
  }

  private List<SourceRow> fixture(DatasetDefinition dataset) {
    var time = LocalDateTime.parse("2026-10-01T09:00:00");
    List<Map<String, Object>> rows = new ArrayList<>();
    if (dataset.datasetKey().equals("easyv-ai-application")) for (long user : List.of(16L, 17L)) {
      Map<String, Object> row = new LinkedHashMap<>(Map.of("id", user, "app_id", "app-" + user, "user_id", user,
          "space_id", 1L, "team_id", 1L, "scope_type", "USER", "create_time", time, "update_time", time, "is_delete", "0"));
      rows.add(row);
    }
    if (dataset.datasetKey().equals("easyv-prototype-task")) for (long user : List.of(16L, 17L)) {
      var component = Map.of("id", "c1", "chartFamily", "line", "config", Map.of("relativeX", "0%", "relativeY", "0%", "width", "100%", "height", "100%"));
      var block = Map.of("schemeId", "39", "title", "", "boundMetricIds", List.of("m1"), "components", List.of(component));
      rows.add(Map.of("id", user, "app_id", "app-" + user, "create_time", time, "update_time", time,
          "screen_prototype_json", Map.of("page-1", Map.of("blocks", Map.of("page-1__b_1", block), "contents", List.of())),
          "screen_structure_xml", "<Pages><Page id='page-1' width='1200' height='800'><Layout grid-direction='horizontal'><Block id='page-1__b_1' block_type_id='3' span='12/12'/></Layout></Page></Pages>"));
    }
    if (dataset.datasetKey().equals("easyv-block-scheme")) for (int id : List.of(39, 40)) rows.add(Map.of("id", id, "chat_count", 1,
        "block_type_id", "3", "pattern_tag", "main", "block_slots_data",
        "[{\"block_internal_id\":\"1\",\"role\":\"main\",\"weight\":1,\"position\":{\"col\":1,\"row\":1,\"colSpan\":12,\"rowSpan\":12},\"config\":{\"x\":\"0%\",\"y\":\"0%\",\"width\":\"100%\",\"height\":\"100%\"}}]"));
    if (dataset.datasetKey().equals("easyv-slot-type")) rows.add(Map.of("id", 1, "recommend_type", "[\"基础图表类\"]", "allowed_chart_categories", "[\"chart\"]"));
    return rows.stream().map(row -> new SourceRow(dataset.columnContract().stream().map(column -> row.get(column.name())).toList())).toList();
  }
}
