package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.support.JsonCodec;
import java.net.CookieManager;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** 人工浏览器 live 门禁；正式 Next 页面/BFF/Java/Worker/模型，源仅在隔离库。 */
@EnabledIfEnvironmentVariable(named = "RUN_EASYV_BROWSER_EVAL", matches = "1")
@Testcontainers
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "dip3.worker.enabled=true", "dip3.worker.poll-delay=100ms", "dip3.easyv.enabled=true",
    "dip3.easyv.source.enabled=false", "dip3.property.enabled=false", "dip3.auth.providers.local.enabled=true",
    "dip3.stream.poll-delay=50ms", "dip3.stream.timeout=2m"
})
@ContextConfiguration(initializers = EasyVPlanningEvalIT.RequiredEnvironment.class)
class EasyVBrowserEvalIT {
  @Container static final PostgreSQLContainer POSTGRES = EasyVRuntimeEvalIT.POSTGRES;
  @Container static final GenericContainer<?> REDIS = EasyVRuntimeEvalIT.REDIS;
  @Container static final GenericContainer<?> CUBE = EasyVRuntimeEvalIT.CUBE;
  @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) { EasyVRuntimeEvalIT.properties(registry); }
  @BeforeAll static void migrate() { EasyVRuntimeEvalIT.migrate(); }
  @Autowired ApplicationContext app;
  @LocalServerPort int port;

  @Test
  void browserMetricsObjectsSelectionAndHistory() throws Exception {
    Path root = Path.of("..").toAbsolutePath().normalize();
    Path runtime = root.resolve(".codex-runtime");
    Path done = runtime.resolve("b25-browser-done.json");
    Path ready = runtime.resolve("b25-browser-ready.json");
    Files.deleteIfExists(done); Files.deleteIfExists(ready);
    var json = app.getBean(JsonCodec.class);
    var jdbc = app.getBean(JdbcTemplate.class);
    var fixtures = new EasyVObjectToolEval(app, new ArrayList<>());
    var principal = app.getBean(EasyVScopeResolver.class).executionPrincipal(fixtures.prepareAnalyst("browser-eval"));
    app.getBean(IdentityAccountService.class).resetPassword(Long.parseLong(principal.userId()), "isolated-browser-eval-password");
    var dataset = fixtures.publish("browser-eval-full", false);
    assertTrue(Files.exists(root.resolve(".next/BUILD_ID")), "先构建当前 Web，再启动人工浏览器门禁");
    copyTree(root.resolve(".next/static"), root.resolve(".next/standalone/.next/static"));
    var builder = new ProcessBuilder("node", ".next/standalone/server.js")
        .directory(root.toFile()).redirectErrorStream(true).redirectOutput(runtime.resolve("b25-next.log").toFile());
    builder.environment().put("JAVA_BACKEND_URL", "http://127.0.0.1:" + port);
    builder.environment().put("HOSTNAME", "127.0.0.1"); builder.environment().put("PORT", "3100");
    var web = builder.start();
    // 本地 Next Node HTTP 服务不支持 JDK 默认的 h2c Upgrade；与浏览器一样使用 HTTP/1.1。
    var http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
        .cookieHandler(new CookieManager()).connectTimeout(Duration.ofSeconds(5)).build();
    // 与用户常用的 127.0.0.1:3000 分开 Cookie 域，避免覆盖正式本地登录。
    String base = "http://localhost:3100";
    Map<String, CompletableFuture<HttpResponse<String>>> streams = new LinkedHashMap<>();
    Map<String, Object> report = new LinkedHashMap<>();
    report.put("scope", "manual browser, production Next/BFF/Java/Worker/model; disposable source fixtures");
    report.put("model", System.getenv("LLM_PROVIDER_MODEL"));
    var expected = jdbc.queryForMap("""
        select count(*) as "parsedCount", sum(l.block_count) as "blockTotal", sum(l.component_count) as "componentTotal"
        from facts.easyv_prototype_layout l join facts.easyv_ai_application a on a.app_id=l.app_id
        where l.product_version_id=? and a.product_version_id=? and a.user_id=16 and not a.is_deleted and l.parse_status='ok'
        """, dataset.productVersionIds().get("easyv-prototype-layout"), dataset.productVersionIds().get("easyv-ai-application"));
    report.put("independentSql", expected);
    try {
      Instant startupDeadline = Instant.now().plusSeconds(60);
      while (true) {
        assertTrue(web.isAlive(), "Next 启动失败，见 b25-next.log");
        try {
          var response = http.send(HttpRequest.newBuilder(URI.create(base + "/login")).timeout(Duration.ofSeconds(5)).GET().build(), HttpResponse.BodyHandlers.ofString());
          report.put("startupStatus", response.statusCode());
          if (response.statusCode() == 200) break;
        } catch (java.io.IOException failure) { report.put("startupLastError", failure.toString()); }
        assertTrue(Instant.now().isBefore(startupDeadline), "Next 启动超时");
        Thread.sleep(200);
      }
      var login = http.send(HttpRequest.newBuilder(URI.create(base + "/api/auth/login"))
          .header("Content-Type", "application/x-www-form-urlencoded").POST(HttpRequest.BodyPublishers.ofString(
              "account=browser-eval-analyst&password=isolated-browser-eval-password&next=%2Fworkspace")).build(), HttpResponse.BodyHandlers.ofString());
      assertEquals(303, login.statusCode()); assertEquals("/workspace", login.headers().firstValue("location").orElseThrow());
      Files.writeString(ready, json.write(Map.of("webUrl", base, "javaUrl", "http://127.0.0.1:" + port,
          "account", "browser-eval-analyst", "datasetVersionSetId", dataset.publicationId(), "scope", report.get("scope"))));
      Instant deadline = Instant.now().plus(Duration.ofMinutes(20));
      while (!Files.exists(done)) {
        assertTrue(web.isAlive(), "浏览器验证期间 Next 退出");
        assertTrue(Instant.now().isBefore(deadline), "人工浏览器验证未完成；不自动判定通过");
        for (var execution : jdbc.queryForList("select execution_id,session_id from platform.analysis_execution_snapshots where owner_user_id=? order by created_at", principal.userId())) {
          String id = (String) execution.get("execution_id");
          if (!streams.containsKey(id)) streams.put(id, http.sendAsync(HttpRequest.newBuilder(URI.create(base + "/api/analysis/sessions/"
              + execution.get("session_id") + "/stream?executionId=" + id)).timeout(Duration.ofMinutes(3)).GET().build(), HttpResponse.BodyHandlers.ofString()));
        }
        Thread.sleep(100);
      }
      var observed = json.map(Files.readString(done));
      report.put("browserObservations", observed);
      String session = (String) observed.get("sessionId");
      var repository = app.getBean(ExecutionRepository.class);
      List<Map<String, Object>> rounds = new ArrayList<>();
      for (String key : List.of("rootExecutionId", "selectedExecutionId")) {
        String id = (String) observed.get(key);
        var snapshot = repository.findJavaSnapshot(session, id, principal.userId()).orElseThrow();
        assertEquals("completed", snapshot.status()); assertEquals(dataset.publicationId(), snapshot.datasetVersionSetId());
        var events = repository.listAfter(session, id, principal.userId(), 0);
        var streamed = streams.get(id).get(3, TimeUnit.MINUTES);
        assertEquals(200, streamed.statusCode());
        assertEquals(events.stream().map(event -> "data: " + json.write(event) + "\n\n").collect(Collectors.joining()), streamed.body());
        assertTrue(events.getLast().terminal()); assertEquals("completed", events.getLast().status());
        var audit = jdbc.queryForList("select tool_name,status,input::text,output::text from platform.agent_invocations where execution_id=? order by created_at,id", id);
        assertTrue(audit.stream().allMatch(row -> "completed".equals(row.get("status"))));
        rounds.add(Map.of("snapshot", snapshot, "sseFrames", streamed.body(), "audit", audit));
        if (key.equals("rootExecutionId")) {
          var evidence = json.list(json.write(snapshot.conclusionState().get("evidence")));
          for (String metric : List.of("parsedCount", "blockTotal", "componentTotal")) assertTrue(evidence.stream()
              .filter(item -> String.valueOf(item.get("source")).startsWith("easyv-query:"))
              .flatMap(item -> json.list(json.write(item.get("rows"))).stream())
              .anyMatch(row -> row.get(metric) instanceof Number number && number.longValue() == ((Number) expected.get(metric)).longValue()), "统计与独立 SQL 数量一致：" + metric);
        } else {
          var selection = json.map(json.write(snapshot.planSnapshot().get("_objectSelection")));
          assertEquals(observed.get("rootExecutionId"), selection.get("executionId"));
          assertEquals("16:page-1__b_1", json.map(json.write(selection.get("reference"))).get("objectId"));
          assertTrue(snapshot.resultBlocks().stream().anyMatch(block -> "scheme-comparison".equals(block.get("type"))
              && "evaluated".equals(json.map(json.write(block.get("result"))).get("status"))));
        }
      }
      report.put("rounds", rounds); report.put("pass", true);
      for (String observation : List.of("canvasSelectable", "historyRestored", "narrowNoOverflow", "selectionCancelled")) {
        assertEquals(true, observed.get(observation), "人工浏览器证据未通过：" + observation);
      }
    } catch (Exception | AssertionError failure) {
      report.put("pass", false); report.put("error", failure.toString()); throw failure;
    } finally {
      Files.writeString(runtime.resolve("b25-browser-report.json"), json.write(report));
      web.descendants().forEach(ProcessHandle::destroy); web.destroy();
      if (!web.waitFor(5, TimeUnit.SECONDS)) { web.descendants().forEach(ProcessHandle::destroyForcibly); web.destroyForcibly(); }
      Files.deleteIfExists(ready);
    }
  }

  private static void copyTree(Path source, Path target) throws Exception {
    try (var paths = Files.walk(source)) {
      for (var path : paths.toList()) {
        var destination = target.resolve(source.relativize(path));
        if (Files.isDirectory(path)) Files.createDirectories(destination);
        else Files.copy(path, destination, StandardCopyOption.REPLACE_EXISTING);
      }
    }
  }
}
