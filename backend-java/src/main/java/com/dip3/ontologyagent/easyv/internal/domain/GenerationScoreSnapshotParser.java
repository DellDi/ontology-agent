package com.dip3.ontologyagent.easyv.internal.domain;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 源端的再生成上下文可被编辑覆盖；这里保存观测证据，不认证它为生成时输入。 */
public final class GenerationScoreSnapshotParser {
  private static final ObjectMapper JSON = new ObjectMapper();

  private GenerationScoreSnapshotParser() {}

  public record Parsed(String status, String errorCode, Snapshot snapshot) {}
  public record Snapshot(String inputProvenance, List<Assignment> assignments, List<FilledBlock> filledBlocks) {}
  public record Assignment(String blockId, String bestSchemeId, Double matchScore, Double bestSchemeScore,
      Double weightScore, Integer themeRank, Integer blockRank, Integer themePriority,
      TargetBlock targetBlock, Breakdown breakdown, List<Metric> metrics) {}
  public record TargetBlock(String blockId, String region, Integer span, Integer weight,
      String blockSize, String blockTypeId, List<Integer> chartCountRange, List<String> availableSchemeIds) {}
  public record Breakdown(Double categoryCapacityScore, Double rolePatternScore, Double positionPriorityScore,
      Double countFitScore, Double chartTypeRefineScore) {}
  public record Metric(String metricId, String sceneType, String chartType, String chartFamily,
      String priority, List<String> suggestedCharts, String sourceType) {}
  public record FilledBlock(String blockId, String schemeId, List<Binding> bindings) {}
  public record Binding(int slotIndex, String chartType, String metricId, String sceneType, String sourceType) {}

  public static Parsed parse(String stepName, String taskId, Object output) {
    if (!"PipelineCompleted".equals(stepName)) return new Parsed("not_applicable", null, null);
    if (output == null) return new Parsed("missing", "PIPELINE_OUTPUT_MISSING", null);
    try {
      Object decoded = output;
      if (output instanceof String text) decoded = JSON.readValue(text, Object.class);
      Map<?, ?> event = object(decoded);
      Map<?, ?> stepOutput = optionalObject(event.get("output"));
      Map<?, ?> raw = stepOutput == null ? null : optionalObject(stepOutput.get("raw"));
      Map<?, ?> context = raw == null ? null : optionalObject(raw.get("regenContextSnapshot"));
      if (context == null) return new Parsed("missing", "REGEN_CONTEXT_MISSING", null);
      String originalTask = text(context.get("originalTaskId"));
      if (originalTask != null && !originalTask.equals(taskId)) throw invalid("SCORE_TASK_MISMATCH");
      Map<?, ?> candidates = optionalObject(context.get("step5Candidates"));
      Map<?, ?> step4 = candidates == null ? null : optionalObject(candidates.get("step4Output"));
      if (step4 == null || step4.get("blockAssignments") == null) {
        return new Parsed("missing", "SCORE_ASSIGNMENTS_MISSING", null);
      }
      List<Assignment> assignments = new ArrayList<>();
      Set<String> blockIds = new HashSet<>();
      for (Object value : array(step4.get("blockAssignments"))) {
        Map<?, ?> item = object(value);
        String blockId = id(item.get("blockId"));
        if (!blockIds.add(blockId)) throw invalid("SCORE_BLOCK_DUPLICATE");
        Map<?, ?> detail = optionalObject(item.get("matchDetail"));
        Map<?, ?> breakdown = optionalObject(item.get("comboScoreBreakdown"));
        Map<?, ?> theme = optionalObject(item.get("assignedTheme"));
        assignments.add(new Assignment(blockId, text(item.get("bestSchemeId")),
            number(item.get("matchScore")), number(item.get("bestSchemeScore")),
            detail == null ? null : number(detail.get("weightScore")),
            integer(item.get("themeRank")), integer(item.get("blockRank")),
            theme == null ? null : integer(theme.get("priority")), targetBlock(item.get("targetBlock")),
            breakdown == null ? null : new Breakdown(number(breakdown.get("categoryCapacityScore")),
                number(breakdown.get("rolePatternScore")), number(breakdown.get("positionPriorityScore")),
                number(breakdown.get("countFitScore")), number(breakdown.get("chartTypeRefineScore"))),
            theme == null ? null : metrics(theme.get("metrics"))));
      }
      return new Parsed("available_unverified", null,
          new Snapshot("mutable_regen_context", List.copyOf(assignments), filledBlocks(context.get("currentFilledBlocks"))));
    } catch (JsonProcessingException | InvalidSnapshot failure) {
      return new Parsed("invalid", failure instanceof InvalidSnapshot invalid
          ? invalid.code : "SCORE_JSON_MALFORMED", null);
    }
  }

