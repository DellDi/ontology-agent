package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class GenerationQualityEvidenceParserTest {
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
