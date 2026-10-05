package com.dip3.ontologyagent.easyv.internal.domain;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import java.util.TreeMap;
import java.util.stream.Collectors;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

/**
 * 原型结构解析：布局 XML 提供版式骨架，原型 JSON 提供方案与图表组件。
 *
 * <p>只提取结构化事实（标识、类别、几何、计数），标题、描述、指标名称等自由文本一律不进入结果。
 * 解析失败不抛出，而是返回带状态与可定位错误码的结果，使无效结构在事实层可见、可统计，
 * 不被静默丢弃，也不被兜底成空结构。
 */
public final class PrototypeStructureParser {
  private static final int MAX_DETAIL = 500;
  private static final int MAX_LISTED_IDS = 10;
  private static final Set<String> LAYOUT_ATTRIBUTES = Set.of(
      "id", "type", "width", "height", "x", "y", "grid-direction", "gridDirection",
      "span", "gap", "padding", "ref", "block_type_id", "blockSize", "weight");

  private PrototypeStructureParser() {}

  public enum Status {
    OK("ok"),
    INVALID_XML("invalid_xml"),
    INVALID_JSON("invalid_json"),
    INCONSISTENT("inconsistent");

    private final String code;

    Status(String code) {
      this.code = code;
    }

    public String code() {
      return code;
    }
  }

  public record Component(
      String componentId, String chartFamily, String libraryComponentId, String sceneType,
      String sourceType, Integer gridCol, Integer gridRow, Integer gridColSpan, Integer gridRowSpan,
      PrototypeComponentGeometry.Parsed geometry) {}

  /** Export 将 components 与 boundMetricIds 按 slotIndex 排序后同序输出；不保留指标自由文本。 */
  public record MetricBinding(int slotIndex, String componentId, String metricId,
      String chartFamily, String sceneType, String sourceType) {}

  public record Block(
      String blockId, String containerTag, String containerId, String gridDirection,
      String blockTypeId, String blockSize, String span, Integer weight, String schemeId,
      List<Component> components, String metricBindingStatus, List<MetricBinding> metricBindings, Boolean titlePresent) {}

  /** 画布所需的源结构；子节点顺序决定布局，不保留名称、描述或其他自由文本。 */
  public record LayoutNode(String tag, Map<String, String> attributes, List<LayoutNode> children) {}

  public record Parsed(
      Status status, String errorCode, String errorDetail, String layoutType, List<Block> blocks,
      String layoutSignature, String schemeSignature, String countSignature, String chartSignature,
      LayoutNode layoutStructure) {
    public int componentCount() {
      return blocks.stream().mapToInt(block -> block.components().size()).sum();
    }
  }

  public static Parsed parse(String xml, Object prototypeJson) {
    Element root;
    Element layout;
    List<Element> xmlBlocks;
    try {
      root = readXml(xml);
      layout = firstLayout(root);
      xmlBlocks = elements(root.getElementsByTagName("Block"));
    } catch (ParseFailure failure) {
      return failed(Status.INVALID_XML, failure.code, failure.getMessage(), null);
    }
    String layoutType = blankToNull(layout.getAttribute("type"));

    Map<String, Object> jsonBlocks;
    try {
      jsonBlocks = readJsonBlocks(prototypeJson);
    } catch (ParseFailure failure) {
      return failed(Status.INVALID_JSON, failure.code, failure.getMessage(), layoutType);
    }

    List<Block> blocks = new ArrayList<>();
    Set<String> seenComponents = new HashSet<>();
    Set<String> xmlIds = new LinkedHashSet<>();
    try {
      for (Element element : xmlBlocks) {
        String id = blankToNull(element.getAttribute("id"));
        if (id == null || !xmlIds.add(id)) {
          throw new ParseFailure("XML_BLOCK_INVALID", "Block id 缺失或重复: " + id);
        }
      }
    } catch (ParseFailure failure) {
      return failed(Status.INVALID_XML, failure.code, failure.getMessage(), layoutType);
    }
    if (!xmlIds.equals(jsonBlocks.keySet())) {
      return failed(Status.INCONSISTENT, "BLOCK_SET_MISMATCH", mismatch(xmlIds, jsonBlocks.keySet()), layoutType);
    }
    try {
      for (Element element : xmlBlocks) {
        String id = element.getAttribute("id");
        blocks.add(block(element, id, jsonBlocks.get(id), seenComponents));
      }
    } catch (ParseFailure failure) {
      Status status = failure.code.startsWith("XML_") ? Status.INVALID_XML : Status.INVALID_JSON;
      return failed(status, failure.code, failure.getMessage(), layoutType);
    }

    String layoutCanon = layoutCanon(layoutType, blocks);
    String schemeCanon = layoutCanon + "#" + lines(blocks, block -> position(block.blockId()) + "=" + nullToEmpty(block.schemeId()));
    String countCanon = schemeCanon + "#" + lines(blocks, block -> position(block.blockId()) + "=" + block.components().size());
    String chartCanon = countCanon + "#" + lines(blocks, block -> position(block.blockId()) + "="
        + block.components().stream().map(Component::chartFamily).sorted().collect(Collectors.joining(",")));
    return new Parsed(Status.OK, null, null, layoutType, List.copyOf(blocks),
        sha256(layoutCanon), sha256(schemeCanon), sha256(countCanon), sha256(chartCanon), layoutNode(root));
  }

