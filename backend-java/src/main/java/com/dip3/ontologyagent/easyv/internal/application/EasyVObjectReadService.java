package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVOntologyModel;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Transactional;

/** 读请求继承本轮事实和授权快照；当前账号权限只能收窄，不能扩展历史执行的数据范围。 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class EasyVObjectReadService {
  private static final Logger log = LoggerFactory.getLogger(EasyVObjectReadService.class);
  private static final Set<String> OBJECTS = EasyVOntologyModel.READABLE_OBJECT_KEYS;
  private static final Set<String> SUMMARY_OBJECTS = Set.of(EasyVOntologyModel.PROTOTYPE_LAYOUT.key(),
      EasyVOntologyModel.PROTOTYPE_BLOCK.key());
  private final AnalysisSessionRepository sessions;
  private final OntologyRepository ontologies;
  private final ExecutionRepository executions;
  private final DatasetVersionSetRegistry datasets;
  private final EasyVScopeResolver scopes;
  private final ObjectQueryPort objects;
  private final SemanticModel model;
  private final PrototypeStructureReadPort structures;
  private final SemanticQueryPort queries;
  private final SemanticQueryCompiler compiler;

  public EasyVObjectReadService(AnalysisSessionRepository sessions, OntologyRepository ontologies, ExecutionRepository executions,
      DatasetVersionSetRegistry datasets, EasyVScopeResolver scopes, ObjectQueryPort objects,
      SemanticModel model, PrototypeStructureReadPort structures, SemanticQueryPort queries) {
    this.sessions = sessions;
    this.ontologies = ontologies;
    this.executions = executions;
    this.datasets = datasets;
    this.scopes = scopes;
    this.objects = objects;
    this.model = model;
    this.structures = structures;
    this.queries = queries;
    this.compiler = new SemanticQueryCompiler(model);
  }

  /** objectId 为空为列表；指定 ID 为详情；再指定 relation 为声明中的关系查询。 */
  public record Request(String executionId, String datasetVersionSetId, String objectKey, String objectId,
                        String relation, List<QueryIntent.Filter> filters, List<QueryIntent.Order> order,
                        Integer limit, Integer offset, String drilldownId, Boolean includeComponentSummary) {
    public Request(String executionId, String datasetVersionSetId, String objectKey, String objectId,
                   String relation, List<QueryIntent.Filter> filters, List<QueryIntent.Order> order,
                   Integer limit, Integer offset) {
      this(executionId, datasetVersionSetId, objectKey, objectId, relation, filters, order, limit, offset, null, null);
    }
    public Request(String executionId, String datasetVersionSetId, String objectKey, String objectId,
                   String relation, List<QueryIntent.Filter> filters, List<QueryIntent.Order> order,
                   Integer limit, Integer offset, String drilldownId) {
      this(executionId, datasetVersionSetId, objectKey, objectId, relation, filters, order, limit, offset, drilldownId, null);
    }
    @JsonAnySetter
    public void rejectUnknown(String key, Object value) {
      throw new BackendException("OBJECT_QUERY_INVALID", "对象读取不接受字段：" + key);
    }
  }
  public record Structure(String status, Map<String, Object> layout) {}
  public record PropertyView(String key, String label, OntologyProperty.Type type) {}
  public record LinkView(String key, String targetObjectKey, String targetLabel) {}
  public record ObjectTypeView(String key, String label, List<PropertyView> properties, List<LinkView> links) {}
  public record FamilyCount(String chartFamily, long count, QueryIntent.Filter filter) {}
  public record ComponentSummary(long total, List<FamilyCount> groups) {}
  public record DataContext(Instant capturedAt, String scopeDescription) {}
  public record Result(String executionId, String datasetVersionSetId, String ontologyVersionId,
                       ObjectQueryPort.Page page, Structure structure, ObjectTypeView objectType,
                       Map<String, Map<String, Object>> componentGeometry,
                       ComponentSummary componentSummary, DataContext dataContext) {}

  private ObjectTypeView describe(String key) {
    var object = model.require(key);
    return new ObjectTypeView(key, object.label(), object.properties().stream()
        .map(property -> new PropertyView(property.key(), property.label(), property.type())).toList(),
        object.links().stream().filter(link -> OBJECTS.contains(link.targetObjectKey()))
            .map(link -> new LinkView(link.key(), link.targetObjectKey(), model.require(link.targetObjectKey()).label())).toList());
  }

  @Transactional(readOnly = true)
  public Result read(String sessionId, AuthSession viewer, Request request) {
    validateRequest(request);
    sessions.requireOwned(sessionId, viewer);
    var snapshot = executions.findJavaSnapshot(sessionId, request.executionId(), viewer.userId())
        .orElseThrow(() -> new BackendException("EXECUTION_NOT_FOUND", "执行快照不存在或无权访问。"));
    if (!request.datasetVersionSetId().equals(snapshot.datasetVersionSetId())) {
      throw new BackendException("OBJECT_VERSION_MISMATCH", "请求冻结集合与来源执行不一致。");
    }
    CapabilityBinding binding;
    try { binding = CapabilityBinding.fromSnapshot(snapshot.capabilityBinding()); }
    catch (IllegalArgumentException error) {
      throw new BackendException("CAPABILITY_BINDING_INVALID", "来源执行能力绑定不可读取。", error);
    }
    if (!EasyVCapabilityRegistration.ID.equals(binding.id())) {
      throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "来源执行不属于 EasyV 分析。");
    }
    EasyVGenerationOntology.validate(EasyVGenerationOntology.ENTITY_KEY, EasyVGenerationOntology.METRIC_KEY,
        EasyVGenerationOntology.TIME_KEY, ontologies.published(binding.ontologyVersionId()));
    datasets.requireFrozen(snapshot.datasetVersionSetId(), EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS);
    // resolveScope 检查当前角色和账号绑定；冻结快照仍决定这次历史读取的上限。
    var current = scopes.resolveScope(viewer);
    scopes.validateScope(binding.resolvedScope(), viewer);
    return readAuthorized(resolveDrilldown(request, snapshot.resultBlocks()), binding.ontologyVersionId(),
        EasyVScopeResolver.narrowScope(binding.resolvedScope(), current), viewer);
  }

  private Request resolveDrilldown(Request request, List<Map<String, Object>> blocks) {
    if (request.drilldownId() == null) return request;
    for (var block : blocks) {
      if (!(block.get("drilldowns") instanceof List<?> bindings)) continue;
      for (Object raw : bindings) {
        EasyVResultDrilldown.Binding saved;
        try { saved = EasyVResultDrilldown.saved(raw); }
        catch (IllegalArgumentException error) {
          throw new BackendException("DATABASE_JSON_INVALID", "执行的下钻绑定不可读取：" + request.executionId(), error);
        }
        if (!request.drilldownId().equals(saved.id())) continue;
        if (!request.datasetVersionSetId().equals(block.get("datasetVersionSetId")) || !request.objectKey().equals(saved.objectKey())) {
          throw new BackendException("OBJECT_DRILLDOWN_MISMATCH", "下钻对象类型或冻结集合与统计项不一致。");
        }
        if (saved.filters() == null || saved.filters().size() > 10) {
          throw new BackendException("DATABASE_JSON_INVALID", "执行的下钻过滤条件无效：" + request.executionId());
        }
        // 已保存的统计项过滤永远排在前面且不可替换；用户筛选只能在其上追加（AND），排序不改变集合。
        List<QueryIntent.Filter> filters = new ArrayList<>(saved.filters());
        if (request.filters() != null) filters.addAll(request.filters());
        if (filters.size() > 10) {
          throw new BackendException("OBJECT_QUERY_INVALID", "统计项过滤与追加筛选合计不能超过 10 项。");
        }
        return new Request(request.executionId(), request.datasetVersionSetId(), saved.objectKey(), null, null,
            List.copyOf(filters), request.order(), request.limit(), request.offset());
      }
    }
    throw new BackendException("OBJECT_DRILLDOWN_NOT_FOUND", "此执行未保存该统计项的下钻绑定：" + request.drilldownId());
  }

  /** 已运行的 Worker 以可信执行上下文和租约读取，不依赖尚未产生的完成快照。 */
  @Transactional(timeout = 30)
  public Result readDuringExecution(CapabilityExecutionContext context, ResolvedScopeSnapshot frozenScope, Request request) {
    validateRequest(request);
    if (request.drilldownId() != null) throw new BackendException("OBJECT_QUERY_INVALID", "统计项下钻只能读取已经保存的执行结果。");
    if (!context.executionId().equals(request.executionId()) || !context.datasetVersionSetId().equals(request.datasetVersionSetId())) {
      throw new BackendException("OBJECT_VERSION_MISMATCH", "运行时对象读取与当前执行或冻结集合不一致。");
    }
    executions.renewLease(context.executionId(), context.leaseOwner(), ExecutionRepository.EXECUTION_LEASE);
    AuthSession viewer = scopes.executionPrincipal(context.principal());
    sessions.requireOwned(context.turn().sessionId(), viewer);
    scopes.validateScope(frozenScope, viewer);
    return readAuthorized(request, context.ontology().versionId(),
        EasyVScopeResolver.narrowScope(frozenScope, scopes.resolveScope(viewer)), viewer);
  }

  private static void validateRequest(Request request) {
    if (request == null || request.executionId() == null || request.executionId().isBlank()
        || request.datasetVersionSetId() == null || request.datasetVersionSetId().isBlank()) {
      throw new BackendException("OBJECT_CONTEXT_REQUIRED", "对象读取必须指定分析执行与冻结集合。");
    }
    requireObject(request.objectKey());
    if (Boolean.TRUE.equals(request.includeComponentSummary()) && (request.objectId() == null
        || request.relation() != null || request.drilldownId() != null
        || !SUMMARY_OBJECTS.contains(request.objectKey()))) {
      throw new BackendException("OBJECT_QUERY_INVALID", "组件构成统计仅支持原型版式或区域详情。");
    }
    if ((request.limit() != null && (request.limit() < 1 || request.limit() > 200))
        || (request.offset() != null && (request.offset() < 0 || request.offset() > 10000))
        || (request.filters() != null && request.filters().size() > 10)
        || (request.order() != null && request.order().size() > 4)) {
      throw new BackendException("OBJECT_QUERY_INVALID", "对象读取的分页、过滤或排序数量超过限制。");
    }
    if (request.relation() != null && (request.relation().isBlank() || request.objectId() == null)) {
      throw new BackendException("OBJECT_QUERY_INVALID", "关系查询需要源对象 ID 与关系 key。");
    }
    if (request.drilldownId() != null && (request.drilldownId().isBlank() || request.drilldownId().length() > 500
        || request.objectId() != null || request.relation() != null)) {
      throw new BackendException("OBJECT_QUERY_INVALID", "统计项下钻只接受已保存的绑定 ID、分页与进一步缩小范围的筛选和排序，不接受替换对象或关系。");
    }
  }

  private Result readAuthorized(Request request, String ontologyVersionId, ResolvedScopeSnapshot scope, AuthSession viewer) {
    var manifest = datasets.requireFrozen(request.datasetVersionSetId(),
        Set.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component"));
    var access = new SemanticQueryPort.AccessContext(manifest.productVersionIds(), EasyVScopeResolver.dataScope(scope));
    int limit = request.limit() == null ? 50 : request.limit();
    int offset = request.offset() == null ? 0 : request.offset();
    ObjectQueryPort.Page page;
    Structure structure = null;
    if (request.relation() != null) {
      String target = model.require(request.objectKey()).requireLink(request.relation()).targetObjectKey();
      requireObject(target);
      page = objects.related(request.objectKey(), request.objectId(), request.relation(),
          new ObjectQueryPort.Query(target, request.filters(), request.order(), limit, offset), access);
    } else if (request.objectId() != null) {
      if ((request.filters() != null && !request.filters().isEmpty())
          || (request.order() != null && !request.order().isEmpty()) || offset != 0) {
        throw new BackendException("OBJECT_QUERY_INVALID", "对象详情不接受过滤、排序或偏移。");
      }
      var object = objects.require(request.objectKey(), request.objectId(), access);
      page = new ObjectQueryPort.Page(request.objectKey(), List.of(object), 1, 0, false);
      if (EasyVOntologyModel.PROTOTYPE_LAYOUT.key().equals(request.objectKey())) {
        if (!"ok".equals(object.properties().get("parseStatus"))) structure = new Structure("parse_failed", null);
        else {
          Map<String, Object> layout = structures.structure(object.reference().productVersionId(), request.objectId());
          structure = new Structure(layout == null ? "not_retained" : "available", layout);
        }
      }
    } else {
      page = objects.query(new ObjectQueryPort.Query(request.objectKey(), request.filters(), request.order(), limit, offset), access);
    }
    log.info("easyv_object_read executionId={} datasetVersionSetId={} userId={} objectKey={} objectId={} relation={} rows={} hasMore={}",
        request.executionId(), request.datasetVersionSetId(), viewer.userId(), request.objectKey(),
        request.objectId(), request.relation(), page.rows().size(), page.hasMore());
    var geometry = EasyVOntologyModel.PROTOTYPE_COMPONENT.key().equals(page.objectKey()) && !page.rows().isEmpty()
        ? structures.componentGeometry(access.productVersions().get(page.objectKey()),
            page.rows().stream().map(row -> row.reference().objectId()).toList()) : Map.<String, Map<String, Object>>of();
    var summary = Boolean.TRUE.equals(request.includeComponentSummary())
        ? componentSummary(page.rows().getFirst(), access, manifest.capturedAt()) : null;
    return new Result(request.executionId(), request.datasetVersionSetId(), ontologyVersionId, page, structure,
        describe(page.objectKey()), geometry, summary, new DataContext(manifest.capturedAt(), EasyVScopeResolver.dataScopeLabel(scope)));
  }

  /** 全量按家族计数，关系约束与对象读取共用本体声明；不能按已加载的预览页数统计。 */
  private ComponentSummary componentSummary(ObjectQueryPort.Row selected, SemanticQueryPort.AccessContext access, Instant capturedAt) {
    var type = model.require(selected.reference().objectKey());
    var link = type.requireLink("components");
    var value = selected.properties().get(link.sourceProperty());
    if (!(value instanceof String id) || id.isBlank()) {
      throw new BackendException("OBJECT_QUERY_INVALID", "所选对象缺少组件关系定位属性：" + link.sourceProperty());
    }
    if (type.key().equals(EasyVOntologyModel.PROTOTYPE_LAYOUT.key()) && !"ok".equals(selected.properties().get("parseStatus"))) {
      throw new BackendException("OBJECT_SUMMARY_UNAVAILABLE", "原型结构未成功解析，无法统计组件构成。");
    }
    var intent = new QueryIntent(link.targetObjectKey(), List.of("count"), List.of("chartFamily"),
        List.of(new QueryIntent.Filter(link.targetProperty(), QueryIntent.Operator.EQUALS, List.of(id))),
        new QueryIntent.TimeSpec(null, new TimeExpression("所选对象的全部组件", TimeExpression.Kind.ALL,
            null, null, null, null, null, null), null), null,
        List.of(new QueryIntent.Order("count", QueryIntent.Direction.DESC), new QueryIntent.Order("chartFamily", QueryIntent.Direction.ASC)), null);
    var compiled = compiler.compile(intent, capturedAt).require();
    var rows = queries.execute(compiled, access).rows();
    List<FamilyCount> groups = new ArrayList<>();
    for (var row : rows) {
      Object family = row.get("chartFamily");
      if (!row.containsKey("chartFamily") || (family != null && !(family instanceof String))) {
        throw new BackendException("SEMANTIC_RESULT_INVALID", "组件构成缺少有效图表家族。");
      }
      long count;
      try { count = new BigDecimal(String.valueOf(row.get("count"))).longValueExact(); }
      catch (NumberFormatException | ArithmeticException error) {
        throw new BackendException("SEMANTIC_RESULT_INVALID", "组件构成的数量不是整数。", error);
      }
      if (count <= 0) throw new BackendException("SEMANTIC_RESULT_INVALID", "组件构成的分组数量必须大于零。");
      var filter = new QueryIntent.Filter("chartFamily", family == null ? QueryIntent.Operator.NOT_SET : QueryIntent.Operator.EQUALS,
          family == null ? List.of() : List.of((String) family));
      groups.add(new FamilyCount((String) family, count, filter));
    }
    return new ComponentSummary(groups.stream().mapToLong(FamilyCount::count).sum(), List.copyOf(groups));
  }

  private static void requireObject(String key) {
    if (key == null || !OBJECTS.contains(key)) throw new BackendException("OBJECT_QUERY_INVALID", "当前读取仅支持 AI 应用、原型版式、区域与组件。");
  }
}
