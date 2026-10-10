package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** 同一 Agent 的只读对象工具；模型使用真实结果句柄，执行身份与版本不进入模型输入契约。 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVAgentTools {
  public static final Set<String> OBJECTS = Set.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");
  private static final ObjectMapper JSON = new ObjectMapper();
  private final EasyVObjectReadService objects;
  private final EasyVSchemeAssessmentService assessments;
  private final EasyVObjectSelectionService selections;
  private final EasyVScopeResolver scopes;
  private final SemanticModel semantic;
  private final JsonCodec json;

  public EasyVAgentTools(EasyVObjectReadService objects, EasyVSchemeAssessmentService assessments,
      EasyVObjectSelectionService selections, EasyVScopeResolver scopes, SemanticModel semantic, JsonCodec json) {
    this.objects = objects; this.assessments = assessments; this.selections = selections;
    this.scopes = scopes; this.semantic = semantic; this.json = json;
  }

  public record Prepared(String tool, Map<String, Object> input, EasyVObjectReadService.Request request,
                         ObjectSelection selection) {}
  public record Output(String label, List<Map<String, Object>> rows, Set<String> products,
                       Map<String, Object> observation, Map<String, Object> audit,
                       Map<String, Object> renderBlock, List<ObjectQueryPort.Reference> references) {}

  public Run open(CapabilityExecutionContext context, ResolvedScopeSnapshot scope,
      Map<String, String> versions, ObjectQueryPort.Row selected, List<Map<String, Object>> previousCalls) {
    return new Run(context, scope, versions, selected, previousCalls);
  }

  public static List<Map<String, Object>> catalog(boolean objectTools) {
    List<Map<String, Object>> tools = new ArrayList<>();
    tools.add(Map.of("name", "query_metrics", "input", "{intent: 查询意图, handle?: 已知对象句柄}"));
    if (objectTools) {
      tools.add(Map.of("name", "query_objects", "input", "{objectKey, filters?: [{member,operator,values}], order?: [{member,direction}], limit?: 1..50, offset?: 0..10000}"));
      tools.add(Map.of("name", "read_object", "input", "{handle}"));
      tools.add(Map.of("name", "traverse_objects", "input", "{handle, relation, filters?, order?, limit?, offset?}"));
      tools.add(Map.of("name", "assess_scheme", "input", "{handle: 区域对象句柄}"));
    }
    return List.copyOf(tools);
  }

  public final class Run {
    private final CapabilityExecutionContext context;
    private final Map<String, String> versions;
    private final ObjectQueryPort.Row selected;
    private ResolvedScopeSnapshot scope;
    private final Map<String, ObjectQueryPort.Row> handles = new LinkedHashMap<>();
    private final Map<ObjectQueryPort.Reference, String> byReference = new LinkedHashMap<>();
    private final List<TerminalPage> terminalPages = new ArrayList<>();
    private record TerminalPage(EasyVObjectReadService.Request request, int endOffset) {}
    private int nextHandle = 1;
    private boolean scopeResolved;

    private Run(CapabilityExecutionContext context, ResolvedScopeSnapshot scope, Map<String, String> versions,
        ObjectQueryPort.Row selected, List<Map<String, Object>> previousCalls) {
      this.context = context; this.scope = scope; this.versions = Map.copyOf(versions); this.selected = selected;
      if (selected != null) { handles.put("selected", selected); byReference.put(selected.reference(), "selected"); }
      // 普通追问绑定最新集合，历史轨迹只提供对象身份；执行版本来自当前集合。
      // 显式选择仍使用来源集合。属性不继承，使用时必须重新做授权读取。
      for (Map<String, Object> call : previousCalls) {
        if (call.get("references") instanceof List<?> refs) for (Object ref : refs) {
          try {
            var historical = JSON.convertValue(ref, ObjectQueryPort.Reference.class);
            String version = versions.get(semantic.require(historical.objectKey()).productKey());
            if (version == null) throw invalid("当前冻结集合缺少历史对象所需产品");
            var reference = new ObjectQueryPort.Reference(historical.objectKey(), historical.objectId(), version);
            if (!byReference.containsKey(reference)) register(new ObjectQueryPort.Row(reference, Map.of()));
          }
          catch (IllegalArgumentException error) { throw invalid("历史工具对象引用无效"); }
        }
      }
    }

    public ResolvedScopeSnapshot currentScope() {
      var principal = scopes.executionPrincipal(context.principal());
      scopes.validateScope(scope, principal);
      var narrowed = EasyVScopeResolver.narrowScope(scope, scopes.resolveScope(principal));
      if (scopeResolved && !scope.equals(narrowed)) throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "执行期间账号范围已变化，请重新发起分析。");
      scope = narrowed; scopeResolved = true;
      return scope;
    }
    public SemanticQueryPort.AccessContext access() {
      return new SemanticQueryPort.AccessContext(versions, EasyVScopeResolver.dataScope(currentScope()));
    }
    public List<Map<String, Object>> knownObjects() {
      return handles.entrySet().stream().map(entry -> Map.<String, Object>of("handle", entry.getKey(),
          "reference", entry.getValue().reference(), "read", !entry.getValue().properties().isEmpty())).toList();
    }
    public ObjectQueryPort.Row requireHandle(Object raw) {
      if (!(raw instanceof String handle) || !handles.containsKey(handle)) throw invalid("只能使用 knownObjects 或真实结果中返回的 handle");
      return handles.get(handle);
    }

    public Prepared prepare(String tool, Map<String, Object> input) {
      Set<String> keys = switch (tool) {
        case "query_objects" -> Set.of("objectKey", "filters", "order", "limit", "offset");
        case "read_object", "assess_scheme" -> Set.of("handle");
        case "traverse_objects" -> Set.of("handle", "relation", "filters", "order", "limit", "offset");
        default -> throw invalid("未知工具 " + tool);
      };
      if (!keys.containsAll(input.keySet())) throw invalid(tool + " 不接受字段 " + input.keySet());
      if (tool.equals("query_objects")) {
        String key = text(input.get("objectKey")); requireObject(key);
        return new Prepared(tool, Map.copyOf(input), request(key, null, null, input), null);
      }
      var row = requireHandle(input.get("handle"));
      requireObject(row.reference().objectKey());
      if (tool.equals("assess_scheme")) {
        if (!"easyv-prototype-block".equals(row.reference().objectKey())) throw invalid("assess_scheme 只能评估区域对象");
        return new Prepared(tool, Map.copyOf(input), null,
            new ObjectSelection(context.executionId(), context.datasetVersionSetId(), row.reference()));
      }
      String relation = tool.equals("traverse_objects") ? text(input.get("relation")) : null;
      if (relation != null) {
        var link = semantic.require(row.reference().objectKey()).links().stream().filter(item -> item.key().equals(relation)).findFirst()
            .orElseThrow(() -> invalid("对象没有声明该关系 " + relation));
        requireObject(link.targetObjectKey());
      }
      return new Prepared(tool, Map.copyOf(input), request(row.reference().objectKey(), row.reference().objectId(), relation, input), null);
    }

    private EasyVObjectReadService.Request request(String key, String id, String relation, Map<String, Object> input) {
      int limit = number(input.get("limit"), 50, 1, 50), offset = number(input.get("offset"), 0, 0, 10000);
      String target = relation == null ? key : semantic.require(key).requireLink(relation).targetObjectKey();
      List<QueryIntent.Filter> filters = decode(input.get("filters"), QueryIntent.Filter.class, 10);
      List<QueryIntent.Order> order = decode(input.get("order"), QueryIntent.Order.class, 4);
      var type = semantic.require(target);
      for (var filter : filters) {
        if (filter.member() == null || type.findProperty(filter.member()).isEmpty() || filter.operator() == null
            || filter.values() == null || filter.values().size() > 100 || filter.values().stream().anyMatch(v -> v == null || v.isBlank() || v.length() > 500)) throw invalid("对象过滤必须使用已声明属性和有效值");
      }
      for (var item : order) if (item.member() == null || type.findProperty(item.member()).isEmpty() || item.direction() == null) throw invalid("对象排序必须使用已声明属性");
      var query = new ObjectQueryPort.Query(target, filters, order, limit, offset);
      if (selected != null && (id == null || relation != null)) query = selections.constrain(query, selected);
      if (query.filters().size() > (relation == null ? 10 : 9)) throw invalid("对象过滤没有足够空间保留所选范围与关系约束");
      var request = new EasyVObjectReadService.Request(context.executionId(), context.datasetVersionSetId(), key, id, relation,
          query.filters(), query.order(), id != null && relation == null ? 1 : limit, offset);
      requirePage(request);
      return request;
    }

    private void requirePage(EasyVObjectReadService.Request request) {
      for (var terminal : terminalPages) {
        var previous = terminal.request();
        if (request.objectKey().equals(previous.objectKey())
            && Objects.equals(request.objectId(), previous.objectId())
            && Objects.equals(request.relation(), previous.relation())
            && request.filters().equals(previous.filters()) && request.order().equals(previous.order())
            && request.offset() >= terminal.endOffset()) {
          throw invalid("该对象范围已返回 hasMore=false，末页结束位置为 " + terminal.endOffset()
              + "；不能继续查询 offset=" + request.offset() + "。已有足够结果时应 finished，需要其他范围时请明确更改查询。");
        }
      }
    }

    public Output execute(String id, Prepared call) {
      var scope = currentScope();
      if (call.request() != null) requirePage(call.request());
      if (call.input().containsKey("handle")) {
        var known = requireHandle(call.input().get("handle"));
        var detailRequest = new EasyVObjectReadService.Request(context.executionId(), context.datasetVersionSetId(),
            known.reference().objectKey(), known.reference().objectId(), null, List.of(), List.of(), 1, 0);
        var detail = objects.readDuringExecution(context, scope, detailRequest);
        var fresh = detail.page().rows().getFirst();
        if (!fresh.reference().equals(known.reference())) throw new BackendException("OBJECT_VERSION_MISMATCH", "工具对象引用与当前冻结版本不一致。");
        requireSelected(fresh);
        handles.put((String) call.input().get("handle"), fresh);
        if (call.tool().equals("read_object")) return readOutput(id, call, detail);
      }
      if (call.tool().equals("assess_scheme")) {
        var result = assessments.assessDuringExecution(context, scope, call.selection());
        if (!call.selection().equals(result.selection()) || !context.ontology().versionId().equals(result.ontologyVersionId())
            || !versions.equals(result.productVersionIds())) throw new BackendException("OBJECT_VERSION_MISMATCH", "评估输出与执行冻结输入不一致。");
        var audit = json.map(json.write(result));
        List<Map<String, Object>> rows = new ArrayList<>();
        if (result.comparison() == null) rows.add(Map.of("status", result.status(), "reason", result.reason(), "assessmentId", result.assessmentId()));
        else {
          rows.add(assessmentRow("current", result.comparison().current(), result));
          result.comparison().candidates().forEach(candidate -> rows.add(assessmentRow("candidate", candidate, result)));
        }
        Map<String, Object> observation = Map.of("id", id, "tool", call.tool(), "label", "区域方案适配评估", "totalRows", rows.size(), "rows", rows.stream().limit(EasyVSemanticAgent.EVIDENCE_ROW_CAP).toList(),
            "candidateSetComplete", rows.size() <= EasyVSemanticAgent.EVIDENCE_ROW_CAP, "calibration", "heuristic_pending_real_data_calibration");
        var products = new LinkedHashSet<>(List.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component"));
        if (versions.containsKey("easyv-scheme-library")) products.add("easyv-scheme-library");
        return new Output("区域方案适配评估", List.copyOf(rows), products, observation, audit,
            Map.of("type", "scheme-comparison", "title", "区域方案比较", "role", "primary", "result", audit), List.of(call.selection().reference()));
      }
      return readOutput(id, call, objects.readDuringExecution(context, scope, call.request()));
    }

    private void requireSelected(ObjectQueryPort.Row row) {
      if (selected == null) return;
      var constraints = selections.constrain(new ObjectQueryPort.Query(row.reference().objectKey(), List.of(), List.of(), 1, 0), selected).filters();
      for (var filter : constraints) if (!filter.values().contains(String.valueOf(row.properties().get(filter.member())))) {
        throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "工具对象超出用户所选对象的分析范围。");
      }
    }

    private Output readOutput(String id, Prepared call, EasyVObjectReadService.Result result) {
      if (!context.executionId().equals(result.executionId()) || !context.datasetVersionSetId().equals(result.datasetVersionSetId())
          || !context.ontology().versionId().equals(result.ontologyVersionId())) throw new BackendException("OBJECT_VERSION_MISMATCH", "工具返回的执行、冻结集合或本体不一致。");
      var rows = result.page().rows().stream().map(row -> {
        requireSelected(row);
        Map<String, Object> values = new LinkedHashMap<>(row.properties());
        values.put("handle", register(row)); values.put("objectId", row.reference().objectId());
        return Collections.unmodifiableMap(values);
      }).toList();
      if (!result.page().hasMore() && (call.tool().equals("query_objects") || call.tool().equals("traverse_objects"))) {
        terminalPages.add(new TerminalPage(call.request(), result.page().offset() + rows.size()));
      }
      String label = result.objectType().label() + (call.tool().equals("traverse_objects") ? " · 关联对象" : " · 对象读取");
      Map<String, Object> observation = new LinkedHashMap<>();
      observation.put("id", id); observation.put("tool", call.tool()); observation.put("label", label);
      observation.put("rows", rows); observation.put("hasMore", result.page().hasMore());
      observation.put("offset", result.page().offset()); observation.put("returnedRows", rows.size());
      if (result.structure() != null) observation.put("structureStatus", result.structure().status());
      List<QueryIntent.Filter> filters = call.request().filters();
      if (call.tool().equals("traverse_objects")) {
        var link = semantic.require(call.request().objectKey()).requireLink(call.request().relation());
        var source = requireHandle(call.input().get("handle"));
        filters = new ArrayList<>(filters);
        filters.add(new QueryIntent.Filter(link.targetProperty(), QueryIntent.Operator.EQUALS, List.of(String.valueOf(source.properties().get(link.sourceProperty())))));
      } else if (call.request().objectId() != null) {
        filters = List.of(new QueryIntent.Filter(semantic.require(result.page().objectKey()).primaryKey().key(), QueryIntent.Operator.EQUALS, List.of(call.request().objectId())));
      }
      Map<String, Object> block = Map.of("type", "object-browser", "title", label, "role", "supporting",
          "datasetVersionSetId", context.datasetVersionSetId(), "objectKey", result.page().objectKey(), "filters", filters,
          "scopeDescription", "工具读取的冻结对象范围，分页结果不代表全集。");
      return new Output(label, rows, Set.of("easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component"),
          Collections.unmodifiableMap(observation), json.map(json.write(result)), block, result.page().rows().stream().map(ObjectQueryPort.Row::reference).toList());
    }

    private String register(ObjectQueryPort.Row row) {
      requireObject(row.reference().objectKey());
      if (!Objects.equals(versions.get(semantic.require(row.reference().objectKey()).productKey()), row.reference().productVersionId())) throw new BackendException("OBJECT_VERSION_MISMATCH", "对象句柄来自其他产品版本。");
      String handle = byReference.computeIfAbsent(row.reference(), ignored -> "o" + nextHandle++);
      handles.put(handle, row);
      return handle;
    }
  }

  @SuppressWarnings("unchecked")
  public static List<Map<String, Object>> readTrace(Object raw) {
    if (raw == null) return List.of(); // 已发布的历史指标计划没有工具轨迹。
    if (!(raw instanceof List<?> list) || list.isEmpty() || list.size() > EasyVSemanticAgent.MAX_TOOL_CALLS) throw traceInvalid();
    List<Map<String, Object>> out = new ArrayList<>();
    Set<String> names = Set.of("query_metrics", "query_objects", "read_object", "traverse_objects", "assess_scheme");
    for (int i = 0; i < list.size(); i++) {
      if (!(list.get(i) instanceof Map<?, ?> item) || !item.keySet().equals(Set.of("id", "tool", "label", "input", "references"))
          || !("q" + (i + 1)).equals(item.get("id")) || !names.contains(item.get("tool"))
          || !(item.get("label") instanceof String label) || label.isBlank() || !(item.get("input") instanceof Map<?, ?>)
          || !(item.get("references") instanceof List<?> refs) || refs.size() > 50) throw traceInvalid();
      for (Object rawRef : refs) {
        try {
          var ref = JSON.convertValue(rawRef, ObjectQueryPort.Reference.class);
          if (!OBJECTS.contains(ref.objectKey()) || ref.objectId() == null || ref.objectId().isBlank()
              || ref.productVersionId() == null || ref.productVersionId().isBlank()) throw traceInvalid();
        } catch (IllegalArgumentException error) { throw traceInvalid(); }
      }
      out.add((Map<String, Object>) item);
    }
    return List.copyOf(out);
  }
  private static BackendException traceInvalid() { return new BackendException("FOLLOW_UP_CONTEXT_INVALID", "历史工具轨迹或对象引用无效。"); }

  private static Map<String, Object> assessmentRow(String kind, com.dip3.ontologyagent.easyv.internal.domain.SchemeAdaptation.Assessment assessment, EasyVSchemeAssessmentService.Result result) {
    Map<String, Object> row = new LinkedHashMap<>();
    row.put("kind", kind); row.put("schemeId", assessment.schemeId()); row.put("status", assessment.status());
    row.put("score", assessment.score()); row.put("findings", assessment.findings().stream().map(item -> item.code() + ": " + item.message()).toList().toString());
    row.put("ruleVersion", result.comparison().rules().version()); row.put("assessmentId", result.assessmentId());
    return Collections.unmodifiableMap(row);
  }
  private static <T> List<T> decode(Object raw, Class<T> type, int max) {
    if (raw == null) return List.of();
    if (!(raw instanceof List<?> items) || items.size() > max) throw invalid("工具过滤或排序数量超过限制");
    Set<String> fields = type == QueryIntent.Filter.class ? Set.of("member", "operator", "values") : Set.of("member", "direction");
    if (items.stream().anyMatch(item -> !(item instanceof Map<?, ?> map) || !map.keySet().equals(fields)
        || map.values().stream().anyMatch(Objects::isNull))) throw invalid("工具过滤或排序必须包含完整的声明字段");
    try { return items.stream().map(item -> JSON.convertValue(item, type)).toList(); }
    catch (IllegalArgumentException error) { throw invalid("工具过滤或排序结构无效"); }
  }
  private static int number(Object raw, int fallback, int min, int max) {
    if (raw == null) return fallback;
    if (!(raw instanceof Number n) || n.doubleValue() != n.intValue() || n.intValue() < min || n.intValue() > max) throw invalid("工具分页参数无效");
    return n.intValue();
  }
  private static String text(Object raw) {
    if (!(raw instanceof String s) || s.isBlank()) throw invalid("工具缺少必填字符串");
    return s;
  }
  private static void requireObject(String key) { if (!OBJECTS.contains(key)) throw invalid("不支持对象 " + key); }
  private static BackendException invalid(String message) { return new BackendException("EASYV_PLAN_INVALID", message + "。"); }
}
