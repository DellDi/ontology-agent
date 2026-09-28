package com.dip3.ontologyagent.semantic.api;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 本体对象类型：属性、关系与指标的唯一声明来源。每个对象绑定一个数据产品，
 * 查询时按冻结版本集中的 productVersionId 强制过滤（生成的隐藏维度，不可声明同名属性）。
 *
 * @param baseFilter 对象成员资格谓词（如只含未删除记录），直接引用本表列名，可为空
 * @param defaultTimeProperty 未指定时间维度时使用的时间属性，可为空（对象无时间语义）
 * @param requiredLinks 成员资格依赖的关系 key：仅当关联对象存在（且满足其 baseFilter）时本行才属于本对象，
 *     查询时由语义引擎强制内联关联
 * @param scopeBindings 授权范围维度 → 成员路径（{@code propertyKey} 或 {@code linkKey.propertyKey}）；
 *     按范围限定查询时未声明对应维度的对象一律拒绝
 */
public record OntologyObjectType(
    String key,
    String label,
    String description,
    String cubeName,
    String productKey,
    String table,
    String baseFilter,
    List<OntologyProperty> properties,
    List<OntologyLink> links,
    List<OntologyMetric> metrics,
    String defaultTimeProperty,
    List<String> requiredLinks,
    Map<String, String> scopeBindings) {

  public static final String VERSION_MEMBER = "productVersionId";

  public OntologyObjectType {
    SemanticNames.requireText(key, "对象 key");
    SemanticNames.requireText(label, "对象 " + key + " 的 label");
    SemanticNames.requireCubeName(cubeName);
    SemanticNames.requireText(productKey, "对象 " + key + " 的数据产品");
    SemanticNames.requireText(table, "对象 " + key + " 的表");
    if (baseFilter != null) {
      SemanticNames.requireText(baseFilter, "对象 " + key + " 的 baseFilter");
      if (baseFilter.contains("{")) throw SemanticNames.invalid("对象 " + key + " 的 baseFilter 只能引用本表列名，不能使用 {CUBE}");
    }
    properties = List.copyOf(properties);
    links = List.copyOf(links);
    metrics = List.copyOf(metrics);
    requiredLinks = requiredLinks == null ? List.of() : List.copyOf(requiredLinks);
    scopeBindings = scopeBindings == null ? Map.of() : java.util.Collections.unmodifiableMap(new LinkedHashMap<>(scopeBindings));
    Set<String> members = new HashSet<>(Set.of(VERSION_MEMBER));
    for (OntologyProperty property : properties) {
      if (!members.add(property.key())) throw SemanticNames.invalid("对象 " + key + " 成员重复或保留：" + property.key());
    }
    for (OntologyMetric metric : metrics) {
      if (!members.add(metric.key())) throw SemanticNames.invalid("对象 " + key + " 成员重复：" + metric.key());
    }
    for (OntologyProperty property : properties) {
      if (property.type() != OntologyProperty.Type.TIME) continue;
      for (String coverage : List.of(coverageFrom(property.key()), coverageTo(property.key()))) {
        if (!members.add(coverage)) throw SemanticNames.invalid("对象 " + key + " 成员与派生覆盖指标冲突：" + coverage);
      }
    }
    if (properties.stream().filter(OntologyProperty::primaryKey).count() != 1) {
      throw SemanticNames.invalid("对象 " + key + " 必须且只能声明一个主键属性");
    }
    Set<String> linkKeys = new HashSet<>();
    for (OntologyLink link : links) {
      if (!linkKeys.add(link.key())) throw SemanticNames.invalid("对象 " + key + " 关系重复：" + link.key());
    }
    for (String required : requiredLinks) {
      if (!linkKeys.contains(required)) throw SemanticNames.invalid("对象 " + key + " 的成员资格关系不存在：" + required);
    }
    for (OntologyMetric metric : metrics) {
      if (metric.aggregation() != OntologyMetric.Aggregation.RATIO) continue;
      for (String operand : metric.ratioOperands()) {
        OntologyMetric referenced = metrics.stream().filter(item -> item.key().equals(operand)).findFirst()
            .orElseThrow(() -> SemanticNames.invalid("对象 " + key + " 的比率指标 " + metric.key() + " 引用不存在的指标 " + operand));
        if (referenced.aggregation() == OntologyMetric.Aggregation.RATIO) {
          throw SemanticNames.invalid("对象 " + key + " 的比率指标 " + metric.key() + " 不能引用比率指标 " + operand);
        }
      }
    }
    if (defaultTimeProperty != null && properties.stream().noneMatch(item ->
        item.key().equals(defaultTimeProperty) && item.type() == OntologyProperty.Type.TIME)) {
      throw SemanticNames.invalid("对象 " + key + " 的默认时间属性必须是已声明的 TIME 属性：" + defaultTimeProperty);
    }
    scopeBindings.forEach((dimension, path) -> {
      SemanticNames.requireMember(dimension, "对象 " + key + " 的授权范围维度");
      SemanticNames.requireText(path, "对象 " + key + " 的授权范围路径");
    });
  }

  /** 无默认时间、成员资格关系与授权范围绑定的对象（测试与简单对象）。 */
  public OntologyObjectType(
      String key, String label, String description, String cubeName, String productKey, String table,
      String baseFilter, List<OntologyProperty> properties, List<OntologyLink> links, List<OntologyMetric> metrics) {
    this(key, label, description, cubeName, productKey, table, baseFilter, properties, links, metrics,
        null, List.of(), Map.of());
  }

  /** 时间属性派生的覆盖区间指标：冻结数据中该属性的最早 epoch 秒。 */
  public static String coverageFrom(String timePropertyKey) {
    return timePropertyKey + "CoverageFrom";
  }

  /** 时间属性派生的覆盖区间指标：冻结数据中该属性的最晚 epoch 秒。 */
  public static String coverageTo(String timePropertyKey) {
    return timePropertyKey + "CoverageTo";
  }

  public OntologyProperty requireProperty(String propertyKey) {
    return properties.stream().filter(item -> item.key().equals(propertyKey)).findFirst()
        .orElseThrow(() -> SemanticNames.invalid("对象 " + key + " 不存在属性 " + propertyKey));
  }

  public OntologyLink requireLink(String linkKey) {
    return links.stream().filter(item -> item.key().equals(linkKey)).findFirst()
        .orElseThrow(() -> SemanticNames.invalid("对象 " + key + " 不存在关系 " + linkKey));
  }

  public OntologyProperty primaryKey() {
    return properties.stream().filter(OntologyProperty::primaryKey).findFirst().orElseThrow();
  }

  public java.util.Optional<OntologyProperty> findProperty(String propertyKey) {
    return properties.stream().filter(item -> item.key().equals(propertyKey)).findFirst();
  }

  public java.util.Optional<OntologyMetric> findMetric(String metricKey) {
    return metrics.stream().filter(item -> item.key().equals(metricKey)).findFirst();
  }
}
