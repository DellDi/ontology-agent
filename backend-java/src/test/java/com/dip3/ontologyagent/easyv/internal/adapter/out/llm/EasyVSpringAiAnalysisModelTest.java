package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Citation;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposeRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposedAnswer;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.Highlight;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanDecision;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanStatus;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService.ObjectTypeView;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService.PropertyView;
import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import reactor.core.publisher.Flux;

class EasyVSpringAiAnalysisModelTest {
  private final ChatClient.Builder builder = mock(ChatClient.Builder.class);
  private final ChatClient chat = mock(ChatClient.class);
  private final ChatClient.ChatClientRequestSpec prompt = mock(ChatClient.ChatClientRequestSpec.class);
  private final ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
  private EasyVSpringAiAnalysisModel model;

  @BeforeEach
  void setUp() {
    when(builder.build()).thenReturn(chat);
    when(chat.prompt()).thenReturn(prompt);
    when(prompt.options(any(OpenAiChatOptions.Builder.class))).thenReturn(prompt);
    when(prompt.system(anyString())).thenReturn(prompt);
    when(prompt.user(anyString())).thenReturn(prompt);
    when(prompt.stream()).thenReturn(stream);
    model = new EasyVSpringAiAnalysisModel(builder, new JsonCodec());
  }

  @Test
  void readyPlanReturnsRawQueriesAndSendsViolationsForCorrection() {
    when(stream.content()).thenReturn(Flux.just("""
        说明文字 {"status":"ready","calls":[{"tool":"query_metrics","input":{"intent":{"object":"easyv-forge-task","measures":["count"]}}}]}
        """));

    PlanDecision decision = model.plan(request(List.of("查询 q1：measures 至少一个根对象指标")));

    assertEquals(PlanStatus.READY, decision.status());
    assertEquals(List.of(Map.of("tool", "query_metrics", "input", Map.of("intent", Map.of("object", "easyv-forge-task", "measures", List.of("count"))))), decision.calls());
    ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
    verify(prompt).user(user.capture());
    assertTrue(user.getValue().contains("violations"));
    assertTrue(user.getValue().contains("anchorDate"));
    var options = ArgumentCaptor.forClass(OpenAiChatOptions.Builder.class);
    verify(prompt).options(options.capture());
    assertEquals(OpenAiChatModel.ResponseFormat.Type.JSON_OBJECT, options.getValue().build().getResponseFormat().getType());
  }

  @Test
  void clarifyAndUnsupportedDecisionsCarryMessages() {
    when(stream.content())
        .thenReturn(Flux.just("{\"status\":\"clarify\",\"question\":\"指哪一周？\",\"options\":[\"本周\",\"上周\"]}"))
        .thenReturn(Flux.just("{\"status\":\"unsupported\",\"reason\":\"没有用户注册时间\"}"));

    PlanDecision clarify = model.plan(request(List.of()));
    PlanDecision unsupported = model.plan(request(List.of()));

    assertEquals(new PlanDecision(PlanStatus.CLARIFY, List.of(), "指哪一周？", List.of("本周", "上周")), clarify);
    assertEquals(PlanStatus.UNSUPPORTED, unsupported.status());
    assertEquals("没有用户注册时间", unsupported.message());
  }

  @Test
  void invalidPlanOutputFailsWithPlanInvalid() {
    when(stream.content()).thenReturn(Flux.just("garbage")).thenReturn(Flux.just("{\"status\":\"maybe\"}"))
        .thenReturn(Flux.just("{\"status\":\"ready\"}"));

    for (int attempt = 0; attempt < 3; attempt += 1) {
      assertEquals("EASYV_PLAN_INVALID",
          assertThrows(BackendException.class, () -> model.plan(request(List.of()))).code());
    }
  }

