package com.dip3.ontologyagent.semantic.api;

/** 对象间关系：本对象 sourceProperty 与目标对象 targetProperty 相等。 */
public record OntologyLink(
    String key, String targetObjectKey, String sourceProperty, String targetProperty, Cardinality cardinality,
    boolean prominent, Timeline timeline) {

  public enum Cardinality { MANY_TO_ONE, ONE_TO_MANY, ONE_TO_ONE }

  public OntologyLink(String key, String targetObjectKey, String sourceProperty, String targetProperty, Cardinality cardinality) {
    this(key, targetObjectKey, sourceProperty, targetProperty, cardinality, false, null);
  }

  public OntologyLink(String key, String targetObjectKey, String sourceProperty, String targetProperty,
                      Cardinality cardinality, boolean prominent) {
    this(key, targetObjectKey, sourceProperty, targetProperty, cardinality, prominent, null);
  }

  /** 时间线必须声明来源时间及业务解释，不能把任意对象列表误称为变更历史。 */
  public record Timeline(String title, String timeProperty, String notice) {
    public Timeline {
      SemanticNames.requireText(title, "时间线名称");
      SemanticNames.requireMember(timeProperty, "时间线时间属性");
      SemanticNames.requireText(notice, "时间线来源说明");
    }
  }

  public OntologyLink {
    SemanticNames.requireMember(key, "关系");
    SemanticNames.requireText(targetObjectKey, "关系 " + key + " 的目标对象");
    SemanticNames.requireMember(sourceProperty, "关系源属性");
    SemanticNames.requireMember(targetProperty, "关系目标属性");
    if (timeline != null && cardinality != Cardinality.ONE_TO_MANY)
      throw SemanticNames.invalid("时间线关系 " + key + " 必须为 ONE_TO_MANY");
    if (cardinality == null) throw SemanticNames.invalid("关系 " + key + " 缺少 cardinality");
  }
}
