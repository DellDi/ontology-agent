package com.dip3.ontologyagent.easyv.internal.application;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * EasyV 分析模型端口：规划阶段把问题翻译为本体查询意图（或澄清/不支持），
 * 综合阶段只基于已执行查询结果作答并逐条引用数据。模型输出由应用层校验，不直接生效。
 */
public interface EasyVAnalysisModel {

  PlanDecision plan(PlanRequest request);

  ComposedAnswer compose(ComposeRequest request, Consumer<String> partialAnswer);

  /**
   * @param catalog 领域本体目录（对象/属性/关系/指标）
   * @param anchorDate 相对时间锚点（业务时区日期）
   * @param previousConclusion 追问时上一轮结论（标题与摘要），首轮为空
   * @param previousQueries 追问时上一轮已执行的查询意图 JSON
   * @param violations 上一次规划的校验违规（纠正轮），首次为空
   * @param observations 本轮真实结果，rows 最多 50 行，totalRows 保留完整行数
   * @param remainingQueries 本轮剩余指标查询次数
   * @param remainingMillis 本轮剩余执行预算，模型调用不能重新开始计时
   */
  record PlanRequest(String question, List<Map<String, Object>> catalog, String anchorDate, String zone,
                     Map<String, Object> previousConclusion, List<Map<String, Object>> previousQueries,
                     List<String> violations, Map<String, Object> selectedObject,
                     List<Map<String, Object>> observations, int remainingQueries, long remainingMillis, int remainingCalls,
                     List<Map<String, Object>> tools, List<Map<String, Object>> knownObjects) {
    public PlanRequest {
      selectedObject = selectedObject == null ? Map.of() : Map.copyOf(selectedObject);
      catalog = List.copyOf(catalog);
      previousConclusion = previousConclusion == null ? Map.of() : Map.copyOf(previousConclusion);
      previousQueries = previousQueries == null ? List.of() : List.copyOf(previousQueries);
      violations = violations == null ? List.of() : List.copyOf(violations);
      observations = List.copyOf(observations);
      tools = List.copyOf(tools); knownObjects = List.copyOf(knownObjects);
    }
  }

  enum PlanStatus { READY, FINISHED, CLARIFY, UNSUPPORTED }

  /**
   * @param calls READY 时的原始工具调用 JSON（由应用层解析与编译）
   * @param message CLARIFY 时的澄清问题，UNSUPPORTED 时的原因
   * @param options CLARIFY 时的候选项
   */
  record PlanDecision(PlanStatus status, List<Object> calls, String message, List<String> options) {
    public PlanDecision {
      calls = calls == null ? List.of() : List.copyOf(calls);
      options = options == null ? List.of() : List.copyOf(options);
    }
  }

  /**
   * @param results 已执行查询：id、标签、区间描述、列与结果行（行下标即引用下标）
   * @param violations 上一次回答的校验违规（纠正轮），首次为空
   * @param remainingMillis 本轮剩余执行预算，与规划阶段共享
   */
  record ComposeRequest(String question, String dataScope, List<Map<String, Object>> results,
                        List<String> violations, long remainingMillis) {
    public ComposeRequest {
      results = List.copyOf(results);
      violations = violations == null ? List.of() : List.copyOf(violations);
    }
  }

  record ComposedAnswer(String markdown, List<Citation> citations, List<Highlight> highlights,
                        List<String> suggestions, List<SuggestedAction> actions) {
    public ComposedAnswer {
      citations = List.copyOf(citations);
      highlights = List.copyOf(highlights);
      suggestions = List.copyOf(suggestions);
      actions = List.copyOf(actions);
    }
  }

  /** 回答引用的数据点：查询 id、行下标与列 key。 */
  record Citation(String query, int row, String field) {}

  /** viz: bar | line | pie | table | none。 */
  record Highlight(String query, String viz) {}

  record SuggestedAction(String label, String rationale) {}
}
