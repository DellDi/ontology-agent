package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ColumnType;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ContractStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ItemStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.RequiredColumn;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.RequiredTable;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class EasyVWritebackContractTest {
  private static final ObjectMapper JSON = new ObjectMapper();

  @Test
  void declaresAllSixRequiredTablesAndRequiredColumns() {
    Map<String, List<String>> expected = Map.of(
        "ai_screen_app", List.of("app_id", "app_name", "generation_task_id", "scope_type",
            "user_id", "space_id", "team_id", "is_delete"),
        "ai_screen_prototype", List.of("id", "app_id", "screen_structure_xml",
            "screen_template_json", "screen_prototype_json", "update_time"),
        "ai_pipeline_node_record", List.of("id", "task_id", "step_name", "output"),
        "ai_block_data", List.of("id", "block_type_id", "chat_count", "block_slots_data"),
        "ai_block_internal_data", List.of("id", "allowed_chart_categories", "recommend_type"),
        "ai_chart_type_mapping", List.of("id", "chart_type", "chart_family", "scene_tag",
            "status", "sort_order"));

    assertEquals(6, EasyVWritebackContract.REQUIRED_TABLES.size());
    Map<String, List<String>> actual = EasyVWritebackContract.REQUIRED_TABLES.stream()
        .collect(Collectors.toMap(
            RequiredTable::tableName,
            table -> table.columns().stream().map(RequiredColumn::name).toList()));
    assertEquals(expected, actual);
  }

  @Test
  void validatesPostgresColumnTypeCompatibilityStrictly() {
    assertTrue(ColumnType.TEXT.isCompatible("character varying", "varchar"));
    assertTrue(ColumnType.TEXT.isCompatible("text", "text"));
    assertFalse(ColumnType.TEXT.isCompatible("jsonb", "jsonb"));
    assertFalse(ColumnType.TEXT.isCompatible("bigint", "int8"));

    assertTrue(ColumnType.INTEGER.isCompatible("integer", "int4"));
    assertTrue(ColumnType.INTEGER.isCompatible("bigint", "int8"));
    assertTrue(ColumnType.INTEGER.isCompatible("smallint", "int2"));
    assertFalse(ColumnType.INTEGER.isCompatible("text", "text"));

    assertTrue(ColumnType.JSON.isCompatible("json", "json"));
    assertTrue(ColumnType.JSON.isCompatible("jsonb", "jsonb"));
    assertFalse(ColumnType.JSON.isCompatible("text", "text"));

    assertTrue(ColumnType.JSONB.isCompatible("jsonb", "jsonb"));
    assertFalse(ColumnType.JSONB.isCompatible("json", "json"));
    assertFalse(ColumnType.JSONB.isCompatible("text", "text"));

    assertTrue(ColumnType.TIMESTAMP.isCompatible("timestamp without time zone", "timestamp"));
    assertTrue(ColumnType.TIMESTAMP.isCompatible("timestamp with time zone", "timestamptz"));
    assertFalse(ColumnType.TIMESTAMP.isCompatible("text", "text"));
  }

  @Test
  void validatesPrototypeJsonPathsAndDetectsBrokenPaths() throws Exception {
    ObjectNode valid = validPrototype();
    assertEquals(List.of(), EasyVWritebackContract.validatePrototypeJson(valid));

    ObjectNode renamedBlocks = JSON.createObjectNode();
    renamedBlocks.putObject("page-1").putObject("regions");
    assertTrue(EasyVWritebackContract.validatePrototypeJson(renamedBlocks).contains("page/blocks"));

    ObjectNode missingMetricIds = validPrototype();
    ((ObjectNode) missingMetricIds.at("/page-1/blocks/b")).remove("boundMetricIds");
    assertTrue(EasyVWritebackContract.validatePrototypeJson(missingMetricIds)
        .contains("page/blocks/*/boundMetricIds"));

    ObjectNode missingTheme = validPrototype();
    ((ObjectNode) missingTheme.at("/page-1/blocks/b")).remove("themeId");
    assertTrue(EasyVWritebackContract.validatePrototypeJson(missingTheme)
        .contains("page/blocks/*/themeId"));

    ObjectNode brokenComponent = validPrototype();
    ((ObjectNode) brokenComponent.at("/page-1/blocks/b/components/0")).remove("chartFamily");
    assertTrue(EasyVWritebackContract.validatePrototypeJson(brokenComponent)
        .stream().anyMatch(issue -> issue.contains("components(invalid_item)")));
  }

  @Test
  void validatesEditingOutputJsonPathsAndDetectsBrokenPaths() throws Exception {
    ObjectNode valid = validEditingOutput();
    assertEquals(List.of(), EasyVWritebackContract.validateEditingOutputJson(valid));

    for (String field : List.of("currentFilledBlocks", "currentBlockThemes")) {
      ObjectNode broken = validEditingOutput();
      ((ObjectNode) broken.at(PrototypeBlockWriteback.REGEN_CONTEXT_SNAPSHOT_PATH)).remove(field);
      assertTrue(EasyVWritebackContract.validateEditingOutputJson(broken)
          .contains(PrototypeBlockWriteback.REGEN_CONTEXT_SNAPSHOT_PATH + "/" + field));
    }

    ObjectNode missingAssignments = validEditingOutput();
    ((ObjectNode) missingAssignments.at("/output/raw/regenContextSnapshot/step5Candidates/step4Output"))
        .remove("blockAssignments");
    assertTrue(EasyVWritebackContract.validateEditingOutputJson(missingAssignments)
        .contains(PrototypeBlockWriteback.BLOCK_ASSIGNMENTS_PATH));

    ObjectNode missingCandidates = validEditingOutput();
    ((ObjectNode) missingCandidates.at("/output/raw/regenContextSnapshot/step5Candidates"))
        .remove("blockCandidates");
    assertTrue(EasyVWritebackContract.validateEditingOutputJson(missingCandidates)
        .contains(PrototypeBlockWriteback.BLOCK_CANDIDATES_PATH));

    ObjectNode missingAssignedTheme = validEditingOutput();
    ((ObjectNode) missingAssignedTheme.at(
        "/output/raw/regenContextSnapshot/step5Candidates/step4Output/blockAssignments/0"))
        .remove("assignedTheme");
    assertTrue(EasyVWritebackContract.validateEditingOutputJson(missingAssignedTheme)
        .stream().anyMatch(p -> p.contains("assignedTheme")));
  }

  @Test
  void buildsExplicitDisabledReportWithPendingChecklist() {
    Instant now = Instant.parse("2026-11-21T06:00:00Z");
    var report = EasyVWritebackContract.disabledReport("easyv_saas", "写回功能已关闭", now);
    assertEquals(ContractStatus.DISABLED, report.status());
    assertFalse(report.actionEnabled());
    assertEquals("写回功能已关闭", report.disabledReason());
    assertEquals(ItemStatus.DISABLED, report.schemaCheck().status());
    assertEquals(ItemStatus.DISABLED, report.sampleCheck().status());
    assertEquals(ItemStatus.DISABLED, report.chartMappingCheck().status());
    assertEquals(ItemStatus.DISABLED, report.redisCheck().status());
    assertEquals(EasyVWritebackContract.REDIS_INVALIDATION_KEY_PATTERN,
        report.redisCheck().expectedInvalidationKeyPattern());
    assertFalse(report.contractChecklist().isEmpty());
    assertTrue(report.contractChecklist().stream().allMatch(item -> item.status() == ItemStatus.PENDING));
    assertNotNull(report.checkedAt());
  }

  private static ObjectNode validPrototype() throws Exception {
    ObjectNode block = JSON.createObjectNode();
    block.put("id", "b").put("themeId", "theme-1").put("businessModule", "收入概览");
    ArrayNode components = block.putArray("components");
    components.addObject().put("id", "c0").put("chartFamily", "bar");
    block.putArray("boundMetricIds").add("m0");
    block.putArray("boundMetrics").addObject().put("metricId", "m0");
    ObjectNode root = JSON.createObjectNode();
    ObjectNode blocks = root.putObject("page-1").putObject("blocks");
    blocks.set("b", block);
    blocks.putObject("other").put("schemeId", "other").putArray("components");
    return root;
  }

  private static ObjectNode validEditingOutput() {
    ObjectNode event = JSON.createObjectNode();
    ObjectNode snapshot = event.putObject("output").putObject("raw").putObject("regenContextSnapshot");
    ObjectNode filled = snapshot.putArray("currentFilledBlocks").addObject().put("blockId", "b");
    filled.putArray("slotBindings").addObject()
        .put("slotIndex", 0)
        .put("chartType", "柱状图")
        .putObject("boundMetric").put("metricId", "m0");
    ObjectNode theme = snapshot.putArray("currentBlockThemes").addObject()
        .put("themeId", "theme-1").put("businessModule", "收入概览");
    ObjectNode candidates = snapshot.putObject("step5Candidates");
    candidates.putArray("blockCandidates").addObject().put("blockId", "b");
    ArrayNode assignments = candidates.putObject("step4Output").putArray("blockAssignments");
    assignments.addObject().put("blockId", "b").put("themeId", "theme-1").set("assignedTheme", theme.deepCopy());
    assignments.addObject().put("blockId", "other").put("themeId", "theme-other");
    return event;
  }
}
