package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.math.*;
import java.util.*;

/** 将已确认的块内方案应用到实时原型；不生成指标、不调用模型、不修改块外状态。 */
public final class PrototypeBlockWriteback {
  private static final ObjectMapper JSON = new ObjectMapper();
  private PrototypeBlockWriteback() {}
  public record Choice(String componentId, String metricId, String name, String beforeChart,
      String afterChart, int slotIndex, String description, String insight, String unit, String aggregationRule) {}
  public record Plan(String appId, String blockId, String title, String purpose, String blockTypeId,
      String schemeId, List<Choice> choices, String targetTitle, String targetPurpose) {}
  public record Chart(String type, String family, String sceneTag) {}

  public static ObjectNode transform(JsonNode before, Plan plan, SchemeAdaptation.Candidate candidate,
      Map<String,Chart> charts) {
    if (plan == null || plan.choices() == null || plan.choices().size() > SchemeAdaptation.RULES.maxMetrics())
      throw rejected("缺少有效的块内方案");
    ObjectNode after = before.deepCopy();
    ObjectNode block = block(after.path("prototype"), plan.blockId());
    boolean textOnly = plan.schemeId() == null && plan.choices().isEmpty();
    var parsed = PrototypeStructureParser.parse(before.path("xml").asText(), map(before.path("prototype")));
    if (parsed.status() != PrototypeStructureParser.Status.OK)
      throw rejected("实时原型结构无法核对：" + parsed.errorCode());
    var source = parsed.blocks().stream().filter(b -> b.blockId().equals(plan.blockId())).findFirst()
        .orElseThrow(() -> rejected("目标块不存在"));
    // 解析器不保留 metric_role；XML 与 JSON 的核心区标记均必须检查。
    if (!Objects.equals(text(block.get("businessModule")), plan.title())
        || !Objects.equals(text(block.get("moduleDescription")), plan.purpose())
        || !textOnly && !Objects.equals(block.path("blockTypeId").asText(), plan.blockTypeId())
        || block.has("controls") || block.has("activeBlockStates") || "core".equals(block.path("metricRole").asText())
        || coreInXml(before.path("xml").asText(), plan.blockId()))
      throw rejected("实时原型与提案依据不同，或目标不是普通内容块");
    if (plan.targetTitle() != null) {
      requireText(plan.targetTitle(), 500);
      for (String key : List.of("title", "moduleName", "businessModule")) block.put(key, plan.targetTitle());
    }
    if (plan.targetPurpose() != null) { requireText(plan.targetPurpose(), 4000); block.put("moduleDescription", plan.targetPurpose()); }
    if (!textOnly) {
      if (candidate == null || !Objects.equals(candidate.schemeId(), plan.schemeId())
          || !Objects.equals(candidate.blockTypeId(), plan.blockTypeId()) || !"available".equals(candidate.parseStatus())
          || candidate.slots().size() != plan.choices().size()) throw rejected("实时方案库与提案不符");
      var original = block.path("components"); var ids = block.path("boundMetricIds"); var metrics = block.path("boundMetrics");
      int count = plan.choices().size();
      if (count == 0 || !original.isArray() || original.size() != count || ids.size() != count || metrics.size() != count)
        throw rejected("实时组件与指标绑定不完整");
      Map<String,Integer> indexes = new HashMap<>();
      for (int i=0; i<count; i++) {
        String id = original.get(i).path("id").asText();
        if (id.isBlank() || indexes.put(id,i) != null) throw rejected("组件标识缺失或重复");
      }
      ArrayNode components = JSON.createArrayNode(), boundIds = JSON.createArrayNode(), boundMetrics = JSON.createArrayNode();
      Set<String> seen = new HashSet<>();
      var ordered = plan.choices().stream().sorted(Comparator.comparingInt(Choice::slotIndex)).toList();
      List<PrototypeStructureParser.MetricBinding> bindings = new ArrayList<>();
      List<SchemeAdaptation.Component> geometry = new ArrayList<>();
      for (int i=0; i<count; i++) {
        Choice choice = ordered.get(i); Integer index = indexes.get(choice.componentId());
        if (index == null || !seen.add(choice.componentId()) || choice.slotIndex() != i
            || !Objects.equals(ids.get(index).asText(), choice.metricId())
            || !Objects.equals(metrics.get(index).path("metricId").asText(), choice.metricId())) throw rejected("必须精确保留当前块的全部指标实例");
        ObjectNode component = original.get(index).deepCopy();
        if (!Objects.equals(text(component.get("chartFamily")), choice.beforeChart())
            || !Objects.equals(text(component.get("metricName")), choice.name())
            || !Objects.equals(text(component.get("desc")), choice.description())
            || !Objects.equals(text(component.get("insight")), choice.insight())
            || !Objects.equals(text(metrics.get(index).get("unit")), choice.unit())
            || !Objects.equals(text(metrics.get(index).get("aggregationRule")), choice.aggregationRule()))
          throw rejected("实时指标含义、绑定或图形已改变");
        Chart chart = charts.get(choice.afterChart());
        if (chart == null) throw rejected("建议图形当前未启用");
        var slot = candidate.slots().get(i); var position = slot.position();
        ObjectNode config = JSON.createObjectNode();
        config.put("relativeX", pct(position.col()-1)); config.put("relativeY", pct(position.row()-1));
        config.put("width", pct(position.colSpan())); config.put("height", pct(position.rowSpan()));
        config.set("gridPosition", JSON.valueToTree(position));
        component.put("chartFamily", chart.family()); component.put("sceneTag", chart.sceneTag()); component.set("config", config);
        components.add(component); boundIds.add(ids.get(index)); boundMetrics.add(metrics.get(index));
        bindings.add(new PrototypeStructureParser.MetricBinding(i, choice.componentId(), choice.metricId(), choice.afterChart(), null, null));
        geometry.add(new SchemeAdaptation.Component(choice.componentId(), PrototypeComponentGeometry.parse(map(config))));
      }
      var bounds = PrototypeLayoutGeometry.block(parsed.layoutStructure(), plan.blockId());
      var input = new SchemeAdaptation.Input(plan.blockTypeId(), plan.schemeId(), bounds.bounds(), source.titlePresent(),
          "available", bindings, geometry);
      var assessment = SchemeAdaptation.compare(input, List.of(candidate)).current();
      if (!"feasible".equals(assessment.status())) throw rejected("实时区域不满足方案约束：" + String.join("；", assessment.findings().stream().map(SchemeAdaptation.Finding::message).distinct().toList()));
      block.set("components", components); block.set("boundMetricIds", boundIds); block.set("boundMetrics", boundMetrics);
      block.put("schemeId", plan.schemeId());
    }
    if (after.equals(before)) throw rejected("方案没有产生变化");
    return after;
  }