  private static LayoutNode layoutNode(Element element) {
    Map<String, String> attributes = new TreeMap<>();
    for (String name : LAYOUT_ATTRIBUTES) {
      String value = blankToNull(element.getAttribute(name));
      if (value != null) attributes.put(name, value);
    }
    List<LayoutNode> children = new ArrayList<>();
    NodeList nodes = element.getChildNodes();
    for (int index = 0; index < nodes.getLength(); index++) {
      if (nodes.item(index) instanceof Element child) children.add(layoutNode(child));
    }
    return new LayoutNode(element.getTagName(), Collections.unmodifiableMap(attributes), List.copyOf(children));
  }

  private static Parsed failed(Status status, String code, String detail, String layoutType) {
    return new Parsed(status, code, truncate(detail), layoutType, List.of(), null, null, null, null, null);
  }

  private static Element readXml(String xml) {
    if (xml == null || xml.isBlank()) throw new ParseFailure("XML_MISSING", "布局 XML 为空");
    try {
      DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
      factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      DocumentBuilder builder = factory.newDocumentBuilder();
      builder.setErrorHandler(null);
      return builder.parse(new InputSource(new StringReader(xml))).getDocumentElement();
    } catch (Exception error) {
      throw new ParseFailure("XML_MALFORMED", "布局 XML 无法解析: " + error.getClass().getSimpleName());
    }
  }

  private static Element firstLayout(Element root) {
    NodeList layouts = root.getElementsByTagName("Layout");
    if (layouts.getLength() == 0) throw new ParseFailure("XML_NO_LAYOUT", "布局 XML 没有 Layout 节点");
    return (Element) layouts.item(0);
  }

  private static Map<String, Object> readJsonBlocks(Object json) {
    if (json == null) throw new ParseFailure("JSON_MISSING", "原型 JSON 为空");
    if (!(json instanceof Map<?, ?> root)) throw new ParseFailure("JSON_NOT_OBJECT", "原型 JSON 不是对象");
    Map<String, Object> merged = new LinkedHashMap<>();
    for (Map.Entry<?, ?> page : root.entrySet()) {
      if (!(page.getKey() instanceof String key) || !key.startsWith("page-")) continue;
      if (page.getValue() instanceof Map<?, ?> content && content.get("blocks") instanceof Map<?, ?> blocks) {
        for (Map.Entry<?, ?> entry : blocks.entrySet()) merged.put(String.valueOf(entry.getKey()), entry.getValue());
      }
    }
    if (merged.isEmpty()) throw new ParseFailure("JSON_NO_BLOCKS", "原型 JSON 没有任何页面区域");
    return merged;
  }

  private static Block block(Element element, String id, Object jsonBlock, Set<String> seenComponents) {
    if (!(jsonBlock instanceof Map<?, ?> content)) {
      throw new ParseFailure("BLOCK_INVALID", "区域内容不是对象: " + id);
    }
    Element parent = element.getParentNode() instanceof Element p ? p : null;
    List<Component> components = new ArrayList<>();
    Object rawComponents = content.get("components");
    if (rawComponents != null && !(rawComponents instanceof List<?>)) {
      throw new ParseFailure("COMPONENT_INVALID", "components 不是数组: " + id);
    }
    if (rawComponents instanceof List<?> list) {
      for (Object raw : list) components.add(component(id, raw, seenComponents));
    }
    Object rawMetricIds = content.get("boundMetricIds");
    String bindingStatus = rawMetricIds == null ? "not_retained" : "invalid";
    List<MetricBinding> bindings = null;
    if (rawMetricIds instanceof List<?> ids && ids.size() == components.size()
        && ids.stream().allMatch(value -> value instanceof String s && !s.isBlank())) {
      bindings = new ArrayList<>();
      for (int index = 0; index < components.size(); index++) {
        Component component = components.get(index);
        bindings.add(new MetricBinding(index, component.componentId(), (String) ids.get(index),
            component.chartFamily(), component.sceneType(), component.sourceType()));
      }
      bindings = List.copyOf(bindings);
      bindingStatus = "available";
    }
    return new Block(id,
        parent == null ? null : parent.getTagName(),
        parent == null ? null : blankToNull(parent.getAttribute("id")),
        parent == null ? null : blankToNull(parent.getAttribute("grid-direction")),
        blankToNull(element.getAttribute("block_type_id")), blankToNull(element.getAttribute("blockSize")),
        blankToNull(element.getAttribute("span")), weight(id, element.getAttribute("weight")),
        content.get("schemeId") == null ? null : String.valueOf(content.get("schemeId")),
        List.copyOf(components), bindingStatus, bindings, content.get("title") == null ? false
            : content.get("title") instanceof String title ? !title.isBlank() : null);
  }

