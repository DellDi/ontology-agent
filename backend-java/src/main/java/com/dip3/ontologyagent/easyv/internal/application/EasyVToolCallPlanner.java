package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanDecision;
import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel.PlanRequest;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.semantic.api.CompiledSemanticQuery;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.QueryIntentCodec;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.semantic.api.TimeExpression;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * EasyV 工具调用规划、编译与预算校验协作者：处理结构化覆盖（override）、批量检查预读、
 * 选屏前读取、模型多轮规划纠错、句柄/范围约束以及单批去重与预算限制。
 */
final class EasyVToolCallPlanner {

  record ToolCall(String tool, Map<String, Object> input, CompiledSemanticQuery metric,
                  EasyVAgentTools.Prepared object) {
    Object identity() {
      return metric != null ? metric.cubeQuery()
          : object.request() != null ? object.request()
          : object.selection() != null ? object.selection() : input;
    }
  }

  private final EasyVAnalysisModel model;
  private final SemanticModel semantic;
  private final SemanticQueryCompiler compiler;
  private final EasyVObjectSelectionService selections;

  EasyVToolCallPlanner(EasyVAnalysisModel model, SemanticModel semantic, SemanticQueryCompiler compiler,
                       EasyVObjectSelectionService selections) {
    this.model = model;
    this.semantic = semantic;
    this.compiler = compiler;
    this.selections = selections;
  }

  List<ToolCall> plan(AgentTurn turn, ObjectQueryPort.Row selectedObject, List<Map<String, Object>> observations,
                      int remainingQueries, int remainingCalls, long deadline, EasyVAgentTools.Run objectRun,
                      DatasetVersionSet versions) {
    List<?> override = overrideIntents(turn);
    if (override != null) {
      List<CompiledSemanticQuery> compiled = compileOverride(override, turn.anchoredAt());
      return compiled.stream().map(query -> {
        var constrained = selectedObject == null ? query
            : compiler.compile(selections.constrain(query.intent(), selectedObject), turn.anchoredAt()).require();
        if (objectRun.batchSelected()) {
          constrained = compiler.compile(objectRun.constrainBatch(constrained.intent()), turn.anchoredAt()).require();
        }
        return new ToolCall("query_metrics", Map.of("intent", QueryIntentCodec.write(constrained.intent())),
            constrained, null);
      }).toList();
    }
    boolean objectTools = versions.productVersionIds().keySet().containsAll(Set.of(
        "easyv-ai-application", "easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component"));
    if (objectTools && observations.isEmpty() && objectRun.batchSelected()) {
      return objectRun.batchInputs().stream().map(call -> new ToolCall(call.tool(), call.input(), null, call)).toList();
    }
    if (objectTools && !observations.isEmpty() && objectRun.batchSelected()) {
      var inspection = objectRun.batchInspection();
      if (inspection.isPresent()) {
        if (remainingCalls < 1) {
          throw new BackendException("EASYV_REVIEW_INCOMPLETE", "剩余预算不足以读取全部区域的指标依据，请缩小检查范围。");
        }
        var call = inspection.get();
        return List.of(new ToolCall(call.tool(), call.input(), null, call));
      }
    }
    // 选屏后的整屏上下文先读齐，再分配剩余调用；主视觉不在普通块/组件集合中。
    if (objectTools && observations.isEmpty() && selectedObject != null
        && "easyv-prototype-layout".equals(selectedObject.reference().objectKey())) {
      var input = Map.<String, Object>of("handle", "selected");
      return List.of(new ToolCall("read_object", input, null, objectRun.prepare("read_object", input)));
    }
    return planCalls(turn.questionText(), turn.anchoredAt(), turn.referencedConclusion(),
        turn.followUp() ? previousQueries(turn) : List.of(), selectedObject, observations,
        remainingQueries, remainingCalls, deadline, objectRun, objectTools);
  }

  /** 真实 A 规划评测保留入口，只开放指标工具，不执行模型输出。 */
  List<CompiledSemanticQuery> planQueries(String question, Instant anchoredAt, Map<String, Object> previousConclusion,
                                          List<Map<String, Object>> previousQueries) {
    return planCalls(question, anchoredAt, previousConclusion, previousQueries, null, List.of(),
        EasyVSemanticAgent.MAX_QUERIES, EasyVSemanticAgent.MAX_TOOL_CALLS,
        System.nanoTime() + EasyVSemanticAgent.EXECUTION_TIMEOUT_MILLIS * 1_000_000L, null, false)
        .stream().map(ToolCall::metric).toList();
  }

