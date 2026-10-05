package com.dip3.ontologyagent.easyv.internal.domain;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.LayoutNode;

class PrototypeGeometryTest {
  private LayoutNode node(String tag,Map<String,String> attributes,LayoutNode... children) { return new LayoutNode(tag,attributes,List.of(children)); }
  @Test void percentageBoxesRequireExplicitUnitsAndBounds() {
    assertEquals("missing",PrototypeComponentGeometry.parse(null).status());
    assertEquals("missing",PrototypeComponentGeometry.parse(Map.of()).status());
    assertEquals("invalid",PrototypeComponentGeometry.parse(List.of()).status());
    for(Object x:List.of(0,"0px","NaN%","101%")) assertEquals("invalid",PrototypeComponentGeometry.parse(Map.of("relativeX",x,"relativeY","0%","width","100%","height","100%")).status());
    var result=PrototypeComponentGeometry.parse(Map.of("relativeX"," 10 % ","relativeY","20%","width","90%","height","80%"));
    assertEquals(new PrototypeComponentGeometry.Box(10,20,90,80),result.box());
    assertEquals("COMPONENT_BOX_BOUNDS_INVALID",PrototypeComponentGeometry.parse(Map.of("relativeX","0%","relativeY","0%","width","0%","height","100%")).errorCode());
  }
  @Test void resolvesDeclaredPagePaddingSpanAndInheritedGap() {
    var block=node("Block",Map.of("id","b","span","6/12"));
    var tree=node("Pages",Map.of(),node("Page",Map.of("width","1200px","height","800"),node("Layout",Map.of("padding","10 20 30","gap","12","grid-direction","horizontal"),block)));
    var result=PrototypeLayoutGeometry.block(tree,"b");
    assertEquals("available",result.status());
    assertEquals(new PrototypeLayoutGeometry.Rect(20,10,574,760),result.bounds());
  }
  @Test void headerDefaultsHorizontalAndBodyVertical() {
    var header=node("Header",Map.of("span","3"),node("Block",Map.of("id","a","span","6")),node("Block",Map.of("id","b","span","6")));
    var body=node("Body",Map.of("span","9"),node("Block",Map.of("id","c","span","12")));
    var page=node("Page",Map.of("width","1200","height","800"),node("Layout",Map.of(),header,body));
    assertEquals(new PrototypeLayoutGeometry.Rect(600,0,600,200),PrototypeLayoutGeometry.block(page,"b").bounds());
    assertEquals(new PrototypeLayoutGeometry.Rect(0,200,1200,600),PrototypeLayoutGeometry.block(page,"c").bounds());
  }
  @Test void missingPageInvalidUnitsAmbiguousBlockAndOverfullSpanDoNotGuess() {
    var block=node("Block",Map.of("id","b","span","13"));
    var missing=node("Page",Map.of(),node("Layout",Map.of(),block));
    assertEquals("PAGE_SIZE_MISSING",PrototypeLayoutGeometry.block(missing,"b").errorCode());
    var invalid=node("Page",Map.of("width","1200%","height","800"),node("Layout",Map.of(),block));
    assertEquals("GEOMETRY_UNIT_INVALID",PrototypeLayoutGeometry.block(invalid,"b").errorCode());
    var page=node("Page",Map.of("width","1200","height","800"),node("Layout",Map.of(),block));
    assertEquals("LAYOUT_SPAN_INVALID",PrototypeLayoutGeometry.block(page,"b").errorCode());
    assertEquals("BLOCK_GEOMETRY_AMBIGUOUS",PrototypeLayoutGeometry.block(node("Pages",Map.of(),page,page),"b").errorCode());
    assertEquals("LAYOUT_NOT_RETAINED",PrototypeLayoutGeometry.block(null,"b").errorCode());
  }
}
