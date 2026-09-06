package com.dip3.ontologyagent.easyv.internal.application;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Read-only, typed boundary for EasyV analytical facts. */
public interface EasyVGenerationFacts {
  Snapshot collect(Query query);

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
      long bottleneckP95Millis) {}

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
