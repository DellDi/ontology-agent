package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
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
import reactor.core.publisher.Flux;

class EasyVSpringAiAnalysisModelTest {
  private final ChatClient.Builder builder = mock(ChatClient.Builder.class);
  private final ChatClient chat = mock(ChatClient.class);
  private final ChatClient.ChatClientRequestSpec prompt = mock(ChatClient.ChatClientRequestSpec.class);
  private final ChatClient.CallResponseSpec response = mock(ChatClient.CallResponseSpec.class);
  private final ChatClient.StreamResponseSpec stream = mock(ChatClient.StreamResponseSpec.class);
  private EasyVSpringAiAnalysisModel model;

  @BeforeEach
  void setUp() {
    when(builder.build()).thenReturn(chat);
    when(chat.prompt()).thenReturn(prompt);
    when(prompt.system(anyString())).thenReturn(prompt);
    when(prompt.user(anyString())).thenReturn(prompt);
    when(prompt.call()).thenReturn(response);
    when(prompt.stream()).thenReturn(stream);
    model = new EasyVSpringAiAnalysisModel(builder, new JsonCodec());
  }

  @Test
  void readyPlanReturnsRawQueriesAndSendsViolationsForCorrection() {
    when(response.content()).thenReturn("""
        说明文字 {"status":"ready","queries":[{"object":"easyv-forge-task","measures":["count"]}]}
        """);

    PlanDecision decision = model.plan(request(List.of("查询 q1：measures 至少一个根对象指标")));

    assertEquals(PlanStatus.READY, decision.status());
    assertEquals(List.of(Map.of("object", "easyv-forge-task", "measures", List.of("count"))), decision.queries());
    ArgumentCaptor<String> user = ArgumentCaptor.forClass(String.class);
    verify(prompt).user(user.capture());
    assertTrue(user.getValue().contains("violations"));
    assertTrue(user.getValue().contains("anchorDate"));
  }

  @Test
  void clarifyAndUnsupportedDecisionsCarryMessages() {
    when(response.content())
        .thenReturn("{\"status\":\"clarify\",\"question\":\"指哪一周？\",\"options\":[\"本周\",\"上周\"]}")
        .thenReturn("{\"status\":\"unsupported\",\"reason\":\"没有用户注册时间\"}");

    PlanDecision clarify = model.plan(request(List.of()));
    PlanDecision unsupported = model.plan(request(List.of()));

    assertEquals(new PlanDecision(PlanStatus.CLARIFY, List.of(), "指哪一周？", List.of("本周", "上周")), clarify);
    assertEquals(PlanStatus.UNSUPPORTED, unsupported.status());
    assertEquals("没有用户注册时间", unsupported.message());
  }

  @Test
  void invalidPlanOutputFailsWithPlanInvalid() {
    when(response.content()).thenReturn("garbage").thenReturn("{\"status\":\"maybe\"}")
        .thenReturn("{\"status\":\"ready\"}");

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

    ComposedAnswer answer = model.compose(new ComposeRequest("成功率？", "全部数据", List.of(), List.of()),
        partials::add);

    assertEquals("成功率 66.67%", answer.markdown());
    assertEquals(List.of(new Citation("q1", 0, "successRate")), answer.citations());
    assertEquals(List.of(new Highlight("q1", "bar")), answer.highlights());
    assertEquals(List.of("a", "b", "c"), answer.suggestions());
    assertEquals(1, answer.actions().size());
    assertEquals("成功率 66.67%", partials.getLast());
  }

  @Test
  void composeWithoutAnswerFailsWithAnswerInvalid() {
    when(stream.content()).thenReturn(Flux.just("{\"citations\":[]}"));

    assertEquals("EASYV_ANSWER_INVALID", assertThrows(BackendException.class,
        () -> model.compose(new ComposeRequest("q", "全部数据", List.of(), List.of()), text -> { })).code());
  }

  @Test
  void providerFailuresAreWrapped() {
    when(response.content()).thenThrow(new IllegalStateException("boom"));

    assertEquals("AGENT_PROVIDER_FAILURE",
        assertThrows(BackendException.class, () -> model.plan(request(List.of()))).code());
  }

  private static PlanRequest request(List<String> violations) {
    return new PlanRequest("EasyV 生成任务数", List.of(Map.of("object", "easyv-forge-task")), "2026-09-28",
        "Asia/Shanghai", Map.of(), List.of(), violations);
  }
}