  private static TargetBlock targetBlock(Object value) {
    if (value == null) return null;
    Map<?, ?> block = object(value);
    List<Integer> range = null;
    if (block.get("chartCountRange") != null) {
      range = new ArrayList<>();
      for (Object item : array(block.get("chartCountRange"))) {
        Integer number = integer(item);
        if (number == null) throw invalid("SCORE_NUMBER_INVALID");
        range.add(number);
      }
      range = List.copyOf(range);
    }
    return new TargetBlock(text(block.get("blockId")), text(block.get("region")),
        integer(block.get("span")), integer(block.get("weight")), text(block.get("blockSize")),
        text(block.get("blockTypeId")), range, strings(block.get("availableSchemeIds")));
  }

  private static List<Metric> metrics(Object value) {
    if (value == null) return null;
    List<Metric> result = new ArrayList<>();
    for (Object raw : array(value)) {
      Map<?, ?> item = object(raw);
      result.add(new Metric(text(item.get("metricId")), text(item.get("sceneType")),
          text(item.get("chartType")), text(item.get("chartFamily")), text(item.get("priority")),
          strings(item.get("suggestedCharts")), text(item.get("sourceType"))));
    }
    return List.copyOf(result);
  }

  private static List<FilledBlock> filledBlocks(Object value) {
    if (value == null) return null;
    List<FilledBlock> result = new ArrayList<>();
    Set<String> blockIds = new HashSet<>();
    for (Object raw : array(value)) {
      Map<?, ?> item = object(raw);
      String blockId = id(item.get("blockId"));
      if (!blockIds.add(blockId)) throw invalid("SCORE_BLOCK_DUPLICATE");
      Map<?, ?> selected = optionalObject(item.get("selectedScheme"));
      List<Binding> bindings = null;
      if (item.get("slotBindings") != null) {
        bindings = new ArrayList<>();
        Set<Integer> slots = new HashSet<>();
        for (Object bindingValue : array(item.get("slotBindings"))) {
          Map<?, ?> binding = object(bindingValue);
          Double slot = number(binding.get("slotIndex"));
          if (slot == null || slot < 0 || slot > Integer.MAX_VALUE || slot != Math.rint(slot)) {
            throw invalid("SCORE_SLOT_INVALID");
          }
          int index = slot.intValue();
          if (!slots.add(index)) throw invalid("SCORE_SLOT_DUPLICATE");
          Map<?, ?> metric = optionalObject(binding.get("boundMetric"));
          bindings.add(new Binding(index, text(binding.get("chartType")),
              metric == null ? null : text(metric.get("metricId")),
              metric == null ? null : text(metric.get("sceneType")),
              metric == null ? null : text(metric.get("sourceType"))));
        }
        bindings.sort(java.util.Comparator.comparingInt(Binding::slotIndex));
        bindings = List.copyOf(bindings);
      }
      result.add(new FilledBlock(blockId, selected == null ? null : text(selected.get("schemeId")), bindings));
    }
    return List.copyOf(result);
  }

  private static List<String> strings(Object value) {
    if (value == null) return null;
    List<String> result = new ArrayList<>();
    for (Object item : array(value)) result.add(id(item));
    return List.copyOf(result);
  }

  private static Map<?, ?> object(Object value) {
    if (!(value instanceof Map<?, ?> map)) throw invalid("SCORE_OBJECT_INVALID");
    return map;
  }

  private static Map<?, ?> optionalObject(Object value) { return value == null ? null : object(value); }

  private static List<?> array(Object value) {
    if (!(value instanceof List<?> list)) throw invalid("SCORE_ARRAY_INVALID");
    return list;
  }

  private static String text(Object value) {
    if (value == null) return null;
    if (!(value instanceof String text)) throw invalid("SCORE_TEXT_INVALID");
    return text;
  }

  private static String id(Object value) {
    String id = text(value);
    if (id == null || id.isBlank()) throw invalid("SCORE_ID_MISSING");
    return id;
  }

  private static Double number(Object value) {
    if (value == null) return null;
    if (!(value instanceof Number number) || !Double.isFinite(number.doubleValue())) {
      throw invalid("SCORE_NUMBER_INVALID");
    }
    return number.doubleValue();
  }

  private static Integer integer(Object value) {
    Double number = number(value);
    if (number == null) return null;
    if (number != Math.rint(number) || number < Integer.MIN_VALUE || number > Integer.MAX_VALUE) {
      throw invalid("SCORE_NUMBER_INVALID");
    }
    return number.intValue();
  }

  private static InvalidSnapshot invalid(String code) { return new InvalidSnapshot(code); }

  private static final class InvalidSnapshot extends RuntimeException {
    private final String code;
    private InvalidSnapshot(String code) { super(code, null, false, false); this.code = code; }
  }
}