  private static Component component(String blockId, Object raw, Set<String> seen) {
    if (!(raw instanceof Map<?, ?> map)) throw new ParseFailure("COMPONENT_INVALID", "组件不是对象: " + blockId);
    String id = text(map.get("id"));
    String family = text(map.get("chartFamily"));
    if (id == null || family == null) {
      throw new ParseFailure("COMPONENT_INVALID", "组件缺少 id 或 chartFamily: " + blockId);
    }
    if (!seen.add(id)) throw new ParseFailure("COMPONENT_INVALID", "组件 id 重复: " + blockId + "/" + id);
    Map<?, ?> grid = map.get("config") instanceof Map<?, ?> config && config.get("gridPosition") instanceof Map<?, ?> g
        ? g : Map.of();
    return new Component(id, family, text(map.get("componentId")), text(map.get("sceneType")),
        text(map.get("sourceType")), integer(grid.get("col")), integer(grid.get("row")),
        integer(grid.get("colSpan")), integer(grid.get("rowSpan")), PrototypeComponentGeometry.parse(map.get("config")));
  }

  private static Integer weight(String blockId, String value) {
    if (value == null || value.isBlank()) return null;
    try {
      return Integer.valueOf(value.trim());
    } catch (NumberFormatException error) {
      throw new ParseFailure("XML_BLOCK_INVALID", "Block weight 不是整数: " + blockId);
    }
  }

  private static String layoutCanon(String layoutType, List<Block> blocks) {
    return nullToEmpty(layoutType) + "#" + lines(blocks, block -> String.join("|", position(block.blockId()),
        nullToEmpty(block.containerTag()), nullToEmpty(block.blockTypeId()),
        nullToEmpty(block.blockSize()), nullToEmpty(block.span())));
  }

  private static String lines(List<Block> blocks, java.util.function.Function<Block, String> line) {
    return blocks.stream().map(line).sorted().collect(Collectors.joining(";"));
  }

  /** 区域在版式中的位置标识：去掉页面前缀，使不同应用的同一位置可比较。 */
  private static String position(String blockId) {
    int index = blockId.indexOf("__");
    return index < 0 ? blockId : blockId.substring(index + 2);
  }

  private static String mismatch(Set<String> xmlIds, Set<String> jsonIds) {
    Set<String> xmlOnly = new TreeSet<>(xmlIds);
    xmlOnly.removeAll(jsonIds);
    Set<String> jsonOnly = new TreeSet<>(jsonIds);
    jsonOnly.removeAll(xmlIds);
    return "xmlOnly=" + limited(xmlOnly) + " jsonOnly=" + limited(jsonOnly);
  }

  private static String limited(Set<String> ids) {
    List<String> shown = ids.stream().limit(MAX_LISTED_IDS).toList();
    return shown + (ids.size() > shown.size() ? "+" + (ids.size() - shown.size()) : "");
  }

  private static List<Element> elements(NodeList nodes) {
    List<Element> result = new ArrayList<>(nodes.getLength());
    for (int index = 0; index < nodes.getLength(); index++) result.add((Element) nodes.item(index));
    return result;
  }

  private static String text(Object value) {
    if (value == null) return null;
    String text = String.valueOf(value);
    return text.isBlank() ? null : text;
  }

  private static Integer integer(Object value) {
    return value instanceof Number number ? Integer.valueOf(number.intValue()) : null;
  }

  private static String blankToNull(String value) {
    return value == null || value.isBlank() ? null : value;
  }

  private static String nullToEmpty(String value) {
    return Objects.requireNonNullElse(value, "");
  }

  private static String truncate(String value) {
    return value == null || value.length() <= MAX_DETAIL ? value : value.substring(0, MAX_DETAIL);
  }

  private static String sha256(String canonical) {
    try {
      return HexFormat.of().formatHex(
          MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException error) {
      throw new IllegalStateException("SHA-256 is unavailable", error);
    }
  }

  private static final class ParseFailure extends RuntimeException {
    private final String code;

    private ParseFailure(String code, String message) {
      super(message, null, false, false);
      this.code = code;
    }
  }
}