  @Test
  void composeStreamsAnswerAndParsesCitationsHighlightsAndSuggestions() {
    when(stream.content()).thenReturn(Flux.just(
        "{\"answer\":\"成功率 66.67%",
        "\",\"citations\":[{\"query\":\"q1\",\"row\":0,\"field\":\"successRate\"},{\"query\":\"q1\"}],",
        "\"highlights\":[{\"query\":\"q1\",\"viz\":\"BAR\"}],\"suggestions\":[\"a\",\"b\",\"c\",\"d\"],",
        "\"suggestedActions\":[{\"label\":\"排查失败\",\"rationale\":\"失败 1 次\"},{\"label\":\"x\"}]}"));
    List<String> partials = new ArrayList<>();

    ComposedAnswer answer = model.compose(new ComposeRequest("成功率？", "全部数据", List.of(), List.of(), 1000),
        partials::add);

    assertEquals("成功率 66.67%", answer.markdown());
    assertEquals(List.of(new Citation("q1", 0, "successRate")), answer.citations());
    assertEquals(List.of(new Highlight("q1", "bar")), answer.highlights());
    assertEquals(List.of("a", "b", "c"), answer.suggestions());
    assertEquals(1, answer.actions().size());
    assertEquals("成功率 66.67%", partials.getLast());
  }

  @Test
  void composeKeepsReadOriginalTextAsRealLinesWithoutAddingAModelCall() {
    String original = "CPU 利用率：环形占比图，模拟数据\n内存利用率：环形占比图，模拟数据\n存储利用率：数值总览";
    var results = List.<Map<String, Object>>of(
        Map.of("id", "q1", "tool", "list_objects", "rows", List.of(Map.of("count", 50))),
        Map.of("id", "q2", "tool", "read_object", "rows", List.of(Map.of("userInput", original))));
    when(stream.content()).thenReturn(Flux.just("{\"answer\":\"CPU 和内存的图表要求已写明；存储未写明图表形式\",\"citations\":[]}"));
    model.compose(new ComposeRequest("需求有什么差异？", "所选应用", results, List.of(), 1000), ignored -> {});
    var input = ArgumentCaptor.forClass(String.class);
    verify(prompt).user(input.capture());
    assertTrue(input.getValue().endsWith(original));
    assertTrue(input.getValue().contains("引用来源 q2，行 0，字段 userInput"));
    verify(stream).content();
  }

  @Test
  void malformedAnswerPreservesParseReasonAndLocationForTheExistingCorrectionTurn() {
    when(stream.content()).thenReturn(Flux.just("{\"answer\":\"第一行\n第二行\",\"citations\":[]}"));
    var error = assertThrows(BackendException.class,
        () -> model.compose(new ComposeRequest("q", "全部数据", List.of(), List.of(), 1000), text -> { }));
    assertEquals("EASYV_ANSWER_INVALID", error.code());
    assertTrue(error.getMessage().contains("CTRL-CHAR"));
    assertTrue(error.getMessage().contains("第 1 行"));
    assertNotNull(error.getCause());
  }

