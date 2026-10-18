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
 * <p>保留结构事实和源导出明确提供的页面、模块、指标语义；不读取任意配置或推断业务含义。
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
      PrototypeComponentGeometry.Parsed geometry, MetricSemantics semantics) {}

  /** Export 将 components 与 boundMetricIds 按 slotIndex 排序后同序输出；绑定引用与业务文案分开保留。 */
  public record MetricBinding(int slotIndex, String componentId, String metricId,
      String chartFamily, String sceneType, String sourceType) {}

  public record MetricSemantics(String name, String description, String insight, String unit, String aggregationRule) {}

  public record MainMetric(String id, String name, String description, String sceneType, String sourceType) {}
  public record MainContent(String id, String title, String description, List<MainMetric> metrics) {}
  public record PageSemantics(String pageId, String title, List<MainContent> contents) {}

  public record Block(
      String blockId, String containerTag, String containerId, String gridDirection,
      String blockTypeId, String blockSize, String span, Integer weight, String schemeId,
      List<Component> components, String metricBindingStatus, List<MetricBinding> metricBindings, Boolean titlePresent, String pageId, String pageTitle,
      String title, String businessModule, String moduleDescription, String interactionDescription) {}

  /** 画布所需的源结构；子节点顺序决定布局，不保留名称、描述或其他自由文本。 */
  public record LayoutNode(String tag, Map<String, String> attributes, List<LayoutNode> children) {}

  public record Parsed(
      Status status, String errorCode, String errorDetail, String layoutType, List<Block> blocks,
      String layoutSignature, String schemeSignature, String countSignature, String chartSignature,
      LayoutNode layoutStructure, List<PageSemantics> pages) {
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

    List<PageSemantics> pages;
    try { pages = pageSemantics((Map<?, ?>) prototypeJson); }
    catch (ParseFailure failure) { return failed(Status.INVALID_JSON, failure.code, failure.getMessage(), layoutType); }

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
        PageSemantics page = pages.stream().filter(candidate ->
            ((Map<?, ?>) ((Map<?, ?>) prototypeJson).get(candidate.pageId())).get("blocks") instanceof Map<?, ?> entries
                && entries.containsKey(id)).findFirst().orElseThrow();
        blocks.add(block(element, id, jsonBlocks.get(id), seenComponents, page));
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
        sha256(layoutCanon), sha256(schemeCanon), sha256(countCanon), sha256(chartCanon), layoutNode(root), pages);
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
    return new Parsed(status, code, truncate(detail), layoutType, List.of(), null, null, null, null, null, List.of());
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

  private static Block block(Element element, String id, Object jsonBlock, Set<String> seenComponents, PageSemantics page) {
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
      for (int slot = 0; slot < list.size(); slot++) {
        Map<?, ?> metric = boundMetric(content, slot, list.size());
        components.add(component(id, list.get(slot), seenComponents, metric));
      }
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
        content.get("blockTypeId") == null ? blankToNull(element.getAttribute("block_type_id")) : text(content.get("blockTypeId")),
        blankToNull(element.getAttribute("blockSize")),
        blankToNull(element.getAttribute("span")), weight(id, element.getAttribute("weight")),
        content.get("schemeId") == null ? null : String.valueOf(content.get("schemeId")),
        List.copyOf(components), bindingStatus, bindings, content.get("title") == null ? false
            : content.get("title") instanceof String title ? !title.isBlank() : null,
        page.pageId(), page.title(), businessText(content, "title", id), businessText(content, "businessModule", id),
        sourceText(content, "moduleDescription"), sourceText(content, "interactionDescription"));
  }

  private static Component component(String blockId, Object raw, Set<String> seen, Map<?, ?> metric) {
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
        integer(grid.get("colSpan")), integer(grid.get("rowSpan")), PrototypeComponentGeometry.parse(map.get("config")),
        new MetricSemantics(sourceText(map, "metricName"), sourceText(map, "desc"), sourceText(map, "insight"),
            sourceText(metric, "unit"), sourceText(metric, "aggregationRule")));
  }

  private static List<PageSemantics> pageSemantics(Map<?, ?> root) {
    List<PageSemantics> pages = new ArrayList<>();
    for (var entry : root.entrySet()) {
      if (!(entry.getKey() instanceof String id) || !id.startsWith("page-")) continue;
      if (!(entry.getValue() instanceof Map<?, ?> page)) throw new ParseFailure("PAGE_INVALID", "页面不是对象: " + id);
      List<MainContent> contents = null;
      if (page.get("contents") != null) {
        if (!(page.get("contents") instanceof List<?> list)) throw new ParseFailure("MAIN_CONTENT_INVALID", "主视觉不是数组: " + id);
        contents = new ArrayList<>();
        for (Object raw : list) {
          if (!(raw instanceof Map<?, ?> content)) throw new ParseFailure("MAIN_CONTENT_INVALID", "主视觉不是对象: " + id);
          List<MainMetric> metrics = null;
          if (content.get("metrics") != null) {
            if (!(content.get("metrics") instanceof List<?> values)) throw new ParseFailure("MAIN_CONTENT_INVALID", "主视觉指标不是数组: " + id);
            metrics = new ArrayList<>();
            for (Object value : values) {
              if (!(value instanceof Map<?, ?> metric)) throw new ParseFailure("MAIN_CONTENT_INVALID", "主视觉指标不是对象: " + id);
              metrics.add(new MainMetric(sourceText(metric, "id"), sourceText(metric, "metricsName"),
                  sourceText(metric, "desc"), sourceText(metric, "sceneType"), sourceText(metric, "sourceType")));
            }
            metrics = List.copyOf(metrics);
          }
          contents.add(new MainContent(sourceText(content, "id"), sourceText(content, "title"), sourceText(content, "desc"), metrics));
        }
        contents = List.copyOf(contents);
      }
      pages.add(new PageSemantics(id, sourceText(page, "title"), contents));
    }
    return List.copyOf(pages);
  }

  /** 只有同序 ID 与组件数量一致且完整指标 ID 唯一时才读取单位/口径，不以名称或距离猜绑定。 */
  private static Map<?, ?> boundMetric(Map<?, ?> block, int slot, int count) {
    if (!(block.get("boundMetricIds") instanceof List<?> ids) || ids.size() != count
        || ids.stream().anyMatch(value -> !(value instanceof String id) || id.isBlank())
        || !(block.get("boundMetrics") instanceof List<?> metrics)) return Map.of();
    var matches = metrics.stream().filter(Map.class::isInstance).map(value -> (Map<?, ?>) value)
        .filter(metric -> ids.get(slot).equals(metric.get("metricId"))).toList();
    if (matches.size() > 1) throw new ParseFailure("METRIC_BINDING_AMBIGUOUS", "完整指标 ID 重复，不能确定组件绑定");
    return matches.isEmpty() ? Map.of() : matches.getFirst();
  }

  private static String businessText(Map<?, ?> source, String key, String objectId) {
    String value = sourceText(source, key);
    return objectId.equals(value) ? null : value; // 上游 export 的 blockId 兜底不是业务名称。
  }

  private static String sourceText(Map<?, ?> source, String key) {
    Object value = source.get(key);
    if (value == null) return null;
    if (!(value instanceof String text)) throw new ParseFailure("SEMANTIC_TEXT_INVALID", "业务文案不是文本: " + key);
    return text.isBlank() ? null : text;
  }

  /** 详情复用已有文本呈现契约，主视觉和普通图表分开；原 JSON 仍可核对。 */
  public static List<GenerationQualityEvidenceParser.DisplayItem> presentPages(String original) {
    List<Map<String, Object>> pages;
    try { pages = new com.dip3.ontologyagent.support.JsonCodec().list(original); }
    catch (com.dip3.ontologyagent.support.BackendException error) { throw new IllegalArgumentException("页面文案不可读取", error); }
    List<GenerationQualityEvidenceParser.DisplayItem> items = new ArrayList<>();
    for (Map<String, Object> page : pages) {
      items.add(new GenerationQualityEvidenceParser.DisplayItem("页面", Objects.requireNonNullElse(sourceText(page, "title"), "未记录页面标题")));
      if (page.get("contents") == null) {
        items.add(new GenerationQualityEvidenceParser.DisplayItem("主视觉", "此版本未记录主视觉内容"));
      } else if (page.get("contents") instanceof List<?> contents) {
        if (contents.isEmpty()) items.add(new GenerationQualityEvidenceParser.DisplayItem("主视觉", "源页面未配置主视觉内容"));
        for (Object raw : contents) {
          if (!(raw instanceof Map<?, ?> content)) throw new IllegalArgumentException("主视觉文案不是对象");
          items.add(new GenerationQualityEvidenceParser.DisplayItem("主视觉", Objects.requireNonNullElse(sourceText(content, "title"), "未记录主视觉标题")));
          addItem(items, content, "description", "主视觉说明");
          if (content.get("metrics") instanceof List<?> metrics) {
            for (Object value : metrics) {
              if (!(value instanceof Map<?, ?> metric)) throw new IllegalArgumentException("主视觉指标不是对象");
              items.add(new GenerationQualityEvidenceParser.DisplayItem("主视觉指标", Objects.requireNonNullElse(sourceText(metric, "name"), "未记录指标名称")));
              addItem(items, metric, "description", "指标含义");
              addItem(items, metric, "sceneType", "分析场景");
              addItem(items, metric, "sourceType", "源记录的来源类型");
            }
          } else if (content.get("metrics") != null) throw new IllegalArgumentException("主视觉指标不是数组");
        }
      } else throw new IllegalArgumentException("主视觉内容不是数组");
    }
    return List.copyOf(items);
  }

  private static void addItem(List<GenerationQualityEvidenceParser.DisplayItem> items, Map<?, ?> source, String key, String label) {
    String value = sourceText(source, key);
    if (value != null) items.add(new GenerationQualityEvidenceParser.DisplayItem(label, value));
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

  private static final class ParseFailure extends IllegalArgumentException {
    private final String code;

    private ParseFailure(String code, String message) {
      super(message);
      this.code = code;
    }
  }
}
