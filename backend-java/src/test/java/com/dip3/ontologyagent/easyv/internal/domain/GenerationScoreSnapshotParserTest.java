package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.support.JsonCodec;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GenerationScoreSnapshotParserTest {
  static Map<String, Object> output() {
    return new LinkedHashMap<>(Map.of("output", Map.of("raw", Map.of("regenContextSnapshot", context()))));
  }

  private static Map<String, Object> context() {
    Map<String, Object> assignment = new LinkedHashMap<>(Map.of(
        "blockId", "block-1", "bestSchemeId", "4", "matchScore", 145.5, "bestSchemeScore", 95.5,
        "matchDetail", Map.of("weightScore", 50), "themeRank", 1, "blockRank", 1,
        "comboScoreBreakdown", Map.of("categoryCapacityScore", 25, "rolePatternScore", 25,
            "positionPriorityScore", 20, "countFitScore", 10, "chartTypeRefineScore", 15.5),
        "assignedTheme", Map.of("priority", 100, "businessModule", "不保留的业务名称", "metrics", List.of(
            Map.of("metricId", "metric-a", "sceneType", "趋势分析", "chartType", "折线图", "chartFamily", "line",
                "suggestedCharts", List.of("折线图"), "priority", "high", "name", "不保留的指标名",
                "sourceColumns", List.of("不保留的源列"))))));
    assignment.put("targetBlock", Map.of("blockId", "block-1", "region", "left", "span", 4,
        "weight", 92, "blockSize", "medium", "blockTypeId", "1", "chartCountRange", List.of(1, 7),
        "availableSchemeIds", List.of("4", "7")));
    return new LinkedHashMap<>(Map.of("originalTaskId", "task-1",
        "originalSceneDescription", "不保留的原始问题", "sourceRuleVersion", "不能认证的版本",
        "step5Candidates", Map.of("step4Output", Map.of("blockAssignments", List.of(assignment))),
        "currentFilledBlocks", List.of(Map.of("blockId", "block-1", "selectedScheme", Map.of("schemeId", "7"),
            "slotBindings", List.of(Map.of("slotIndex", 0, "chartType", "折线图", "desc", "不保留的描述",
                "boundMetric", Map.of("metricId", "metric-a", "sceneType", "趋势分析", "sourceType", "AI",
                    "metricName", "不保留的指标名")))))));
  }

  @SuppressWarnings("unchecked")
  private static Map<String, Object> context(Map<String, Object> output) {
    return (Map<String, Object>) ((Map<?, ?>) ((Map<?, ?>) output.get("output")).get("raw")).get("regenContextSnapshot");
  }

  @Test
  void preservesStageScoresAndDistinctSelectedSchemeWithoutClaimingVerifiedInput() {
    var parsed = GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output());
    assertEquals("available_unverified", parsed.status());
    assertNull(parsed.errorCode());
    var snapshot = parsed.snapshot();
    assertEquals("mutable_regen_context", snapshot.inputProvenance());
    var score = snapshot.assignments().getFirst();
    assertEquals(145.5, score.matchScore(), "保留源分数，不能当成百分比截断或归一化");
    assertEquals(95.5, score.bestSchemeScore());
    assertEquals(15.5, score.breakdown().chartTypeRefineScore());
    assertEquals(50.0, score.weightScore());
    assertEquals(1, score.themeRank());
    assertEquals(92, score.targetBlock().weight());
    assertEquals(List.of("4", "7"), score.targetBlock().availableSchemeIds());
    assertEquals("4", score.bestSchemeId());
    assertEquals("7", snapshot.filledBlocks().getFirst().schemeId());
    assertEquals("metric-a", snapshot.filledBlocks().getFirst().bindings().getFirst().metricId());
    assertEquals(List.of("折线图"), score.metrics().getFirst().suggestedCharts());
    assertFalse(new JsonCodec().write(snapshot).contains("不保留"));
    assertFalse(new JsonCodec().write(snapshot).contains("不能认证"));
    assertThrows(UnsupportedOperationException.class, () -> snapshot.assignments().clear());
    assertThrows(UnsupportedOperationException.class, () -> score.metrics().getFirst().suggestedCharts().clear());
  }

  @Test
  void editingMutableContextDoesNotTurnTheSourceScoreIntoVerifiedGenerationEvidence() {
    Map<String, Object> edited = output();
    context(edited).put("currentFilledBlocks", List.of(Map.of("blockId", "block-1", "selectedScheme", Map.of("schemeId", "4"),
        "slotBindings", List.of(Map.of("slotIndex", 0, "chartType", "柱状图", "boundMetric", Map.of("metricId", "replaced-metric"))))));
    var before = GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output());
    var after = GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", edited);
    assertEquals(before.snapshot().assignments(), after.snapshot().assignments());
    assertNotEquals(before.snapshot().filledBlocks(), after.snapshot().filledBlocks());
    assertEquals("available_unverified", after.status());
  }

  @Test
  void missingScoresAndBindingsRemainMissingInsteadOfReceivingZeroOrEmptyDefaults() {
    Map<String, Object> output = output();
    context(output).remove("currentFilledBlocks");
    context(output).put("step5Candidates", Map.of("step4Output", Map.of("blockAssignments", List.of(Map.of("blockId", "block-1")))));
    var parsed = GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output);
    assertEquals("available_unverified", parsed.status());
    var score = parsed.snapshot().assignments().getFirst();
    assertNull(score.matchScore());
    assertNull(score.bestSchemeScore());
    assertNull(score.breakdown());
    assertNull(score.metrics());
    assertNull(parsed.snapshot().filledBlocks());
  }

  @Test
  void malformedOrAbsentSnapshotsAreLocatableAndNeverCreateFalseScoreEvidence() {
    assertEquals("not_applicable", GenerationScoreSnapshotParser.parse("Step1", "task-1", "broken").status());
    assertEquals("PIPELINE_OUTPUT_MISSING", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", null).errorCode());
    assertEquals("REGEN_CONTEXT_MISSING", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", Map.of()).errorCode());
    assertEquals("SCORE_JSON_MALFORMED", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", "{").errorCode());
    Map<String, Object> output = output();
    context(output).put("originalTaskId", "another-task");
    assertEquals("SCORE_TASK_MISMATCH", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output).errorCode());
    for (Object score : List.of("95", Double.NaN, Double.POSITIVE_INFINITY)) {
      output = output();
      context(output).put("step5Candidates", Map.of("step4Output", Map.of("blockAssignments", List.of(
          Map.of("blockId", "block-1", "matchScore", score)))));
      var result = GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output);
      assertEquals("SCORE_NUMBER_INVALID", result.errorCode());
      assertNull(result.snapshot());
    }
  }

  @Test
  void rejectsAmbiguousBlocksAndSlotsAndUsesTheExactStoredTracePath() {
    Map<String, Object> output = output();
    context(output).put("currentFilledBlocks", List.of(Map.of("blockId", "block-1", "slotBindings", List.of(
        Map.of("slotIndex", 0), Map.of("slotIndex", 0)))));
    assertEquals("SCORE_SLOT_DUPLICATE", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output).errorCode());
    for (Object slot : List.of(-1, 0.5, (long) Integer.MAX_VALUE + 1, "0")) {
      output = output();
      context(output).put("currentFilledBlocks", List.of(Map.of("blockId", "block-1", "slotBindings", List.of(Map.of("slotIndex", slot)))));
      assertEquals("invalid", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output).status());
    }
    output = output();
    context(output).put("step5Candidates", Map.of("step4Output", Map.of("blockAssignments", List.of(
        Map.of("blockId", "block-1"), Map.of("blockId", "block-1")))));
    assertEquals("SCORE_BLOCK_DUPLICATE", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", output).errorCode());
    assertEquals("REGEN_CONTEXT_MISSING", GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1",
        Map.of("raw", Map.of("regenContextSnapshot", context()))).errorCode());
    var encoded = GenerationScoreSnapshotParser.parse("PipelineCompleted", "task-1", new JsonCodec().write(output()));
    assertEquals("available_unverified", encoded.status());
  }
}
