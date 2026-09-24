package com.dip3.ontologyagent.semantic.api;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 本体对象类型：属性、关系与指标的唯一声明来源。每个对象绑定一个数据产品，
 * 查询时按冻结版本集中的 productVersionId 强制过滤（生成的隐藏维度，不可声明同名属性）。
 *
 * @param baseFilter 对象成员资格谓词（如只含未删除记录），直接引用本表列名，可为空
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
    List<OntologyMetric> metrics) {

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
    Set<String> members = new HashSet<>(Set.of(VERSION_MEMBER));
    for (OntologyProperty property : properties) {
      if (!members.add(property.key())) throw SemanticNames.invalid("对象 " + key + " 成员重复或保留：" + property.key());
    }
    for (OntologyMetric metric : metrics) {
      if (!members.add(metric.key())) throw SemanticNames.invalid("对象 " + key + " 成员重复：" + metric.key());
    }
    if (properties.stream().filter(OntologyProperty::primaryKey).count() != 1) {
      throw SemanticNames.invalid("对象 " + key + " 必须且只能声明一个主键属性");
    }
  }

  public OntologyProperty requireProperty(String propertyKey) {
    return properties.stream().filter(item -> item.key().equals(propertyKey)).findFirst()
        .orElseThrow(() -> SemanticNames.invalid("对象 " + key + " 不存在属性 " + propertyKey));
  }
}
