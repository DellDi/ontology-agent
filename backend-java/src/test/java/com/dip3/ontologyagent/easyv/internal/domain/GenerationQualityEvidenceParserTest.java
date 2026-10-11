package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GenerationQualityEvidenceParserTest {
  @Test void presentationKeepsConstraintsWithinTheirModuleAndDistinguishesRecordedOrigins() {
    String source = new JsonCodec().write(List.of(
        Map.of("themeId", "theme_1", "businessModule", "CPU", "constraints", List.of(
            Map.of("text", "环形占比图", "origin", "USER", "evidence", "CPU使用环形图"),
            Map.of("text", "补充告警", "origin", "DERIVED"))),
        Map.of("themeId", "theme_2", "businessModule", "存储", "constraints", List.of(
            Map.of("text", "数值总览", "origin", "OTHER")))));
    var items = GenerationQualityEvidenceParser.present("themes", source);
    assertEquals(List.of("模块", "用户要求（系统标记）", "要求依据（系统记录）", "系统补充建议", "模块", "约束（来源未明确）"),
        items.stream().map(GenerationQualityEvidenceParser.DisplayItem::label).toList());
    assertEquals(List.of("CPU", "环形占比图", "CPU使用环形图", "补充告警", "存储", "数值总览"),
        items.stream().map(GenerationQualityEvidenceParser.DisplayItem::value).toList());
    assertFalse(items.toString().contains("theme_"));
  }

  @Test void presentationDoesNotTranslateAnUnspecifiedDisplayModeOrInventMissingRequirements() {
    var objective = GenerationQualityEvidenceParser.present("screenObjective", "{\"primaryGoal\":\"实时监控负载\",\"displayMode\":\"realtime\"}");
    assertEquals("实时监控负载", objective.getFirst().value());
    assertFalse(objective.toString().contains("realtime"));
    var modules = GenerationQualityEvidenceParser.present("themes", "[{\"businessModule\":\"CPU\"},{\"businessModule\":\"存储\",\"constraints\":[]}]");
    assertEquals(1, modules.stream().filter(i -> i.value().equals("本记录未提供模块约束，不能据此判定用户没有提出要求")).count());
    assertEquals("本记录未提供模块条目", GenerationQualityEvidenceParser.present("themes", "[]").getFirst().value());
  }

  @Test void interactionSupportIsOnlyASystemFlagAndDoesNotCertifyCapabilityOrImplementation() {
    var items = GenerationQualityEvidenceParser.present("interactionRequests", "[{\"rawInstruction\":\"点击查看明细\",\"supported\":true},{\"rawInstruction\":\"联动过滤\",\"supported\":false,\"unsupportedReason\":\"需另行核对\"},{}]");
    assertEquals("标记为支持，不能证明已实现", items.get(1).value());
    assertEquals("标记为不支持，不能认证实际能力", items.get(3).value());
    assertEquals("需另行核对", items.get(4).value());
    assertEquals("本记录未提供支持标记", items.getLast().value());
  }

  @Test void presentationRejectsMalformedShapesAndUnknownFieldsInsteadOfSilentlyDroppingThem() {
    for (String source : List.of("{}", "[{}] []", "[{\"businessModule\":3}]", "[{\"businessModule\":\"CPU\",\"newField\":\"重要要求\"}]", "[{\"constraints\":{}}]")) {
      assertThrows(IllegalArgumentException.class, () -> GenerationQualityEvidenceParser.present("themes", source));
    }
    assertThrows(IllegalArgumentException.class, () -> GenerationQualityEvidenceParser.present("interactionRequests", "[{\"supported\":\"true\"}]"));
  }

  @Test void truncationIsMatchedToTheSelectedFieldIncludingNestedPaths() {
    assertTrue(GenerationQualityEvidenceParser.isTruncated("themes", "[\"themes[0].constraints[0].text\"]"));
    assertFalse(GenerationQualityEvidenceParser.isTruncated("screenObjective", "[\"themes[0].intent\"]"));
    assertTrue(GenerationQualityEvidenceParser.isTruncated("screenObjective", "[\"screenObjective.primaryGoal\"]"));
    assertFalse(GenerationQualityEvidenceParser.isTruncated("themes", "[]"));
    assertThrows(IllegalArgumentException.class, () -> GenerationQualityEvidenceParser.isTruncated("themes", "[3]"));
  }

  @Test void projectsOnlyReviewedStep1PathsAndKeepsUserAndDerivedConstraintsDistinct() {
    var raw = Map.of("businessContext", Map.of("industryCategory", "医疗", "audienceType", "管理层"),
        "coreIntent", "监测运营", "pageTitle", "医院运营", "screenObjective", Map.of("primaryGoal", "运营监测", "displayMode", "monitor"),
        "themes", List.of(Map.of("themeId", "t1", "businessModule", "门诊", "intent", "趋势分析",
            "moduleDescription", "观察需求变化", "constraints", List.of(
                Map.of("text", "按月展示", "origin", "USER", "evidence", "我要看月趋势"),
                Map.of("text", "补充同比", "origin", "DERIVED")), "metrics", List.of(Map.of("sourceColumns", "不得保留")))),
        "interactionRequests", List.of(Map.of("rawInstruction", "点击查看明细", "supported", false, "unsupportedReason", "尚未支持")),
        "candidateThemes", List.of("不得保留"), "csvMeta", Map.of("sampleRows", List.of("不得保留")));
    var parsed = GenerationQualityEvidenceParser.parse("MAIN", "Step1", Map.of("output", Map.of("raw", raw)));
    assertEquals("available", parsed.status());
    assertEquals("医疗", parsed.industryCategory());
    String projected = new JsonCodec().write(parsed.evidence());
    assertTrue(projected.contains("我要看月趋势"));
    assertTrue(projected.contains("DERIVED"));
    assertTrue(projected.contains("primaryGoal"));
    assertTrue(projected.contains("unsupportedReason"));
    assertFalse(projected.contains("不得保留"));
    assertFalse(projected.contains("sourceColumns"));
  }

  @Test void truncationIsExplicitAndDoesNotSplitUnicodeCharacters() {
    String longText = "😀".repeat(4001);
    var parsed = GenerationQualityEvidenceParser.parse("MAIN", "Step1",
        Map.of("output", Map.of("raw", Map.of("coreIntent", longText))));
    String retained = (String) parsed.evidence().get("coreIntent");
    assertEquals(4000, retained.codePointCount(0, retained.length()));
    assertEquals(List.of("coreIntent"), parsed.evidence().get("truncatedFields"));
  }

  @Test void missingAndMalformedEvidenceRemainLocatableAndUserPromptIsNeverCopied() {
    assertEquals("missing", GenerationQualityEvidenceParser.parse("MAIN", "Step1", null).status());
    assertEquals("STEP1_RAW_MISSING", GenerationQualityEvidenceParser.parse("MAIN", "Step1", Map.of()).errorCode());
    var invalid = GenerationQualityEvidenceParser.parse("MAIN", "Step1", Map.of("output", List.of("bad")));
    assertEquals("invalid", invalid.status());
    assertNull(invalid.evidence());
    assertEquals("not_applicable", GenerationQualityEvidenceParser.parse("CHAT", "UserPrompt", Map.of("message", "原话不复制")).status());
  }

  @Test void chatTargetIsOptionalAndDoesNotFabricateAGlobalOrRegionalChange() {
    var targeted = GenerationQualityEvidenceParser.parse("CHAT", "ChatExecution", Map.of("blockId", "left_1", "progressSnapshot", Map.of("message", "不采")));
    assertEquals("left_1", targeted.targetBlockId());
    assertNull(targeted.evidence());
    var absent = GenerationQualityEvidenceParser.parse("CHAT", "ChatExecution", Map.of("message", "完成"));
    assertEquals("available", absent.status());
    assertNull(absent.targetBlockId());
  }
}