  boolean structuredOverride(AgentTurn turn) {
    return overrideIntents(turn) != null;
  }

  List<Map<String, Object>> previousCalls(AgentTurn turn) {
    return EasyVAgentTools.readTrace(turn.effectiveContext().get("toolCalls"));
  }

  static String toolLabel(String tool) {
    return switch (tool) {
      case "query_objects" -> "读取对象列表";
      case "read_object" -> "读取对象详情";
      case "traverse_objects" -> "穿透对象关系";
      case "assess_scheme" -> "评估区域方案";
      case "inspect_block_improvement" -> "读取块内改造依据";
      case "preview_block_improvement" -> "检查块内重组提案";
      default -> "执行指标查询";
    };
  }

  private List<ToolCall> planCalls(String question, Instant anchoredAt, Map<String, Object> referencedConclusion,
                                   List<Map<String, Object>> previousQueries, ObjectQueryPort.Row selectedObject,
                                   List<Map<String, Object>> observations, int remainingQueries, int remainingCalls,
                                   long deadline, EasyVAgentTools.Run objectRun, boolean objectTools) {
    ZoneId zone = semantic.contributions().stream()
        .filter(item -> EasyVGenerationOntology.DOMAIN_KEY.equals(item.domainKey()))
        .findFirst()
        .orElseThrow(() -> new BackendException("EASYV_SEMANTIC_MODEL_MISSING", "语义层未注册 EasyV 本体。"))
        .businessZone();
    List<Map<String, Object>> catalog = QueryIntentCodec.catalog(semantic, EasyVGenerationOntology.DOMAIN_KEY).stream()
        .filter(item -> objectRun == null || objectRun.canQuery((String) item.get("object"))).toList();
    List<String> violations = List.of();
    for (int attempt = 1; attempt <= 2; attempt += 1) {
      PlanDecision decision;
      try {
        decision = model.plan(new PlanRequest(question, catalog,
            anchoredAt.atZone(zone).toLocalDate().toString(), zone.getId(), referencedConclusion,
            previousQueries, violations, selectedObject == null ? Map.of() : Map.of(
                "reference", selectedObject.reference(),
                "objectLabel", semantic.require(selectedObject.reference().objectKey()).label(),
                "properties", selectedObject.properties()),
            observations, remainingQueries, EasyVSemanticAgent.remainingMillis(deadline), remainingCalls,
            EasyVAgentTools.catalog(objectTools), objectRun == null ? List.of() : objectRun.knownObjects()));
        EasyVSemanticAgent.remainingMillis(deadline);
      } catch (BackendException error) {
        if (!"EASYV_PLAN_INVALID".equals(error.code())) throw error;
        violations = List.of(error.getMessage());
        continue;
      }
      if (decision == null || decision.status() == null) {
        violations = List.of("输出缺少 status");
        continue;
      }
      switch (decision.status()) {
        case CLARIFY -> throw clarification(decision.message(), decision.options());
        case UNSUPPORTED -> throw new BackendException("EASYV_QUESTION_UNSUPPORTED",
            "当前无法完成这个请求：" + EasyVSemanticAgent.nonBlank(decision.message(), "暂未取得具体原因，请重新描述需求。"));
        case FINISHED -> {
          if (!observations.isEmpty() && decision.calls().isEmpty()) return List.of();
          violations = List.of("没有执行结果时不能 finished，finished 不接受 calls");
        }
        case READY -> {
          List<String> found = new ArrayList<>();
          List<ToolCall> compiled = compileCalls(decision.calls(), anchoredAt, found, selectedObject, objectRun, objectTools);
          if (found.isEmpty()) {
            if (compiled.size() > remainingCalls
                || compiled.stream().filter(call -> call.metric() != null).count() > remainingQueries) {
              throw new BackendException("AGENT_TOOL_LIMIT", "EasyV 分析最多执行 8 次工具调用，其中指标查询最多 4 次。");
            }
            if (compiled.stream().map(call -> List.of(call.tool(), call.identity())).distinct().count() != compiled.size()) {
              found.add("同一批次不接受重复调用");
            } else {
              return compiled;
            }
          }
          violations = found;
        }
      }
    }
    throw new BackendException("EASYV_PLAN_INVALID",
        "EasyV 查询规划两次均未通过本体校验：" + String.join("；", violations) + "。");
  }

