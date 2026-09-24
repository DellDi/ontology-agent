package com.dip3.ontologyagent.semantic.api;

/** 对象间关系：本对象 sourceProperty 与目标对象 targetProperty 相等。 */
public record OntologyLink(
    String key, String targetObjectKey, String sourceProperty, String targetProperty, Cardinality cardinality) {

  public enum Cardinality { MANY_TO_ONE, ONE_TO_MANY, ONE_TO_ONE }

  public OntologyLink {
    SemanticNames.requireMember(key, "关系");
    SemanticNames.requireText(targetObjectKey, "关系 " + key + " 的目标对象");
    SemanticNames.requireMember(sourceProperty, "关系源属性");
    SemanticNames.requireMember(targetProperty, "关系目标属性");
    if (cardinality == null) throw SemanticNames.invalid("关系 " + key + " 缺少 cardinality");
  }
}