  /** 只替换目标块的投影，保留快照其余字段及绑定中的完整数据来源。 */
  public static JsonNode editingOutput(JsonNode output, String blockId, JsonNode beforeBlock, JsonNode afterBlock,
      Map<String,Chart> charts) {
    ObjectNode result = output.deepCopy();
    JsonNode filled = result.at("/output/raw/regenContextSnapshot/currentFilledBlocks");
    if (!filled.isArray()) throw rejected("缺少持久编辑上下文");
    var targets = new ArrayList<ObjectNode>();
    filled.forEach(b -> { if (b instanceof ObjectNode node && node.path("blockId").asText().equals(blockId)) targets.add(node); });
    if (targets.size() != 1) throw rejected("持久编辑上下文中的目标块不存在或不唯一");
    ObjectNode target = targets.getFirst();
    JsonNode oldBindings = target.path("slotBindings"), ids = beforeBlock.path("boundMetricIds");
    if (!oldBindings.isArray() || oldBindings.size() != ids.size()) throw rejected("编辑快照的指标绑定不完整");
    ArrayNode slots = JSON.createArrayNode();
    Map<String,Integer> indexes = new HashMap<>();
    for (int i=0;i<ids.size();i++) {
      if (!oldBindings.get(i).at("/boundMetric/metricId").asText().equals(ids.get(i).asText())) throw rejected("编辑快照与原型指标顺序不一致");
      indexes.put(beforeBlock.path("components").get(i).path("id").asText(), i);
    }
    for (JsonNode component : afterBlock.path("components")) {
      Integer index = indexes.get(component.path("id").asText());
      if (index == null) throw rejected("编辑快照中缺少指标实例");
      ObjectNode binding = oldBindings.get(index).deepCopy();
      Chart chart = charts.get(component.path("chartFamily").asText());
      if (chart == null) throw rejected("无法翻译编辑快照图形");
      binding.put("slotIndex", slots.size()); binding.put("chartType", chart.type()); slots.add(binding);
    }
    target.set("slotBindings", slots);
    target.set("selectedScheme", JSON.createObjectNode().put("schemeId", afterBlock.path("schemeId").asText()).put("chartCount", slots.size()));
    target.set("businessModule", afterBlock.get("businessModule")); target.set("moduleDescription", afterBlock.get("moduleDescription"));
    return result;
  }
  public static ObjectNode block(JsonNode prototype, String id) {
    var matches = new ArrayList<ObjectNode>();
    prototype.elements().forEachRemaining(page -> { if (page.path("blocks").get(id) instanceof ObjectNode node) matches.add(node); });
    if (matches.size()!=1) throw rejected("目标块不存在或不唯一");
    return matches.getFirst();
  }
  private static boolean coreInXml(String xml, String id) {
    try {
      var factory = javax.xml.parsers.DocumentBuilderFactory.newInstance();
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setXIncludeAware(false); factory.setExpandEntityReferences(false);
      var nodes = factory.newDocumentBuilder().parse(new org.xml.sax.InputSource(new java.io.StringReader(xml))).getElementsByTagName("Block");
      for (int i=0;i<nodes.getLength();i++) {
        var element = (org.w3c.dom.Element)nodes.item(i);
        if (id.equals(element.getAttribute("id")) && "core".equals(element.getAttribute("metric_role"))) return true;
      }
      return false;
    } catch (Exception error) { throw new BackendException("EASYV_ACTION_REJECTED", "无法核对源结构中的核心区标记", error); }
  }
  private static String pct(int value) { return BigDecimal.valueOf(value*100).divide(BigDecimal.valueOf(12),2,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()+"%"; }
  private static void requireText(String value, int max) { if (value.isBlank() || value.length()>max) throw rejected("标题或用途为空或过长"); }
  private static String text(JsonNode value) { return value == null || value.isNull() || value.asText().isBlank() ? null : value.asText(); }
  @SuppressWarnings("unchecked") private static Map<String,Object> map(JsonNode value) { return JSON.convertValue(value, Map.class); }
  private static BackendException rejected(String message) { return new BackendException("EASYV_ACTION_REJECTED", message); }
}
