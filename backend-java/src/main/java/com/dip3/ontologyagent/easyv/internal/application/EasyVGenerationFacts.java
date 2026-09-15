package com.dip3.ontologyagent.easyv.internal.application;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Read-only, typed boundary for EasyV analytical facts. */
public interface EasyVGenerationFacts {
  Snapshot collect(Query query);

  /**
   * 按 {@code EasyVQueryCatalog} 发布的 key 执行固定 SQL 聚合查询，
   * 返回行集与实际执行的 SQL 模板（shape=series 时为 label/value 行；
   * shape=record 时为单行多列）。SQL 随行返回用于归因审计表述。
   */
  Aggregation aggregate(Query query, String queryKey);

  /** 一次目录查询的执行事实：结果行 + 实际运行的 SQL 模板。 */
  record Aggregation(List<Map<String, Object>> rows, String sql) {
    public Aggregation {
      rows = rows == null ? List.of() : List.copyOf(rows);
    }
  }

  record Query(
      String executionId,
      String userId,
      String accessMode,
      String ontologyVersionId,
      String datasetVersionSetId,
      LocalDate from,
      LocalDate to,
      Instant requestedAt) {}

  record Snapshot(
      ApplicationFacts application,
      PipelineFacts pipeline,
      ForgeFacts forge,
      FeedbackFacts feedback,
      Map<String, String> productVersionIds) {
    public Snapshot {
      productVersionIds = productVersionIds == null ? Map.of() : Map.copyOf(productVersionIds);
    }

    public Snapshot(
        ApplicationFacts application,
        PipelineFacts pipeline,
        ForgeFacts forge,
        FeedbackFacts feedback) {
      this(application, pipeline, forge, feedback, Map.of());
    }
  }

  record FactWindow(
      String userId, String accessMode, LocalDate from, LocalDate to, Instant freshnessAt) {}

  record ApplicationFacts(FactWindow window, long applicationCount, long prototypeCount) {}

  record PipelineFacts(
      FactWindow window,
      long taskCount,
      long completedTaskCount,
      long failedTaskCount,
      long incompleteTaskCount,
      long mainNodeCount,
      long timedNodeCount,
      String bottleneckStep,
      long bottleneckP95Millis,
      List<StageDuration> stageDurations) {
    public PipelineFacts {
      stageDurations = stageDurations == null ? List.of() : List.copyOf(stageDurations);
    }
  }

  /** Per-stage P95 over timed MAIN pipeline nodes, ordered by p95 desc. */
  record StageDuration(String stepName, long p95Millis, long nodeCount) {}

  record ForgeFacts(
      FactWindow window,
      long taskCount,
      long completedTaskCount,
      long failedTaskCount,
      long cancelledTaskCount,
      long terminalTaskCount,
      long timedTerminalTaskCount,
      long p50DurationMillis,
      long p95DurationMillis,
      Map<String, Long> failureReasonCounts) {
    public ForgeFacts {
      failureReasonCounts = failureReasonCounts == null ? Map.of() : Map.copyOf(failureReasonCounts);
    }
  }

  record FeedbackFacts(
      FactWindow window,
      long operationCount,
      long ratedCount,
      double averageRating,
      long saveAsEditCount,
      long combinedExecuteSuccessCount,
      long combinedExecuteFailureCount) {}
}
