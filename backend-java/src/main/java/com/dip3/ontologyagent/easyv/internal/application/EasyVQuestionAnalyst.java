package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.easyv.internal.domain.EasyVQueryCatalog;
import java.util.List;
import java.util.Map;

/**
 * EasyV 受控问答的 LLM 端口：规划查询 key（白名单内）并基于真实查询结果
 * 生成中文回答。实现负责把 LLM 输出收敛到目录内，服务端不再放行未发布 key。
 */
public interface EasyVQuestionAnalyst {

  /**
   * 根据用户问题选择查询 key（只含目录内 key，去重，有序）。实现可对 LLM
   * 失败做一次纠正重试；仍失败时应抛出 BackendException，由工作流决定回退。
   */
  List<String> planQueries(String question, List<EasyVQueryCatalog.Spec> catalog);

  /**
   * 基于已执行的查询结果生成最终回答。
   *
   * @param question 用户原始问题
   * @param rangeDescription 业务时间窗口描述（如"截至 2026-09-15 的全部已采集数据"）
   * @param results 每个元素为 {spec, rows}
   */
  ComposedAnswer composeAnswer(
      String question, String rangeDescription, List<QueryResult> results);

  /**
   * 流式变体：partialAnswer 接收"截至当前的累计回答文本"（非增量片段），
   * 供执行通道转为 answer-delta 事件；实现不支持流式时按最终文本回调一次即可。
   */
  default ComposedAnswer composeAnswer(
      String question, String rangeDescription, List<QueryResult> results,
      java.util.function.Consumer<String> partialAnswer) {
    return composeAnswer(question, rangeDescription, results);
  }

  record QueryResult(EasyVQueryCatalog.Spec spec, List<Map<String, Object>> rows) {
    public QueryResult {
      rows = rows == null ? List.of() : List.copyOf(rows);
    }
  }

  /**
   * @param markdown 直接回答用户问题的中文 markdown（只引用提供的数据）
   * @param highlights 需要在对话流中直接展示的图表（queryKey + viz）
   * @param suggestions 面向业务的中文追问建议（须能由目录内查询回答）
   * @param actions 基于结论的建议业务动作（只读建议，执行须人工确认与派发通道）
   */
  record ComposedAnswer(
      String markdown,
      List<Highlight> highlights,
      List<String> suggestions,
      List<SuggestedAction> actions) {
    public ComposedAnswer {
      highlights = highlights == null ? List.of() : List.copyOf(highlights);
      suggestions = suggestions == null ? List.of() : List.copyOf(suggestions);
      actions = actions == null ? List.of() : List.copyOf(actions);
    }

    public ComposedAnswer(String markdown, List<Highlight> highlights) {
      this(markdown, highlights, List.of(), List.of());
    }

    public ComposedAnswer(
        String markdown, List<Highlight> highlights, List<String> suggestions) {
      this(markdown, highlights, suggestions, List.of());
    }
  }

  /** viz ∈ bar | pie | line | table | none */
  record Highlight(String queryKey, String viz) {}

  /** 建议业务动作：label 为动作名，rationale 为基于已见事实的理由。 */
  record SuggestedAction(String label, String rationale) {}
}
