package com.dip3.ontologyagent.semantic.api;

import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.ServiceLoader;

/**
 * 全部领域本体声明的汇总视图：校验跨领域唯一性与引用完整性，并把成员路径解析为 Cube 成员。
 * Cube 模型生成、查询意图校验与授权范围注入共用同一份模型。
 */
public final class SemanticModel {
  private final List<OntologyModelContribution> contributions;
  private final Map<String, OntologyObjectType> objects = new LinkedHashMap<>();
  private final Map<String, OntologyObjectType> byCube = new LinkedHashMap<>();
  private final Map<String, OntologyModelContribution> domainOf = new LinkedHashMap<>();

  private SemanticModel(List<OntologyModelContribution> contributions) {
    this.contributions = List.copyOf(contributions);
    Map<String, OntologyModelContribution> domains = new LinkedHashMap<>();
    for (OntologyModelContribution contribution : this.contributions) {
      SemanticNames.requireText(contribution.domainKey(), "领域 key");
      if (!contribution.domainKey().matches("[a-z][a-z0-9-]*")) {
        throw SemanticNames.invalid("领域 key 只能包含小写字母、数字与连字符：" + contribution.domainKey());
      }
      if (contribution.businessZone() == null) {
        throw SemanticNames.invalid("领域 " + contribution.domainKey() + " 缺少业务时区");
      }
      if (domains.put(contribution.domainKey(), contribution) != null) {
        throw SemanticNames.invalid("领域重复：" + contribution.domainKey());
      }
      for (OntologyObjectType object : contribution.objects()) {
        if (objects.put(object.key(), object) != null || byCube.put(object.cubeName(), object) != null) {
          throw SemanticNames.invalid("对象或 Cube 名称重复：" + object.key() + " / " + object.cubeName());
        }
        domainOf.put(object.key(), contribution);
      }
    }
    for (OntologyObjectType object : objects.values()) {
      for (OntologyLink link : object.links()) {
        OntologyObjectType target = objects.get(link.targetObjectKey());
        if (target == null) {
          throw SemanticNames.invalid("对象 " + object.key() + " 的关系 " + link.key() + " 指向不存在的对象 "
              + link.targetObjectKey());
        }
        object.requireProperty(link.sourceProperty());
        target.requireProperty(link.targetProperty());
      }
      object.scopeBindings().values().forEach(path -> resolve(object.key(), path));
    }
  }

  public static SemanticModel of(List<OntologyModelContribution> contributions) {
    return new SemanticModel(contributions);
  }

  /** 按 ServiceLoader 汇总类路径上的全部领域声明（按领域 key 排序，生成物稳定）。 */
  public static SemanticModel discover() {
    List<OntologyModelContribution> found = new ArrayList<>();
    ServiceLoader.load(OntologyModelContribution.class, SemanticModel.class.getClassLoader()).forEach(found::add);
    found.sort(Comparator.comparing(OntologyModelContribution::domainKey));
    return new SemanticModel(found);
  }

  public List<OntologyModelContribution> contributions() {
    return contributions;
  }

  public List<OntologyObjectType> objects() {
    return List.copyOf(objects.values());
  }

  public List<OntologyObjectType> objects(String domainKey) {
    return objects.values().stream().filter(object -> domainOf.get(object.key()).domainKey().equals(domainKey)).toList();
  }

  public Optional<OntologyObjectType> find(String objectKey) {
    return Optional.ofNullable(objects.get(objectKey));
  }

  public OntologyObjectType require(String objectKey) {
    OntologyObjectType object = objects.get(objectKey);
    if (object == null) throw SemanticNames.invalid("不存在本体对象 " + objectKey);
    return object;
  }

  public OntologyObjectType requireByCube(String cubeName) {
    OntologyObjectType object = byCube.get(cubeName);
    if (object == null) throw SemanticNames.invalid("不存在 Cube " + cubeName);
    return object;
  }

  public String domainKey(String objectKey) {
    return contribution(objectKey).domainKey();
  }

  public ZoneId businessZone(String objectKey) {
    return contribution(objectKey).businessZone();
  }

  /**
   * 解析对象上的属性路径：{@code propertyKey} 为本对象属性，{@code linkKey.propertyKey} 为一跳关联对象属性。
   */
  public ResolvedMember resolve(String objectKey, String path) {
    OntologyObjectType object = require(objectKey);
    if (path == null || path.isBlank()) throw SemanticNames.invalid("对象 " + objectKey + " 的成员路径为空");
    String[] parts = path.split("\\.", -1);
    if (parts.length == 1) {
      return new ResolvedMember(path, object, object.requireProperty(parts[0]));
    }
    if (parts.length == 2) {
      OntologyObjectType target = require(object.requireLink(parts[0]).targetObjectKey());
      return new ResolvedMember(path, target, target.requireProperty(parts[1]));
    }
    throw SemanticNames.invalid("对象 " + objectKey + " 的成员路径最多一跳关系：" + path);
  }

  /** 关系目标对象的主键 Cube 成员：成员资格关系以“目标主键非空”强制内联。 */
  public String requiredLinkMember(OntologyObjectType object, String linkKey) {
    OntologyObjectType target = require(object.requireLink(linkKey).targetObjectKey());
    return target.cubeName() + "." + target.primaryKey().key();
  }

  private OntologyModelContribution contribution(String objectKey) {
    OntologyModelContribution contribution = domainOf.get(objectKey);
    if (contribution == null) throw SemanticNames.invalid("不存在本体对象 " + objectKey);
    return contribution;
  }

  /** 路径解析结果：owner 为属性所在对象（本对象或一跳关联对象）。 */
  public record ResolvedMember(String path, OntologyObjectType owner, OntologyProperty property) {
    public String cubeMember() {
      return owner.cubeName() + "." + property.key();
    }
  }
}
