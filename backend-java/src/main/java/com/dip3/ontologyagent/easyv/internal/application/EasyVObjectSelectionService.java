package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** 选择的权限/版本与查询约束由服务端决定；模型不能换对象 ID 或扩大选择范围。 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class EasyVObjectSelectionService {
  private static final Set<String> OBJECTS = Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");
  private static final Set<String> PRODUCTS = Set.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");
  private final ObjectQueryPort objects;
  private final DatasetVersionSetRegistry datasets;
  private final EasyVScopeResolver scopes;
  private final SemanticModel model;

  public EasyVObjectSelectionService(ObjectQueryPort objects, DatasetVersionSetRegistry datasets,
      EasyVScopeResolver scopes, SemanticModel model) {
    this.objects = objects; this.datasets = datasets; this.scopes = scopes; this.model = model;
  }
  public record Selected(ResolvedScopeSnapshot scope, ObjectQueryPort.Row object) {}

  public Selected require(AuthSession viewer, ResolvedScopeSnapshot frozenScope, ObjectSelection selection) {
    if (!OBJECTS.contains(selection.reference().objectKey())) throw new BackendException("OBJECT_SELECTION_INVALID", "当前选择只支持原型版式、区域与组件。");
    scopes.validateScope(frozenScope, viewer);
    var scope = EasyVScopeResolver.narrowScope(frozenScope, scopes.resolveScope(viewer));
    var versions = datasets.requireFrozen(selection.datasetVersionSetId(), PRODUCTS).productVersionIds();
    var type = model.require(selection.reference().objectKey());
    if (!selection.reference().productVersionId().equals(versions.get(type.productKey()))) {
      throw new BackendException("OBJECT_VERSION_MISMATCH", "所选对象的产品版本与来源冻结集合不一致。");
    }
    var object = objects.require(type.key(), selection.reference().objectId(),
        new SemanticQueryPort.AccessContext(versions, EasyVScopeResolver.dataScope(scope)));
    return new Selected(scope, object);
  }

  public QueryIntent constrain(QueryIntent intent, ObjectQueryPort.Row selection) {
    QueryIntent.Filter constraint = constraint(intent.objectKey(), selection);
    List<QueryIntent.Filter> filters = new ArrayList<>(intent.filters());
    if (!filters.contains(constraint)) filters.add(constraint);
    return new QueryIntent(intent.objectKey(), intent.measures(), intent.dimensions(), filters,
        intent.time(), intent.compare(), intent.order(), intent.limit());
  }

  public ObjectQueryPort.Query constrain(ObjectQueryPort.Query query, ObjectQueryPort.Row selection) {
    var filters = new ArrayList<>(query.filters());
    var constraint = constraint(query.objectKey(), selection);
    if (!filters.contains(constraint)) filters.add(constraint);
    return new ObjectQueryPort.Query(query.objectKey(), filters, query.order(), query.limit(), query.offset());
  }

  public Selected requireDuringExecution(AuthSession principal, ResolvedScopeSnapshot scope, ObjectSelection selection) {
    return require(scopes.executionPrincipal(principal), scope, selection);
  }

  /** 用本体声明中的直接关系定位查询对象，不维护一套对象 key / ID 字段映射表。 */
  private QueryIntent.Filter constraint(String targetKey, ObjectQueryPort.Row selection) {
    var selectedType = model.require(selection.reference().objectKey());
    var target = model.require(targetKey);
    if (target.key().equals(selectedType.key())) return equals(target.primaryKey().key(), selection.reference().objectId());
    for (var link : selectedType.links()) {
      if (link.targetObjectKey().equals(target.key())) return equals(link.targetProperty(), selection.properties().get(link.sourceProperty()));
    }
    for (var link : target.links()) {
      if (link.targetObjectKey().equals(selectedType.key())) return equals(link.sourceProperty(), selection.properties().get(link.targetProperty()));
    }
    throw new BackendException("OBJECT_SELECTION_QUERY_UNSUPPORTED", "查询对象 " + target.label() + " 没有可直接定位所选对象的本体关系。请取消选择后查询该范围。");
  }

  private static QueryIntent.Filter equals(String property, Object value) {
    if (!(value instanceof String || value instanceof Number || value instanceof Boolean)) {
      throw new BackendException("OBJECT_SELECTION_INVALID", "所选对象缺少关系定位属性：" + property);
    }
    return new QueryIntent.Filter(property, QueryIntent.Operator.EQUALS, List.of(String.valueOf(value)));
  }
}