  @SuppressWarnings("unchecked")
  private List<ToolCall> compileCalls(List<Object> raw, Instant anchor, List<String> violations,
                                      ObjectQueryPort.Row selected, EasyVAgentTools.Run objectRun, boolean objectTools) {
    if (raw.isEmpty() || raw.size() > EasyVSemanticAgent.MAX_TOOL_CALLS) {
      violations.add("calls 需要 1-8 个调用");
      return List.of();
    }
    List<ToolCall> compiled = new ArrayList<>();
    for (Object item : raw) {
      if (!(item instanceof Map<?, ?> call) || !call.keySet().equals(Set.of("tool", "input"))
          || !(call.get("tool") instanceof String tool)
          || !(call.get("input") instanceof Map<?, ?> rawInput)
          || rawInput.keySet().stream().anyMatch(k -> !(k instanceof String))
          || rawInput.values().stream().anyMatch(Objects::isNull)) {
        violations.add("调用必须且只能包含 tool 和非空 input 对象");
        continue;
      }
      var input = (Map<String, Object>) rawInput;
      try {
        if (tool.equals("query_metrics")) {
          if (!Set.of("intent", "handle").containsAll(input.keySet()) || !input.containsKey("intent")) {
            throw new BackendException("EASYV_PLAN_INVALID", "query_metrics 需要 intent，可选 handle，禁止其他字段。");
          }
          var result = compile(List.of(input.get("intent")), anchor, violations, selected);
          if (!result.isEmpty()) {
            var query = result.getFirst();
            if (input.containsKey("handle")) {
              if (objectRun == null) throw new BackendException("EASYV_PLAN_INVALID", "当前规划入口没有对象句柄。");
              var row = objectRun.requireHandle(input.get("handle"));
              if (row.properties().isEmpty()) {
                throw new BackendException("EASYV_PLAN_INVALID", "历史对象先 read_object，再按真实属性查询指标。");
              }
              query = compiler.compile(selections.constrain(query.intent(), row), anchor).require();
            }
            if (objectRun != null && objectRun.batchSelected()) {
              query = compiler.compile(objectRun.constrainBatch(query.intent()), anchor).require();
            }
            compiled.add(new ToolCall(tool, Map.copyOf(input), query, null));
          }
        } else {
          if (!objectTools || objectRun == null) {
            throw new BackendException("EASYV_PLAN_INVALID", "当前冻结集合或入口未提供对象工具。");
          }
          var prepared = objectRun.prepare(tool, input);
          compiled.add(new ToolCall(tool, Map.copyOf(input), null, prepared));
        }
      } catch (BackendException error) {
        if (!Set.of("EASYV_PLAN_INVALID", "OBJECT_SELECTION_QUERY_UNSUPPORTED", "OBJECT_SELECTION_INVALID")
            .contains(error.code())) {
          throw error;
        }
        violations.add(error.getMessage());
      }
    }
    return compiled;
  }

  /** 结构化调整轮次：不调用模型，直接编译用户编辑后的查询意图；任何违规都 fail loud，不回退模型规划。 */
  private List<CompiledSemanticQuery> compileOverride(List<?> override, Instant anchoredAt) {
    List<String> violations = new ArrayList<>();
    List<CompiledSemanticQuery> compiled = new ArrayList<>();
    if (override.size() > EasyVSemanticAgent.MAX_QUERIES) {
      violations.add("override 最多 " + EasyVSemanticAgent.MAX_QUERIES + " 个查询意图");
    }
    for (int index = 0; index < override.size(); index += 1) {
      Object entry = override.get(index);
      String id = entry instanceof Map<?, ?> map && map.get("id") instanceof String text && !text.isBlank()
          ? text : "q" + (index + 1);
      CompiledSemanticQuery query = parseAndCompileIntent("查询 " + id + "：",
          entry instanceof Map<?, ?> map ? map.get("intent") : null, anchoredAt, violations, false, null);
      if (query != null) compiled.add(query);
    }
    if (!violations.isEmpty()) {
      throw new BackendException("EASYV_OVERRIDE_INVALID",
          "结构化调整的查询意图未通过本体校验：" + String.join("；", violations) + "。");
    }
    return compiled;
  }