  @Test
  void readTextCannotReintroduceFalseSummaryEvenWithAnExactDisplayedQuote() {
    String original = "CPU：环形图\n存储：数值总览";
    when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of(
        "answer", "每项都要求环形图。\n" + original,
        "citations", List.of(Map.of("query", "q1", "row", 0, "field", "requestText", "quote", original))))));
    var partials = new ArrayList<String>();
    var error = assertThrows(BackendException.class, () -> model.compose(textRequest(original), partials::add));
    assertEquals("EASYV_ANSWER_INVALID", error.code());
    assertTrue(error.getMessage().contains("禁止自由摘要"));
    assertTrue(partials.isEmpty());
    verify(stream).content();
  }

  @Test
  void reviewRendersExactDemandCountsAndSaveRecordsWithoutFreeParaphrase() {
    var results = reviewResults();
    when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer", reviewSpec()))));
    var result = model.compose(new ComposeRequest("最初要做什么，后来改了什么，有没有另存？", "本地快照", results, List.of(), 1000), ignored -> {});
    assertTrue(result.markdown().contains("> CPU：环形图  \n> 存储：数值总览"));
    assertTrue(result.markdown().contains("| 修改 | 新增模块 | 2 |"));
    assertTrue(result.markdown().contains("| 修改 | 删除模块 | 1 |"));
    assertTrue(result.markdown().contains("2026-09-21 15:11:39（北京时间） | 是"));
    assertTrue(result.markdown().contains("2026-09-21 15:26:14（北京时间） | 否"));
    assertTrue(result.markdown().contains("本次读到的 3 条记录"));
    assertTrue(result.markdown().contains("不能据此确认最终版本是否另存"));
    assertTrue(result.markdown().contains("数据范围：本地快照"));
    assertTrue(result.citations().contains(new Citation("q1", 0, "requestText")));
    assertTrue(result.citations().contains(new Citation("q3", 0, "saved")));
    assertTrue(!result.markdown().contains("ADD") && !result.markdown().contains("internal-id"));
    verify(stream).content();
  }

  @Test
  void ordinaryObjectPropertiesKeepTheirExistingAnswerWithoutBeingMistakenForSourceText() {
    var type = new ObjectTypeView("component", "组件", List.of(
        new PropertyView("name", "名称", Type.STRING, false, true, true, Map.of()),
        new PropertyView("width", "宽度", Type.NUMBER, false, false, true, Map.of())), List.of());
    var results = List.<Map<String, Object>>of(Map.of("id", "q1", "tool", "read_object", "objectType", type,
        "textFields", List.of(), "rows", List.of(Map.of("name", "容量概览", "width", 24))));
    when(stream.content()).thenReturn(Flux.just("{\"answer\":\"宽度为 24\",\"citations\":[{\"query\":\"q1\",\"row\":0,\"field\":\"width\"}]}"));
    var partials = new ArrayList<String>();
    assertEquals("宽度为 24", model.compose(new ComposeRequest("组件多宽？", "当前组件", results, List.of(), 1000), partials::add).markdown());
    assertEquals("宽度为 24", partials.getLast());
  }

  @Test
  void unknownClassificationCannotMasqueradeAsAnOriginalTextExcerpt() {
    var results = new ArrayList<>(reviewResults());
    results.add(Map.of("id", "q4", "tool", "read_object", "textFields", List.of(), "objectType",
        new ObjectTypeView("record", "记录", List.of(new PropertyView("audience", "受众", Type.STRING, false, false, false, Map.of())), List.of()),
        "rows", List.of(Map.of("audience", "operational"))));
    when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer", Map.of("kind", "record-review", "sections", List.of(excerpt(),
        Map.of("kind", "excerpt", "source", Map.of("query", "q4", "row", 0, "field", "audience", "quote", "operational"))))))));
    assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
        () -> model.compose(new ComposeRequest("回看", "当前对象", results, List.of(), 1000), ignored -> {})).code());
  }

  @Test
  void reviewDoesNotPublishUnverifiedActionClaimsOutsideTheValidatedRecordBody() {
    when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer", reviewSpec(),
        "suggestedActions", List.of(Map.of("label", "全部改成环形图", "rationale", "三个指标均要求环形图"))))));
    assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
        () -> model.compose(new ComposeRequest("回看", "当前对象", reviewResults(), List.of(), 1000), ignored -> {})).code());
    var system = ArgumentCaptor.forClass(String.class);
    verify(prompt).system(system.capture());
    assertTrue(system.getValue().contains("原文对照与记录回看必须使用 citations=[]、highlights=[]、suggestedActions=[]"));
    assertTrue(system.getValue().contains("普通统计回答的 suggestedActions"));
  }

  @Test
  void reviewRejectsSummaryHiddenTextIdentifiersFabricatedRowsAndMissingExcerpts() {
    var specs = List.of(
        Map.of("kind", "record-review", "sections", List.of(excerpt()), "summary", "每项都是环形图"),
        Map.of("kind", "record-review", "sections", List.of(excerpt(), Map.of("kind", "records", "query", "q1", "fields", List.of("requestText"), "rows", List.of(0)))),
        Map.of("kind", "record-review", "sections", List.of(excerpt(), Map.of("kind", "records", "query", "q3", "fields", List.of("id"), "rows", List.of(0)))),
        Map.of("kind", "record-review", "sections", List.of(excerpt(), Map.of("kind", "records", "query", "q3", "fields", List.of("saved"), "rows", List.of(9)))),
        Map.of("kind", "record-review", "sections", List.of(excerpt(), Map.of("kind", "records", "query", "q3", "fields", List.of("saved"), "rows", List.of(0.5)))),
        Map.of("kind", "record-review", "sections", List.of(excerpt(), Map.of("kind", "records", "query", "q3", "fields", List.of("saved"), "rows", List.of(0,0)))),
        Map.of("kind", "record-review", "sections", List.of(Map.of("kind", "counts", "query", "q2", "fields", List.of("intent")))));
    for (var spec : specs) {
      when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer", spec))));
      assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
          () -> model.compose(new ComposeRequest("回看", "当前对象", reviewResults(), List.of(), 1000), ignored -> {})).code());
    }
  }

  @Test
  void reviewRejectsInventedSplicedOrMissingQuotes() {
    for (String quote : List.of("存储：环形图", "CPU：环形图；存储：数值总览", "")) {
      var source = Map.of("query", "q1", "row", 0, "field", "requestText", "quote", quote);
      when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer",
          Map.of("kind", "record-review", "sections", List.of(Map.of("kind", "excerpt", "source", source)))))));
      assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
          () -> model.compose(textRequest("CPU：环形图\n存储：数值总览"), ignored -> {})).code());
    }
  }

  private static Map<String, Object> excerpt() {
    return Map.of("kind", "excerpt", "source", Map.of("query", "q1", "row", 0, "field", "requestText", "quote", "CPU：环形图\n存储：数值总览"));
  }

  private static Map<String, Object> reviewSpec() {
    return Map.of("kind", "record-review", "sections", List.of(excerpt(),
        Map.of("kind", "counts", "query", "q2", "fields", List.of("phase", "intent")),
        Map.of("kind", "records", "query", "q3", "fields", List.of("recordedAt", "saved"), "rows", List.of(0,1))));
  }

  private static List<Map<String, Object>> reviewResults() {
    var results = new ArrayList<>(textRequest("CPU：环形图\n存储：数值总览").results());
    results.add(Map.of("id", "q2", "tool", "query_objects", "objectType", new ObjectTypeView("records", "处理记录", List.of(
        new PropertyView("phase", "阶段", Type.STRING, false, false, false, Map.of("EDIT", "修改")),
        new PropertyView("intent", "系统识别的诉求", Type.STRING, false, false, false, Map.of("ADD", "新增模块", "REMOVE", "删除模块"))), List.of()),
        "hasMore", true, "rows", List.of(Map.of("phase", "EDIT", "intent", "ADD"), Map.of("phase", "EDIT", "intent", "ADD"), Map.of("phase", "EDIT", "intent", "REMOVE"))));
    results.add(Map.of("id", "q3", "tool", "query_objects", "objectType", new ObjectTypeView("records", "操作反馈", List.of(
        new PropertyView("id", "标识", Type.STRING, true, false, false, Map.of()),
        new PropertyView("recordedAt", "操作记录时间", Type.TIME, false, false, false, Map.of()),
        new PropertyView("saved", "是否另存编辑", Type.BOOLEAN, false, false, false, Map.of())), List.of()),
        "rows", List.of(Map.of("id", "internal-id", "recordedAt", "2026-09-21T07:11:39Z", "saved", true),
            Map.of("id", "internal-id", "recordedAt", "2026-09-21T07:26:14Z", "saved", false))));
    return results;
  }

  @Test
  void identifierTimeAndClassifiedValuesDoNotForceRawCodesIntoTheAnswer() {
    var type = new ObjectTypeView("business-object", "业务对象", List.of(
        new PropertyView("id", "对象标识", Type.STRING, true, false, false, Map.of()),
        new PropertyView("recordedAt", "记录时间", Type.TIME, false, false, false, Map.of()),
        new PropertyView("status", "状态", Type.STRING, false, false, false, Map.of("DONE", "已完成"))), List.of());
    var results = List.<Map<String, Object>>of(Map.of("id", "q1", "tool", "read_object", "objectType", type,
        "rows", List.of(Map.of("id", "internal-id", "recordedAt", "2026-10-11T00:00:00Z", "status", "DONE"))));
    when(stream.content()).thenReturn(Flux.just("""
        {"answer":"业务对象在北京时间 10 月 11 日 08:00 记录为已完成。",
         "citations":[{"query":"q1","row":0,"field":"id"},{"query":"q1","row":0,"field":"recordedAt"},{"query":"q1","row":0,"field":"status"}]}
        """));
    assertEquals(3, model.compose(new ComposeRequest("查看对象", "当前对象", results, List.of(), 1000), ignored -> {}).citations().size());
  }

  private static ComposeRequest textRequest(String original) {
    var type = new ObjectTypeView("business-object", "业务对象", List.of(
        new PropertyView("requestText", "原话", Type.STRING, false, false, false, Map.of())), List.of());
    return new ComposeRequest("需求有什么差异？", "当前对象", List.of(Map.of("id", "q1", "tool", "read_object",
        "objectType", type, "textFields", List.of("requestText"), "rows", List.of(Map.of("requestText", original)))), List.of(), 1000);
  }

  @Test
  void sourceComparisonRendersOnlyVerifiedExcerptsWithOntologyLabelsAndResolvedCitations() {
    String original = "CPU：环形图\n存储：数值总览\n```\n<script>按原文显示</script>";
    var results = new ArrayList<>(textRequest(original).results());
    results.add(Map.of("id", "q2", "tool", "read_object", "objectType",
        new ObjectTypeView("business-object", "业务对象", List.of(
            new PropertyView("recordText", "理解记录", Type.STRING, false, false, false, Map.of())), List.of()),
        "textFields", List.of("recordText"), "rows", List.of(Map.of("recordText", "资源容量监控：CPU、内存、存储"))));
    when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of(
        "answer", Map.of("kind", "source-comparison", "pairs", List.of(Map.of(
            "left", Map.of("query", "q1", "row", 0, "field", "requestText", "quote", original),
            "right", Map.of("query", "q2", "row", 0, "field", "recordText", "quote", "资源容量监控：CPU、内存、存储"))))))));
    var partials = new ArrayList<String>();
    var result = model.compose(new ComposeRequest("对照两份记录", "当前对象", results, List.of(), 1000), partials::add);
    assertTrue(result.markdown().contains("**原话**\n\n> CPU：环形图  \n> 存储：数值总览"));
    assertTrue(result.markdown().contains("\\`\\`\\`"));
    assertTrue(result.markdown().contains("&lt;script&gt;按原文显示&lt;/script&gt;"));
    assertTrue(result.markdown().contains("**理解记录**"));
    assertTrue(result.markdown().contains("不能据此直接认定理解错误"));
    assertEquals(List.of(new Citation("q1", 0, "requestText"), new Citation("q2", 0, "recordText")), result.citations());
    assertTrue(partials.isEmpty());
    verify(stream).content();
  }

  @Test
  void sourceComparisonRejectsFreeSummaryAndFabricatedSourceRanges() {
    var source = Map.of("query", "q1", "row", 0, "field", "requestText", "quote", "存储：环形图");
    for (var spec : List.of(
        Map.of("kind", "source-comparison", "pairs", List.of(Map.of("left", source, "right", source)), "summary", "每项都是环形图"),
        Map.of("kind", "source-comparison", "pairs", List.of(Map.of("left", source, "right", source))))) {
      when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer", spec))));
      assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
          () -> model.compose(textRequest("CPU：环形图\n存储：数值总览"), ignored -> {})).code());
    }
    when(stream.content()).thenReturn(Flux.just(new JsonCodec().write(Map.of("answer",
        Map.of("kind", "source-comparison", "pairs", List.of(Map.of("left", source, "right", source)))))));
    assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
        () -> model.compose(textRequest(""), ignored -> {})).code());
  }

  @Test
  void composeWithoutAnswerFailsWithAnswerInvalid() {
    when(stream.content()).thenReturn(Flux.just("{\"citations\":[]}"));

    assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
        () -> model.compose(new ComposeRequest("q", "全部数据", List.of(), List.of(), 1000), text -> { })).code());
  }

  @Test
  void providerFailuresAreWrapped() {
    when(stream.content()).thenThrow(new IllegalStateException("boom"));

    assertEquals("AGENT_PROVIDER_FAILURE",
        assertThrows(BackendException.class, () -> model.plan(request(List.of()))).code());
  }

  @Test
  void planningReceivesObservedRowsAndExplicitCompletion() {
    when(stream.content()).thenReturn(Flux.just("{\"status\":\"finished\"}"));
    var observations = List.<Map<String, Object>>of(Map.of("id", "q1", "totalRows", 1,
        "rows", List.of(Map.of("count", 3))));
    var request = new PlanRequest("问题", List.of(), "2026-10-04", "Asia/Shanghai", Map.of(), List.of(),
        List.of(), Map.of(), observations, 3, 1000, 8, List.of(), List.of());
    assertEquals(PlanStatus.FINISHED, model.plan(request).status());
    var input = ArgumentCaptor.forClass(String.class); verify(prompt).user(input.capture());
    var parsed = new JsonCodec().map(input.getValue());
    assertEquals(observations, parsed.get("observations"));
    assertEquals(3, parsed.get("remainingQueries"));
  }

  @Test
  void finishedCannotHideAdditionalQueries() {
    when(stream.content()).thenReturn(Flux.just("{\"status\":\"finished\",\"queries\":[]}"));
    assertEquals("EASYV_PLAN_INVALID", assertThrows(BackendException.class, () -> model.plan(request(List.of()))).code());
  }

  @Test
  void planningTimeoutCancelsProviderStream() {
    var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
    when(stream.content()).thenReturn(Flux.<String>never().doOnCancel(() -> cancelled.set(true)));
    var shortRequest = new PlanRequest("问题", List.of(), "2026-10-04", "Asia/Shanghai", Map.of(), List.of(),
        List.of(), Map.of(), List.of(), 4, 20, 8, List.of(), List.of());
    assertEquals("AGENT_EXECUTION_TIMEOUT", assertThrows(BackendException.class, () -> model.plan(shortRequest)).code());
    assertTrue(cancelled.get());
  }

  @Test
  void composeTimeoutCancelsProviderStreamAndDoesNotReturnPartialAnswer() {
    var cancelled = new java.util.concurrent.atomic.AtomicBoolean();
    when(stream.content()).thenReturn(Flux.concat(Flux.just("{\"answer\":\"部分回答"), Flux.<String>never())
        .doOnCancel(() -> cancelled.set(true)));
    assertEquals("AGENT_EXECUTION_TIMEOUT", assertThrows(BackendException.class,
        () -> model.compose(new ComposeRequest("问题", "全部", List.of(), List.of(), 20), ignored -> {})).code());
    assertTrue(cancelled.get());
  }

  private static PlanRequest request(List<String> violations) {
    return new PlanRequest("EasyV 生成任务数", List.of(Map.of("object", "easyv-forge-task")), "2026-09-28",
        "Asia/Shanghai", Map.of(), List.of(), violations, Map.of(), List.of(), 4, 1000, 8, List.of(), List.of());
  }
}
