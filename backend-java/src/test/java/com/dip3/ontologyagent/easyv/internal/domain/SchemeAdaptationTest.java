package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;
import static com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation.compare;
import java.util.*;
import org.junit.jupiter.api.Test;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeComponentGeometry.*;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeLayoutGeometry.Rect;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.MetricBinding;
import com.dip3.ontologyagent.easyv.internal.domain.SchemeLibraryParser.*;
import com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation.*;

class SchemeAdaptationTest {
  static Slot slot(int index,String role,List<String> categories,String x,String y,String width,String height) {
    return new Slot(index,"1",role,1,new Position(1,1,12,12),new Config(x,y,width,height),categories,List.of());
  }
  static Candidate candidate(String id,List<Slot> slots) { return new Candidate(id,"type",slots.size(),"available",null,slots); }
  static Input input(List<String> families,List<Box> boxes) {
    List<MetricBinding> metrics=new ArrayList<>(); List<Component> components=new ArrayList<>();
    for(int i=0;i<families.size();i++) { metrics.add(new MetricBinding(i,"component-"+i,"same-metric",families.get(i),null,null));
      components.add(new Component("component-"+i,new PrototypeComponentGeometry.Parsed("available",null,boxes.get(i)))); }
    return new Input("type","current",new Rect(0,0,1000,700),false,"available",metrics,components);
  }
  static Candidate one(String id) { return candidate(id,List.of(slot(0,"main",List.of("chart"),"0%","0%","100%","100%"))); }

