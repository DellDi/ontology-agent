package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;
import com.dip3.ontologyagent.easyv.internal.domain.BlockImprovement.*;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeComponentGeometry.Box;
import com.dip3.ontologyagent.support.BackendException;
import java.util.*;
import org.junit.jupiter.api.Test;

class BlockImprovementTest {
  private final Diagnosis diagnosis = new Diagnosis("主题用于观察门诊效率", "时间变化适合趋势表达", "候诊趋势为主、门诊量为辅");
  private final Set<String> types = EasyVOntologyModel.PROTOTYPE_COMPONENT.requireProperty("chartFamily").valueLabels().keySet();

  @Test void producesExactReplayableAssignmentsWithoutTreatingAProposalAsApplied() {
    var context = context();
    var proposal = proposal("current", List.of(new Choice("component-0", "line", 0, "观察每日变化")));
    var preview = BlockImprovement.preview(context, proposal, types);
    assertEquals("proposal", preview.status());
    assertEquals("line", preview.changes().getFirst().afterChart());
    assertEquals("same-metric", preview.changes().getFirst().metricId());
    assertEquals("bar", context.input().metrics().getFirst().chartFamily());
    assertTrue(preview.pendingChecks().stream().anyMatch(item -> item.contains("尚未应用")));
    assertTrue(preview.pendingChecks().stream().anyMatch(item -> item.contains("字段")));
    assertEquals(preview, BlockImprovement.preview(context, proposal, types));
  }

  @Test void rejectsForeignDuplicateOrRemovedComponentsAndInventedSchemesAndCharts() {
    for (var proposal : List.of(proposal("invented", List.of(new Choice("component-0", "line", 0, "趋势"))),
        proposal("current", List.of(new Choice("other-block-component", "line", 0, "趋势"))),
        proposal("current", List.of(new Choice("component-0", "invented", 0, "趋势"))),
        proposal("current", List.of()),
        proposal("current", List.of(new Choice("component-0", "line", 0, "趋势"), new Choice("component-0", "line", 0, "趋势"))))) {
      code("BLOCK_IMPROVEMENT_INVALID", () -> BlockImprovement.preview(context(), proposal, types));
    }
  }

  @Test void rejectsNoOpMissingSemanticsAndAnUnsupportedCombination() {
    code("BLOCK_IMPROVEMENT_NO_CHANGE", () -> BlockImprovement.preview(context(), proposal("current",
        List.of(new Choice("component-0", "bar", 0, "维持"))), types));
    code("BLOCK_IMPROVEMENT_INFEASIBLE", () -> BlockImprovement.preview(context(), proposal("current",
        List.of(new Choice("component-0", "single-value-metric", 0, "突出数值"))), types));
    var source = context();
    var missing = new Context(source.title(), null, source.metrics(), source.input(), source.schemes());
    code("BLOCK_IMPROVEMENT_INVALID", () -> BlockImprovement.preview(missing, proposal("current",
        List.of(new Choice("component-0", "line", 0, "趋势"))), types));
    var noDescription = new Metric("component-0", "same-metric", "门诊量", null, null, "人次", null, "bar");
    code("BLOCK_IMPROVEMENT_INVALID", () -> BlockImprovement.preview(new Context(source.title(), source.purpose(),
        List.of(noDescription), source.input(), source.schemes()), proposal("current", List.of(new Choice("component-0", "line", 0, "趋势"))), types));
  }

  @Test void appliesTheMatchingByComponentInstanceEvenWhenMetricIdsRepeat() {
    var input = SchemeAdaptationTest.input(List.of("bar", "bar"), List.of(new Box(0,0,50,100), new Box(50,0,50,100)));
    var scheme = SchemeAdaptationTest.candidate("new", List.of(
        SchemeAdaptationTest.slot(0,"summary",List.of("indicator"),"0%","0%","100%","30%"),
        SchemeAdaptationTest.slot(1,"main",List.of("chart"),"0%","30%","100%","70%")));
    var context = new Context("门诊效率", "看清候诊效率与业务量", List.of(metric("component-0"), metric("component-1")), input, List.of(scheme));
    code("BLOCK_IMPROVEMENT_INFEASIBLE", () -> BlockImprovement.preview(context, proposal("new", List.of(
        new Choice("component-0", "line", 0, "趋势为主"), new Choice("component-1", "single-value-metric", 1, "总量为辅"))), types));
    code("BLOCK_IMPROVEMENT_INVALID", () -> BlockImprovement.preview(context, proposal("new", List.of(
        new Choice("component-0", "line", 0, "趋势为主"), new Choice("component-1", "single-value-metric", 0, "总量为辅"))), types));
    var preview = BlockImprovement.preview(context, proposal("new", List.of(new Choice("component-0","line", 1,"趋势为主"),
        new Choice("component-1","single-value-metric", 0,"总量为辅"))), types);
    assertEquals(List.of("component-1", "component-0"), preview.placement().assignments().stream().map(SchemeAdaptation.Assignment::componentId).toList());
    assertEquals(List.of(0, 1), preview.changes().stream().map(Change::afterSlot).toList());
    assertEquals(List.of(1, 0), preview.changes().stream().map(Change::beforeSlot).toList());
  }

  private Context context() {
    return new Context("门诊效率", "看清候诊效率与业务量", List.of(metric("component-0")),
        SchemeAdaptationTest.input(List.of("bar"), List.of(new Box(0,0,100,100))), List.of(SchemeAdaptationTest.one("current")));
  }
  @Test void textOnlyProposalPreservesTheExistingLayoutAndRejectsBlankOrUnchangedText() {
    var context = context();
    var preview = BlockImprovement.preview(context, new Proposal(null, List.of(), diagnosis, List.of(), "门诊量趋势", "比较每日门诊量"), types);
    assertEquals("门诊量趋势", preview.textChange().afterTitle());
    assertEquals(context.title(), preview.textChange().beforeTitle());
    assertTrue(preview.changes().isEmpty());
    assertNull(preview.placement());
    code("BLOCK_IMPROVEMENT_NO_CHANGE", () -> BlockImprovement.preview(context,
        new Proposal(null, List.of(), diagnosis, List.of(), context.title(), context.purpose()), types));
    code("BLOCK_IMPROVEMENT_INVALID", () -> BlockImprovement.preview(context,
        new Proposal(null, List.of(), diagnosis, List.of(), " ", null), types));
  }
  private Metric metric(String component) { return new Metric(component,"same-metric","门诊量","每日接诊人次",null,"人次","按日求和","bar"); }
  private Proposal proposal(String scheme, List<Choice> choices) { return new Proposal(scheme, choices, diagnosis, List.of()); }
  private static void code(String code, Runnable action) { assertEquals(code, assertThrows(BackendException.class, action::run).code()); }
}
