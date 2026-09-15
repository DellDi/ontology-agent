package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.easyv.internal.application.EasyVQuestionAnalyst;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVQueryCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClient;

class EasyVSpringAiQuestionAnalystTest {
  private final ChatClient.Builder builder = mock(ChatClient.Builder.class);
  private final ChatClient chat = mock(ChatClient.class);
  private final ChatClient.ChatClientRequestSpec prompt = mock(ChatClient.ChatClientRequestSpec.class);
  private final ChatClient.CallResponseSpec response = mock(ChatClient.CallResponseSpec.class);
  private EasyVSpringAiQuestionAnalyst analyst;

  @BeforeEach
  void setUp() {
    when(builder.build()).thenReturn(chat);
    when(chat.prompt()).thenReturn(prompt);
    when(prompt.system(anyString())).thenReturn(prompt);
    when(prompt.user(anyString())).thenReturn(prompt);
    when(prompt.call()).thenReturn(response);
    analyst = new EasyVSpringAiQuestionAnalyst(builder, new JsonCodec());
  }

  @Test
  void plannerKeepsOnlyPublishedKeysAndDeduplicates() {
    when(response.content()).thenReturn(
        "{\"queries\":[\"user-count\",\"bogus-key\",\"user-first-active\",\"user-count\"]}");
    assertEquals(List.of("user-count", "user-first-active"),
        analyst.planQueries("多少用户", EasyVQueryCatalog.all()));
  }

  @Test
  void plannerRetriesOnceOnInvalidJsonThenSucceeds() {
    AtomicInteger calls = new AtomicInteger();
    when(response.content()).thenAnswer(invocation ->
        calls.incrementAndGet() == 1 ? "not json" : "{\"queries\":[\"user-count\"]}");
    assertEquals(List.of("user-count"), analyst.planQueries("多少用户", EasyVQueryCatalog.all()));
    assertEquals(2, calls.get());
  }

  @Test
  void plannerFailsLoudlyAfterTwoInvalidOutputs() {
    when(response.content()).thenReturn("garbage").thenReturn("{\"queries\":[]}");
    BackendException error = assertThrows(BackendException.class,
        () -> analyst.planQueries("多少用户", EasyVQueryCatalog.all()));
    assertEquals("EASYV_PLAN_INVALID", error.code());
  }

  @Test
  void composerParsesAnswerAndConvergesHighlights() {
    when(response.content()).thenReturn(
        "{\"answer\":\"有 3 个用户\","
            + "\"highlights\":[{\"key\":\"user-first-active\",\"viz\":\"table\"},"
            + "{\"key\":\"unknown-key\",\"viz\":\"bar\"},"
            + "{\"key\":\"user-count\",\"viz\":\"pie\"}]}");
    List<EasyVQuestionAnalyst.QueryResult> results = List.of(
        new EasyVQuestionAnalyst.QueryResult(
            EasyVQueryCatalog.require("user-count"), List.of(Map.of("user_count", 3))),
        new EasyVQuestionAnalyst.QueryResult(
            EasyVQueryCatalog.require("user-first-active"),
            List.of(Map.of("label", "101", "value", "2026-09-07 10:00:00"))));
    EasyVQuestionAnalyst.ComposedAnswer answer =
        analyst.composeAnswer("多少用户", "全部已采集数据", results);
    assertEquals("有 3 个用户", answer.markdown());
    // unknown-key 剔除；record 形状的 user-count 不允许图表，收敛为 table
    assertEquals(List.of(
        new EasyVQuestionAnalyst.Highlight("user-first-active", "table"),
        new EasyVQuestionAnalyst.Highlight("user-count", "table")), answer.highlights());
  }

  @Test
  void composerFailsLoudlyWhenAnswerMissing() {
    when(response.content()).thenReturn("{\"answer\":\"\"}").thenReturn("{}");
    assertThrows(BackendException.class,
        () -> analyst.composeAnswer("多少用户", "全部", List.of()));
  }
}