  @Test void matchesInstancesAcrossSlotsInsteadOfZippingOrCollapsingDuplicateMetricIds() {
    var input=input(List.of("bar","single-value-metric"),List.of(new Box(0,0,100,70),new Box(0,70,100,30)));
    var swapped=candidate("current",List.of(slot(0,"summary",List.of("indicator"),"0%","0%","100%","30%"),
        slot(1,"main",List.of("chart"),"0%","30%","100%","70%")));
    var comparison=compare(input,List.of(swapped));
    assertEquals("infeasible",comparison.current().status());
    var result=comparison.candidates().getFirst();
    assertEquals("feasible",result.status());
    assertEquals(List.of("component-1","component-0"),result.assignments().stream().map(Assignment::componentId).toList());
    assertTrue(result.score()>=0 && result.score()<=100);
    assertEquals("easyv-adaptation-v1",comparison.rules().version());
    assertEquals("heuristic_pending_real_data_calibration",comparison.rules().calibration());
    assertEquals(result,compare(input,List.of(swapped)).candidates().getFirst());
  }
  @Test void evaluatesCurrentEditedGeometrySeparatelyFromLibraryProposal() {
    var input=input(List.of("bar"),List.of(new Box(0,0,10,10)));
    var result=compare(input,List.of(one("current")));
    assertEquals("infeasible",result.current().status());
    assertNull(result.current().score());
    assertTrue(result.current().findings().stream().anyMatch(f -> f.code().equals("MINIMUM_SIZE_NOT_MET")));
    assertEquals("feasible",result.candidates().getFirst().status());
  }
  @Test void minimumBoundaryUsesEffectiveDimensionsAndConditionalTitleReserve() {
    var original=input(List.of("bar"),List.of(new Box(0,0,100,100)));
    var exact=new Input("type","current",new Rect(0,0,266,186),false,"available",original.metrics(),original.components());
    var result=compare(exact,List.of(one("current")));
    assertEquals("feasible",result.current().status());
    assertEquals(0,result.current().assignments().getFirst().readability());
    var titled=new Input("type","current",exact.bounds(),true,"available",original.metrics(),original.components());
    assertEquals("infeasible",compare(titled,List.of(one("current"))).current().status());
    var below=new Input("type","current",new Rect(0,0,265.99,186),false,"available",original.metrics(),original.components());
    assertEquals("infeasible",compare(below,List.of(one("current"))).current().status());
  }
  @Test void adjacentSlotsDeductHalfGapOnEachEdge() {
    var input=input(List.of("bar","bar"),List.of(new Box(0,0,50,100),new Box(50,0,50,100)));
    var scheme=candidate("current",List.of(slot(0,"main",List.of("chart"),"0%","0%","50%","100%"),slot(1,"main",List.of("chart"),"50%","0%","50%","100%")));
    var assignments=compare(input,List.of(scheme)).current().assignments();
    assertEquals(479,assignments.get(0).bounds().width());
    assertEquals(16,assignments.get(1).bounds().x()-assignments.get(0).bounds().x()-assignments.get(0).bounds().width());
  }
  @Test void missingInputsUnknownTypesAndLegacyGeometryNeverManufactureScore() {
    var original=input(List.of("bar"),List.of(new Box(0,0,100,100)));
    for(Input input:List.of(new Input("type","current",null,false,"available",original.metrics(),original.components()),
        new Input("type","current",original.bounds(),null,"available",original.metrics(),original.components()),
        new Input("type","current",original.bounds(),false,"not_retained",null,original.components()),
        input(List.of("unknown"),List.of(new Box(0,0,100,100))))) {
      var result=compare(input,List.of(one("current")));
      assertEquals("unassessable",result.current().status());assertNull(result.current().score());
      assertEquals("unassessable",result.candidates().getFirst().status());
    }
    var old=new Input("type","current",original.bounds(),false,"available",original.metrics(),List.of(new Component("component-0",null)));
    assertEquals("unassessable",compare(old,List.of(one("current"))).current().status());
    assertEquals("feasible",compare(old,List.of(one("current"))).candidates().getFirst().status());
  }
  @Test void explicitEmptyCategoriesRejectAllRatherThanAllowAll() {
    var input=input(List.of("bar"),List.of(new Box(0,0,100,100)));
    var scheme=candidate("current",List.of(slot(0,"main",List.of(),"0%","0%","100%","100%")));
    assertEquals("infeasible",compare(input,List.of(scheme)).current().status());
    var unknown=candidate("current",List.of(slot(0,"main",List.of("basic"),"0%","0%","100%","100%")));
    assertEquals("unassessable",compare(input,List.of(unknown)).current().status());
  }
  @Test void rejectsOverlapWrongCountWrongBlockTypeAndUnknownUnits() {
    var input=input(List.of("bar","bar"),List.of(new Box(0,0,50,100),new Box(50,0,50,100)));
    var overlapping=candidate("overlap",List.of(slot(0,"main",List.of("chart"),"0%","0%","100%","100%"),slot(1,"main",List.of("chart"),"0%","0%","100%","100%")));
    var other=new Candidate("other","wrong",1,"available",null,one("x").slots());
    var unit=candidate("unit",List.of(slot(0,"main",List.of("chart"),"0px","0%","100%","100%")));
    var results=compare(input,List.of(overlapping,other,one("count"),unit)).candidates();
    assertEquals("SLOT_OVERLAP",results.stream().filter(a -> a.schemeId().equals("overlap")).findFirst().orElseThrow().findings().getFirst().code());
    assertEquals("BLOCK_TYPE_MISMATCH",results.stream().filter(a -> a.schemeId().equals("other")).findFirst().orElseThrow().findings().getFirst().code());
    assertEquals("SLOT_COUNT_MISMATCH",results.stream().filter(a -> a.schemeId().equals("count")).findFirst().orElseThrow().findings().getFirst().code());
    assertEquals("unassessable",results.stream().filter(a -> a.schemeId().equals("unit")).findFirst().orElseThrow().status());
  }
  @Test void hallConstraintRejectsWhenEachSlotHasAnEdgeButNoPerfectMatching() {
    var input=input(List.of("bar","single-value-metric"),List.of(new Box(0,0,50,100),new Box(50,0,50,100)));
    var scheme=candidate("current",List.of(slot(0,"main",List.of("chart"),"0%","0%","50%","100%"),slot(1,"main",List.of("chart"),"50%","0%","50%","100%")));
    var result=compare(input,List.of(scheme)).candidates().getFirst();
    assertEquals("infeasible",result.status());assertNull(result.score());
    assertTrue(result.findings().stream().anyMatch(f -> f.code().equals("NO_FEASIBLE_ASSIGNMENT")));
  }
  @Test void currentMissingAndTooManyMetricsAreExplicit() {
    var input=input(List.of("bar"),List.of(new Box(0,0,100,100)));
    assertEquals("CURRENT_SCHEME_NOT_RETAINED",compare(input,List.of(one("other"))).current().findings().getFirst().code());
    var large=input(Collections.nCopies(8,"bar"),Collections.nCopies(8,new Box(0,0,100,100)));
    assertEquals("METRIC_COUNT_UNSUPPORTED",compare(large,List.of(one("current"))).current().findings().getFirst().code());
  }
}