  private List<CompiledSemanticQuery> compile(List<Object> raw, Instant anchoredAt, List<String> violations,
                                              ObjectQueryPort.Row selectedObject) {
    if (raw.isEmpty() || raw.size() > EasyVSemanticAgent.MAX_QUERIES) {
      violations.add("queries 需要 1-" + EasyVSemanticAgent.MAX_QUERIES + " 个查询意图");
      return List.of();
    }
    List<CompiledSemanticQuery> compiled = new ArrayList<>();
    for (int index = 0; index < raw.size(); index += 1) {
      CompiledSemanticQuery query = parseAndCompileIntent("查询 q" + (index + 1) + "：",
          raw.get(index), anchoredAt, violations, true, selectedObject);
      if (query != null) compiled.add(query);
    }
    return compiled;
  }

  private CompiledSemanticQuery parseAndCompileIntent(String prefix, Object rawIntent, Instant anchoredAt,
                                                      List<String> violations, boolean checkAmbiguity,
                                                      ObjectQueryPort.Row selectedObject) {
    QueryIntentCodec.Parsed parsed = QueryIntentCodec.read(rawIntent);
    if (!parsed.accepted()) {
      parsed.violations().forEach(item -> violations.add(prefix + item));
      return null;
    }
    QueryIntent intent = parsed.intent();
    if (semantic.find(intent.objectKey()).isPresent()
        && !EasyVGenerationOntology.DOMAIN_KEY.equals(semantic.domainKey(intent.objectKey()))) {
      violations.add(prefix + "对象 " + intent.objectKey() + " 不属于 EasyV 领域");
      return null;
    }
    if (checkAmbiguity) {
      ambiguity(intent.time() == null ? null : intent.time().expression());
      ambiguity(intent.compare());
      if (selectedObject != null && semantic.find(intent.objectKey()).isPresent()) {
        try {
          intent = selections.constrain(intent, selectedObject);
        } catch (BackendException error) {
          if (!"OBJECT_SELECTION_QUERY_UNSUPPORTED".equals(error.code())) throw error;
          violations.add(prefix + error.getMessage());
          return null;
        }
      }
    }
    SemanticQueryCompiler.Result result = compiler.compile(intent, anchoredAt);
    if (result.accepted()) return result.query();
    result.violations().forEach(item -> violations.add(prefix + item));
    return null;
  }

  private static List<?> overrideIntents(AgentTurn turn) {
    return turn.effectiveContext().get("override") instanceof List<?> list && !list.isEmpty() ? list : null;
  }

  private static void ambiguity(TimeExpression expression) {
    if (expression != null && expression.kind() == TimeExpression.Kind.AMBIGUOUS) {
      throw clarification("“" + expression.sourceText() + "”指哪段时间？",
          expression.candidates().stream().map(TimeExpression::sourceText).toList());
    }
  }

  private static BackendException clarification(String message, List<String> options) {
    String question = EasyVSemanticAgent.nonBlank(message, "问题需要进一步明确");
    // 契约上限 6 个非空选项：模型给出更多或空白项时收敛到契约内，保证失败快照可解析
    List<String> normalized = options == null ? List.of() : options.stream()
        .map(option -> option == null ? "" : option.trim())
        .filter(option -> !option.isEmpty())
        .distinct()
        .limit(6)
        .toList();
    String choices = normalized.isEmpty() ? "" : "可选：" + String.join(" / ", normalized) + "。";
    return BackendException.clarification("EASYV_CLARIFICATION_REQUIRED",
        "需要先确认：" + question + (choices.isEmpty() ? "" : " " + choices) + " 请补充后重新提问。",
        question, normalized);
  }

  @SuppressWarnings("unchecked")
  private List<Map<String, Object>> previousQueries(AgentTurn turn) {
    Object raw = turn.effectiveContext().get("queries");
    if (!(raw instanceof List<?> list) || (list.isEmpty() && previousCalls(turn).isEmpty())
        || list.stream().anyMatch(item -> !(item instanceof Map<?, ?>))) {
      throw new BackendException("FOLLOW_UP_CONTEXT_INVALID", "EasyV 追问缺少上一轮已执行的查询意图。");
    }
    return list.stream().map(item -> (Map<String, Object>) item).toList();
  }
}
