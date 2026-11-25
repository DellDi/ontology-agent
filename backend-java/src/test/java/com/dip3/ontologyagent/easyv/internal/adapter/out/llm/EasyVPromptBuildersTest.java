package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAgentTools;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.ComposeRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanRequest;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService.ObjectTypeView;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService.PropertyView;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EasyVPromptBuildersTest {

  private final List<Map<String, Object>> fullCatalog =
      QueryIntentCodec.catalog(SemanticModel.discover(), EasyVGenerationOntology.DOMAIN_KEY);

  @Test
  void plannerMetricOnlyModeIncludesSharedProtocolWithoutObjectOrBatchNoise() {
    PlanRequest request = new PlanRequest(
        "最近 7 天生成任务成功率",
        List.of(Map.of("object", "easyv-ai-application"), Map.of("object", "easyv-forge-task")),
        "2026-10-04", "Asia/Shanghai", Map.of(), List.of(), List.of(), Map.of(),
        List.of(), 4, 1000, 8, EasyVAgentTools.catalog(false), List.of());

    String prompt = EasyVPlannerPromptBuilder.build(request);

    assertTrue(prompt.contains("禁止输出 SQL"));
    assertTrue(prompt.contains("relative|calendar|to-date|absolute|all|ambiguous"));
    assertTrue(prompt.contains("query_metrics.input="));
    assertTrue(prompt.contains("问生成任务失败原因时"));
    assertTrue(prompt.contains("remainingCalls 是所有工具的剩余次数"));
    assertTrue(prompt.contains("若输入含 violations"));

    assertFalse(prompt.contains("query_objects/read_object/traverse_objects"));
    assertFalse(prompt.contains("TIME 属性的过滤值必须是带时区偏移的 ISO-8601 时间戳"));
    assertFalse(prompt.contains("hasMore=true"));
    assertFalse(prompt.contains("detailOnly=true"));
    assertFalse(prompt.contains("Step1 和 ChatExecution"));
    assertFalse(prompt.contains("assess_scheme"));
    assertFalse(prompt.contains("inspect_block_improvement"));
    assertFalse(prompt.contains("preview_block_improvement"));
    assertFalse(prompt.contains("selected-1、selected-2、selected-3"));
    assertFalse(prompt.contains("selectedObject.properties"));
    assertFalse(prompt.contains("追问时 previousQueries"));
  }

  @Test
  void plannerMetricEvalWithFullCatalogIncludesQualitySemanticsWithoutObjectTools() {
    PlanRequest request = new PlanRequest(
        "修改失败最多的是什么意图",
        fullCatalog,
        "2026-10-04", "Asia/Shanghai", Map.of(), List.of(), List.of(), Map.of(),
        List.of(), 4, 1000, 8, EasyVAgentTools.catalog(false), List.of());

    String prompt = EasyVPlannerPromptBuilder.build(request);

    assertTrue(prompt.contains("Step1 和 ChatExecution"));
    assertTrue(prompt.contains("chatRefactor 对话轮次"));
    assertTrue(prompt.contains("问生成任务失败原因时"));
    assertTrue(prompt.contains("哪些需求没处理好"));

    assertFalse(prompt.contains("query_objects/read_object/traverse_objects"));
    assertFalse(prompt.contains("inspect_block_improvement"));
    assertFalse(prompt.contains("selected-1、selected-2、selected-3"));
  }

  @Test
  void plannerFollowUpIncludesPreviousQueriesGuidanceOnlyWhenPresent() {
    PlanRequest followUp = new PlanRequest(
        "和上个月比呢",
        List.of(Map.of("object", "easyv-ai-application")),
        "2026-10-04", "Asia/Shanghai",
        Map.of("title", "上轮"), List.of(Map.of("id", "q1")), List.of(), Map.of(),
        List.of(), 4, 1000, 8, EasyVAgentTools.catalog(false), List.of());

    String prompt = EasyVPlannerPromptBuilder.build(followUp);

    assertTrue(prompt.contains("追问时 previousQueries 是上一轮已执行的查询"));
    assertTrue(prompt.contains("不得遗漏比较区间"));
  }

  @Test
  void plannerQualityFeedbackSelectionIncludesTraversalAndExcludesPrototypeImprovement() {
    var ref = new ObjectQueryPort.Reference("easyv-generation-feedback", "op-1", "v1");
    PlanRequest request = new PlanRequest(
        "失败之后又做了什么",
        fullCatalog,
        "2026-10-04", "Asia/Shanghai", Map.of(), List.of(), List.of(),
        Map.of("reference", ref, "properties", Map.of("appId", "app-1")),
        List.of(), 4, 1000, 8, EasyVAgentTools.catalog(true),
        List.of(Map.of("handle", "selected", "reference", ref, "read", false)));

    String prompt = EasyVPlannerPromptBuilder.build(request);

    assertTrue(prompt.contains("先读取操作反馈原话，再沿 qualityNodes"));
    assertTrue(prompt.contains("按 createdAt 升序选最早的 Step1"));
    assertTrue(prompt.contains("用户问失败之后又做了什么时"));
    assertTrue(prompt.contains("read_object(handle=\"selected\")"));
    assertTrue(prompt.contains("selectedObject 是用户从真实对象中选中的上下文"));
    assertTrue(prompt.contains("hasMore=true"));

    assertFalse(prompt.contains("inspect_block_improvement"));
    assertFalse(prompt.contains("preview_block_improvement"));
    assertFalse(prompt.contains("assess_scheme"));
    assertFalse(prompt.contains("selected-1、selected-2、selected-3"));
    assertFalse(prompt.contains("区域的 blockId 是原型内的位置"));
  }

  @Test
  void plannerBlockImprovementSelectionRoutesPrototypeAndImprovementWithoutQualityOrBatchRules() {
    var ref = new ObjectQueryPort.Reference("easyv-prototype-block", "app-1:b1", "v1");
    PlanRequest request = new PlanRequest(
        "评估并优化这个模块的图表组合",
        fullCatalog,
        "2026-10-04", "Asia/Shanghai", Map.of(), List.of(), List.of(),
        Map.of("reference", ref, "properties", Map.of("appId", "app-1")),
        List.of(), 4, 1000, 8, EasyVAgentTools.catalog(true),
        List.of(Map.of("handle", "selected", "reference", ref, "read", false)));

    String prompt = EasyVPlannerPromptBuilder.build(request);

    assertTrue(prompt.contains("区域的 blockId 是原型内的位置"));
    assertTrue(prompt.contains("assess_scheme 仅支持原型版式、区域与组件"));
    assertTrue(prompt.contains("inspect_block_improvement 取得模块目的"));
    assertTrue(prompt.contains("preview_block_improvement"));
    assertTrue(prompt.contains("choices.chartFamily 是机器字段"));
    assertTrue(prompt.contains("方案尚未应用"));
    assertTrue(prompt.contains("read_object(handle=\"selected\")"));

    assertFalse(prompt.contains("selected-1、selected-2、selected-3"));
    assertFalse(prompt.contains("Step1 和 ChatExecution"));
    assertFalse(prompt.contains("先读取操作反馈原话，再沿 qualityNodes"));
    assertFalse(prompt.contains("chatRefactor 对话轮次"));
  }

  @Test
  void plannerBasicObjectToolsWithoutBlockImprovementOmitImprovementRules() {
    List<Map<String, Object>> basicTools = List.of(
        Map.of("name", "query_metrics", "input", "{intent}"),
        Map.of("name", "query_objects", "input", "{objectKey}"),
        Map.of("name", "read_object", "input", "{handle}"),
        Map.of("name", "traverse_objects", "input", "{handle, relation}"));
    PlanRequest request = new PlanRequest(
        "查看原型版式列表",
        fullCatalog,
        "2026-10-04", "Asia/Shanghai", Map.of(), List.of(), List.of(), Map.of(),
        List.of(), 4, 1000, 8, basicTools, List.of());

    String prompt = EasyVPlannerPromptBuilder.build(request);

    assertTrue(prompt.contains("query_objects/read_object/traverse_objects 的输入结构见 tools"));
    assertTrue(prompt.contains("TIME 属性的过滤值必须是带时区偏移的 ISO-8601 时间戳"));
    assertTrue(prompt.contains("hasMore=true"));
    assertTrue(prompt.contains("detailOnly=true"));

    assertFalse(prompt.contains("assess_scheme"));
    assertFalse(prompt.contains("inspect_block_improvement"));
    assertFalse(prompt.contains("preview_block_improvement"));
    assertFalse(prompt.contains("choices.chartFamily"));
  }

  @Test
  void plannerBatchSelectedScreensIncludesBatchRulesWithoutSingularOrQualityNoise() {
    var ref1 = new ObjectQueryPort.Reference("easyv-prototype-layout", "app-1", "v1");
    var ref2 = new ObjectQueryPort.Reference("easyv-prototype-layout", "app-2", "v1");
    PlanRequest request = new PlanRequest(
        "检查所选大屏的指标与命名",
        fullCatalog,
        "2026-10-04", "Asia/Shanghai", Map.of(), List.of(), List.of(), Map.of(),
        List.of(), 4, 1000, 4, EasyVAgentTools.catalog(true),
        List.of(
            Map.of("handle", "selected-1", "reference", ref1, "read", true),
            Map.of("handle", "selected-2", "reference", ref2, "read", true)));

    String prompt = EasyVPlannerPromptBuilder.build(request);

    assertTrue(prompt.contains("knownObjects 中 selected-1、selected-2、selected-3 是用户一起选择的大屏"));
    assertTrue(prompt.contains("textFields:[\"title\",\"purpose\"]"));
    assertTrue(prompt.contains("多指标模块不生成此类自动文案候选"));
    assertTrue(prompt.contains("inspect_block_improvement"));
    assertTrue(prompt.contains("preview_block_improvement"));

    assertFalse(prompt.contains("read_object(handle=\"selected\")"));
    assertFalse(prompt.contains("selectedObject.properties"));
    assertFalse(prompt.contains("先读取操作反馈原话，再沿 qualityNodes"));
    assertFalse(prompt.contains("Step1 和 ChatExecution"));
  }

  @Test
  void composerOrdinaryMetricsModeIncludesMarkdownAndExcludesTextReviewAndPrototypeRules() {
    ComposeRequest request = new ComposeRequest(
        "一共创建了多少 AI 应用？",
        "全部数据",
        List.of(Map.of(
            "id", "q1",
            "intent", Map.of("object", "easyv-ai-application", "measures", List.of("count")),
            "rows", List.of(Map.of("count", 42)))),
        List.of(),
        1000);

    String prompt = EasyVComposerPromptBuilder.build(request, false);

    assertTrue(prompt.contains("没有已读对象原文时，普通统计回答使用 markdown 文本"));
    assertTrue(prompt.contains("普通统计的 citations"));
    assertTrue(prompt.contains("highlights 选 0-3 个"));
    assertTrue(prompt.contains("普通统计回答的 suggestedActions"));
    assertTrue(prompt.contains("指标结果 intent 是已执行查询"));
    assertTrue(prompt.contains("北京时间（Asia/Shanghai）"));
    assertTrue(prompt.contains("回答注明数据范围（输入 dataScope）"));

    assertFalse(prompt.contains("source-comparison"));
    assertFalse(prompt.contains("record-review"));
    assertFalse(prompt.contains("\"kind\":\"timeline\""));
    assertFalse(prompt.contains("Step1 是系统理解"));
    assertFalse(prompt.contains("另存标记属于对应时点的生成反馈"));
    assertFalse(prompt.contains("metricRole=core"));
    assertFalse(prompt.contains("inspect_block_improvement"));
    assertFalse(prompt.contains("preview_block_improvement"));
  }

  @Test
  void composerQualityMetricsModeIncludesFeedbackSemanticsWithoutTextReviewFormat() {
    ComposeRequest request = new ComposeRequest(
        "最近 30 天对话轮次和另存数是多少？",
        "全部数据",
        List.of(Map.of(
            "id", "q1",
            "intent", Map.of("object", "easyv-generation-feedback", "measures", List.of("chatRoundCount")),
            "rows", List.of(Map.of("chatRoundCount", 12)))),
        List.of(),
        1000);

    String prompt = EasyVComposerPromptBuilder.build(request, false);

    assertTrue(prompt.contains("普通统计回答的 suggestedActions"));
    assertTrue(prompt.contains("对话次数不证明实际修改次数"));
    assertTrue(prompt.contains("另存是采纳信号，不等于满意"));
    assertTrue(prompt.contains("“被判为不支持”是系统当次的分类"));

    assertFalse(prompt.contains("source-comparison"));
    assertFalse(prompt.contains("record-review"));
    assertFalse(prompt.contains("metricRole=core"));
    assertFalse(prompt.contains("inspect_block_improvement"));
  }

  @Test
  void composerTextEvidenceModeExcludesOrdinaryStatsAndPrototypeImprovementRules() {
    var feedbackType = new ObjectTypeView(EasyVOntologyModel.FEEDBACK.key(), "操作反馈", List.of(
        new PropertyView("userInput", "用户原话", Type.STRING, false, false, false, Map.of())), List.of());
    ComposeRequest request = new ComposeRequest(
        "对照需求原话与系统理解",
        "所选对象",
        List.of(Map.of(
            "id", "q1",
            "tool", "read_object",
            "objectType", feedbackType,
            "textFields", List.of("userInput"),
            "rows", List.of(Map.of("userInput", "CPU 用环形图")))),
        List.of(),
        1000);

    String prompt = EasyVComposerPromptBuilder.build(request, true);

    assertTrue(prompt.contains("source-comparison"));
    assertTrue(prompt.contains("record-review"));
    assertTrue(prompt.contains("\"kind\":\"timeline\""));
    assertTrue(prompt.contains("原文对照与记录回看必须使用 citations=[]、highlights=[]、suggestedActions=[]"));
    assertTrue(prompt.contains("对照需求与理解时先核对输入来源和任务关联"));
    assertTrue(prompt.contains("操作/节点列表有意省略原话"));

    assertFalse(prompt.contains("没有已读对象原文时，普通统计回答使用 markdown 文本"));
    assertFalse(prompt.contains("普通统计的 citations"));
    assertFalse(prompt.contains("highlights 选 0-3 个"));
    assertFalse(prompt.contains("普通统计回答的 suggestedActions"));
    assertFalse(prompt.contains("metricRole=core"));
    assertFalse(prompt.contains("inspect_block_improvement"));
    assertFalse(prompt.contains("指标结果 intent 是已执行查询"));
  }

  @Test
  void composerPrototypePageSemanticsModeIncludesPrototypeAndPageExcerptHintWithoutQualityNoise() {
    var layoutType = new ObjectTypeView(EasyVOntologyModel.PROTOTYPE_LAYOUT.key(), "原型版式", List.of(
        new PropertyView("pageSemantics", "页面与主视觉", Type.STRING, false, false, true, Map.of())), List.of());
    ComposeRequest request = new ComposeRequest(
        "看看整屏的主视觉说明",
        "当前大屏",
        List.of(Map.of(
            "id", "q1",
            "tool", "read_object",
            "objectType", layoutType,
            "textFields", List.of("pageSemantics"),
            "rows", List.of(Map.of("pageSemantics", "[{\"title\":\"大屏\",\"contents\":[]}]")))),
        List.of(),
        1000);

    String prompt = EasyVComposerPromptBuilder.build(request, false);

    assertTrue(prompt.contains("候选名称、布局说明使用普通业务语言"));
    assertTrue(prompt.contains("metricRole=core"));
    assertTrue(prompt.contains("原型版式、区域、组件的分析正文可以概括解释"));
    assertTrue(prompt.contains("摘录 pageSemantics"));

    assertFalse(prompt.contains("source-comparison"));
    assertFalse(prompt.contains("\"kind\":\"timeline\""));
    assertFalse(prompt.contains("另存标记属于对应时点的生成反馈"));
    assertFalse(prompt.contains("inspect_block_improvement"));
  }

  @Test
  void composerBlockImprovementModeIncludesImprovementAndPrototypeRulesWithoutTextReviewNoise() {
    ComposeRequest request = new ComposeRequest(
        "给出块内改造建议",
        "所选区域",
        List.of(
            Map.of("id", "q1", "tool", "inspect_block_improvement", "rows", List.of(Map.of("name", "营收"))),
            Map.of("id", "q2", "tool", "preview_block_improvement", "rows", List.of(Map.of("name", "营收")))),
        List.of(),
        1000);

    String prompt = EasyVComposerPromptBuilder.build(request, false);

    assertTrue(prompt.contains("inspect_block_improvement 是源设计文案与绑定证据"));
    assertTrue(prompt.contains("preview_block_improvement 是模型建议通过绑定/空间检查后的提案"));
    assertTrue(prompt.contains("尚未应用到 EasyV"));
    assertTrue(prompt.contains("气泡图的两个轴可以使用不同量纲"));
    assertTrue(prompt.contains("候选名称、布局说明使用普通业务语言"));
    assertTrue(prompt.contains("metricRole=core"));

    assertFalse(prompt.contains("source-comparison"));
    assertFalse(prompt.contains("record-review"));
    assertFalse(prompt.contains("另存标记属于对应时点的生成反馈"));
    assertFalse(prompt.contains("指标结果 intent 是已执行查询"));
  }
}
