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
