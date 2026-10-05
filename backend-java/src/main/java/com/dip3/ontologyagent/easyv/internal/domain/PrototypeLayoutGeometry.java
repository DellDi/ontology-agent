package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.LayoutNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 源端 12 栅格的区域外框。只采用声明的页面尺寸，不猜旧版缺失结构。 */
public final class PrototypeLayoutGeometry {
  private PrototypeLayoutGeometry() {}
  public record Rect(double x, double y, double width, double height) {}
  public record Result(String status, String errorCode, Rect bounds) {}

  public static Result block(LayoutNode root, String blockId) {
    if (root == null) return new Result("unavailable", "LAYOUT_NOT_RETAINED", null);
    try {
      List<LayoutNode> pages = new ArrayList<>(); pages(root, pages);
      List<LayoutNode> matches = pages.stream().filter(page -> contains(page, blockId)).toList();
      if (matches.size() != 1) throw invalid("BLOCK_GEOMETRY_AMBIGUOUS");
      LayoutNode page = matches.getFirst();
      double width = number(page.attributes().get("width"), null), height = number(page.attributes().get("height"), null);
      if (width <= 0 || height <= 0) throw invalid("PAGE_SIZE_INVALID");
      var layouts = page.children().stream().filter(n -> tag(n, "layout")).toList();
      if (layouts.size() != 1) throw invalid("LAYOUT_COUNT_INVALID");
      LayoutNode layout = layouts.getFirst(); Map<String, String> attributes = layout.attributes();
      double[] padding = padding(attributes.get("padding"));
      Rect rect = new Rect(number(attributes.get("x"), 0.0) + padding[3], number(attributes.get("y"), 0.0) + padding[0],
          number(attributes.get("width"), width) - padding[1] - padding[3], number(attributes.get("height"), height) - padding[0] - padding[2]);
      if (rect.width() <= 0 || rect.height() <= 0 || rect.x()+rect.width() > width || rect.y()+rect.height() > height) throw invalid("LAYOUT_BOUNDS_INVALID");
      List<Rect> found = new ArrayList<>();
      walk(layout, rect, number(attributes.get("gap"), 0.0), blockId, found);
      if (found.size() != 1) throw invalid("BLOCK_GEOMETRY_AMBIGUOUS");
      return new Result("available", null, found.getFirst());
    } catch (InvalidGeometry failure) {
      return new Result("unavailable", failure.code, null);
    }
  }
  private static void pages(LayoutNode node, List<LayoutNode> result) {
    if (tag(node,"page")) result.add(node); else node.children().forEach(child -> pages(child,result));
  }
  private static boolean contains(LayoutNode node, String id) {
    return (tag(node,"block") && id.equals(node.attributes().get("id"))) || node.children().stream().anyMatch(child -> contains(child,id));
  }
  private static boolean tag(LayoutNode node, String value) { return value.equalsIgnoreCase(node.tag()); }
  private static void walk(LayoutNode node, Rect rect, double inheritedGap, String id, List<Rect> found) {
    if (tag(node,"block")) { if (id.equals(node.attributes().get("id"))) found.add(rect); return; }
    if (tag(node,"content")) return;
    double gap = number(node.attributes().get("gap"), inheritedGap);
    String direction = node.attributes().getOrDefault("grid-direction", node.attributes().get("gridDirection"));
    if (direction != null && !List.of("horizontal","vertical").contains(direction)) throw invalid("LAYOUT_DIRECTION_INVALID");
    boolean horizontal = "horizontal".equals(direction) || (direction == null && (tag(node,"header") || tag(node,"footer")));
    List<LayoutNode> directBlocks = node.children().stream().filter(child -> tag(child,"block")).toList();
    var children = directBlocks.isEmpty() ? node.children() : directBlocks;
    boolean hasSpan = children.stream().anyMatch(child -> child.attributes().containsKey("span"));
    int total = 0;
    double length = horizontal ? rect.width() : rect.height();
    if (gap * 11 >= length && !children.isEmpty()) throw invalid("LAYOUT_GAP_INVALID");
    double cell = (length - gap * 11) / 12;
    for (int index=0; index<children.size(); index++) {
      LayoutNode child = children.get(index);
      int span = hasSpan || !directBlocks.isEmpty() ? span(child.attributes().get("span"))
          : 12 / children.size() + (index < 12 % children.size() ? 1 : 0);
      if (span < 1 || total + span > 12) throw invalid("LAYOUT_SPAN_INVALID");
      double offset=total*(cell+gap), size=span*cell+(span-1)*gap;
      walk(child, horizontal ? new Rect(rect.x()+offset,rect.y(),size,rect.height())
          : new Rect(rect.x(),rect.y()+offset,rect.width(),size), gap,id,found);
      total+=span;
    }
  }
  private static int span(String value) {
    if (value == null) return 1; // 源端缺省 span=1 格，属于几何契约。
    if (!value.matches("\\s*\\d+(?:\\.\\d+)?(?:/\\d+(?:\\.\\d+)?)?\\s*")) throw invalid("LAYOUT_SPAN_INVALID");
    String[] parts=value.trim().split("/");
    double result=Double.parseDouble(parts[0]);
    if (parts.length==2) result=result/Double.parseDouble(parts[1])*12;
    if (!Double.isFinite(result) || result!=Math.rint(result) || result<1 || result>12) throw invalid("LAYOUT_SPAN_INVALID");
    return (int) result;
  }
  private static double number(String value, Double defaultValue) {
    if (value==null) { if (defaultValue!=null) return defaultValue; throw invalid("PAGE_SIZE_MISSING"); }
    if (!value.matches("\\s*[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:px)?\\s*")) throw invalid("GEOMETRY_UNIT_INVALID");
    double result=Double.parseDouble(value.trim().replace("px",""));
    if (!Double.isFinite(result) || result<0) throw invalid("GEOMETRY_NUMBER_INVALID");
    return result;
  }
  private static double[] padding(String text) {
    if (text==null) return new double[]{0,0,0,0};
    String[] parts=text.trim().split("\\s+");
    if (parts.length>4) throw invalid("LAYOUT_PADDING_INVALID");
    double top=number(parts[0],null),right=parts.length>1?number(parts[1],null):top;
    double bottom=parts.length>2?number(parts[2],null):top,left=parts.length>3?number(parts[3],null):right;
    return new double[]{top,right,bottom,left};
  }
  private static InvalidGeometry invalid(String code) { return new InvalidGeometry(code); }
  private static final class InvalidGeometry extends RuntimeException {
    private final String code;
    private InvalidGeometry(String code) { super(code,null,false,false);this.code=code; }
  }
}
