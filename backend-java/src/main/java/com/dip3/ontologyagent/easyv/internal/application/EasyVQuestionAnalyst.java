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

  record QueryResult(EasyVQueryCatalog.Spec spec, List<Map<String, Object>> rows) {
    public QueryResult {
      rows = rows == null ? List.of() : List.copyOf(rows);
    }
  }

  /**
   * @param markdown 直接回答用户问题的中文 markdown（只引用提供的数据）
   * @param highlights 需要在对话流中直接展示的图表（queryKey + viz）
   */
  record ComposedAnswer(String markdown, List<Highlight> highlights) {
    public ComposedAnswer {
      highlights = highlights == null ? List.of() : List.copyOf(highlights);
    }
  }

  /** viz ∈ bar | pie | line | table | none */
  record Highlight(String queryKey, String viz) {}
}
