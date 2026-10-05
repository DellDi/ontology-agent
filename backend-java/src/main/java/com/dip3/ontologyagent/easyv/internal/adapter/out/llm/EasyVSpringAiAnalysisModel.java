package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.fasterxml.jackson.core.JsonProcessingException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import java.time.Duration;
import java.util.concurrent.TimeoutException;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * EasyV 分析模型的 Spring AI 适配：规划输出本体查询意图 JSON，综合输出带数据引用的回答 JSON。
 * 本适配器只负责调用与 JSON 结构解析；意图编译、引用校验与纠正轮由应用层负责。
 */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVSpringAiAnalysisModel implements EasyVAnalysisModel {

  private static final String PLANNER_PROMPT =
      """
      你是 EasyV 数据分析规划器。把用户问题翻译为基于本体目录的结构化查询意图，禁止输出 SQL。
      只能输出一个 JSON 对象，四选一：
      1. {"status":"ready","calls":[{"tool":"工具名","input":工具输入}, ...]}：只调用 tools 目录中的工具
      2. {"status":"clarify","question":"需要用户确认的问题","options":["候选1","候选2"]}：问题存在多种合理理解且会得到不同结果时
      3. {"status":"unsupported","reason":"原因"}：目录中没有能回答该问题的对象、属性或指标时
      4. {"status":"finished"}：observations 中已有足够真实结果回答问题；首次没有结果时禁止使用
      工具规则：
      - query_metrics.input={"intent":查询意图,"handle":"可选对象句柄"}，每轮最多 4 个指标查询；
        handle 由 Java 强制增加对象约束，与用户选择同时生效
      - query_objects/read_object/traverse_objects/assess_scheme 的输入结构见 tools。
        对象过滤 operator 用 EQUALS|NOT_EQUALS|CONTAINS|GT|GTE|LT|LTE|SET|NOT_SET，排序 direction 用 ASC|DESC
      - 查看、列举或打开原型/区域/组件时使用对象工具；指标统计不能替代对象列表或详情。
        对象列表已返回空 rows 且 hasMore=false 时，可以明确回答该查询范围没有对象，不为获取对象再追加数量统计。
      - 对象只能是 easyv-prototype-layout、easyv-prototype-block、easyv-prototype-component。
        relation 必须来自源对象的本体 links；不得输出执行、数据版本、SQL、表名或自行生成对象 ID
      - read_object/traverse_objects/assess_scheme 只能使用 knownObjects 或先前真实输出中的 handle。
        knownObjects.read=false 代表历史引用，先 read_object，再根据最新授权读取的属性继续分析
      - 同一批 calls 只能引用规划前已经存在的句柄。依赖前一步结果时只输出前一步，待结果返回再规划
      - remainingCalls 是所有工具的剩余次数；用尽后应 finished，无法回答时说明不足，不能追加工具
      - 对象分页 hasMore=true 表示还有结果，不能把已返回的对象数量称为全部对象数
      - 方案分数是带版本、待真实校准的适配规则输出，不是成功概率；不可评估时 score=null，不能补零
      query_metrics 的查询意图结构：
      {"object":"对象 key","measures":["该对象的指标 key"],"dimensions":["属性 key 或 关系key.属性key"],
       "filters":[{"member":"属性路径或指标 key","operator":"equals|not-equals|contains|gt|gte|lt|lte|set|not-set","values":["值"]}],
       "time":{"dimension":"可选，时间属性路径，缺省用对象默认时间","expression":时间表达式,"granularity":"可选 day|week|month|quarter|year"}（必填）,
       "compare":可选的对比区间时间表达式,"order":[{"member":"指标/维度/time","direction":"asc|desc"}],"limit":可选 Top N}
      时间表达式：{"sourceText":"用户原话","kind":"relative|calendar|to-date|absolute|all|ambiguous", ...}
      - relative：最近 n 个 unit（总是截止并包含锚点当天），需要 unit(day|week|month|quarter|year) 与 n
      - calendar：自然周期偏移，需要 unit 与 offset（0=本期截至今天，-1=上一期完整区间，-2=再往前一期）；
        指某个已过去的完整自然日/周/月/季/年（不含今天）时必须用 calendar 的负 offset，不能用 relative
      - to-date：本周/本月/本季度/今年以来，只需要 unit
      - absolute：需要 from 与 to（yyyy-MM-dd）
      - all：用户没有指定时间时必须显式使用 all，按全部数据
      - ambiguous：无法确定时，给出 candidates（候选时间表达式数组）
      时间表达式必须嵌套在 time.expression 中，结构示例（仅示意结构，key 以目录为准）：
      {"object":"对象key","measures":["指标key"],"dimensions":[],"filters":[],
       "time":{"expression":{"sourceText":"最近两个月","kind":"relative","unit":"month","n":2},"granularity":"week"}}
      规则：
      - observations 是本轮已执行的真实结果，每次执行后都会重新规划。已有足够证据时立即 finished；
        需要追加调用时只输出尚未执行的调用，禁止重复调用。remainingQueries 是本轮剩余指标查询次数，不能超出
      - observations.rows 最多 50 行，totalRows 表示完整结果数量，禁止把截取的结果当作全集
      - object/measures/dimensions/filters 只能逐字使用目录中的 key；关系路径为 “关系key.目标属性key”
      - 时间只用时间表达式描述，不要自行计算日期；锚点日期与时区由输入给出
      - 只有用户要求看趋势或按日/周/月等拆分时才设置 time.granularity；询问一段时间内的总量、比率或单个数值时
        不要设置 granularity（如“某个月一共有多少”“某几天的比率”应返回一个汇总值）
      - 排行类问题用 order + limit；非排行问题不要设置 limit
      - 对比两个时期、环比或同比时，必须同时保留两个区间：time.expression 为本次主区间，compare 为对比区间。
        compare 与 time 同级，直接放时间表达式，不嵌套 expression；不能只查询一个时期后结束。
      - 追问时 previousQueries 是上一轮已执行的查询，按用户的新问题在其基础上调整；追问必须体现新问题带来的变化，
        不能原样重复上一轮查询。只追问“和某期比/对比/环比”时，保留原 object/measures/dimensions/filters/time，
        在同一个 intent 上增加或替换 compare，不得遗漏比较区间。
      - selectedObject 是用户从真实对象中选中的上下文：只查询这个对象或本体中直接关联的对象；
        对象身份与版本由服务端验证并强制约束，禁止生成或替换对象 ID。无法用这些对象回答时返回 unsupported
      - 若输入含 violations，说明上一次输出未通过校验，必须逐条修正后重新输出
      对比调用的完整结构示例（对象和指标按用户问题与目录选择）：
      {"status":"ready","calls":[{"tool":"query_metrics","input":{"intent":{"object":"easyv-ai-application",
       "measures":["count"],"time":{"expression":{"sourceText":"本月","kind":"to-date","unit":"month"}},
       "compare":{"sourceText":"上个月","kind":"calendar","unit":"month","offset":-1}}}}]}
      输出前核对：time 中只能有 dimension/expression/granularity；compare 唯一合法位置是 calls[i].input.intent.compare。
      """;

  private static final String COMPOSER_PROMPT =
      """
      你是 EasyV 数据分析回答器。只基于给定的查询结果，用中文直接回答用户问题。
      只能输出一个 JSON 对象，answer 必须是第一个字段：
      {"answer":"markdown 回答","citations":[{"query":"查询 id","row":行下标,"field":"列 key"}],
       "highlights":[{"query":"查询 id","viz":"bar|line|pie|table|none"}],
       "suggestions":["追问建议"],"suggestedActions":[{"label":"动作名","rationale":"基于数据的理由"}]}
      规则：
      - 数字必须与结果一致，禁止编造；结果为空或数据覆盖不足时如实说明，并说明数据覆盖区间
      - citations 列出回答中每个关键数字对应的数据点（query 为结果 id，row 为 rows 下标，field 为列 key）；
        有非空结果时至少一个，所有结果 rows 为空时返回 []，不得编造行或把列表长度当作结果字段引用
      - field 必须实际存在于所引用的 rows[row]，不能引用 structureStatus/hasMore/returnedRows 等结果元数据
      - highlights 选 0-3 个真正支撑回答的查询作为主图表
      - suggestions 为 2-3 个用户下一步最可能追问的问题，必须能由目录内数据回答，不出现字段 key 或技术术语
      - suggestedActions 为 0-2 个基于结论的业务处置建议，无事可办时输出空数组，rationale 必须引用具体数字
      - 回答注明数据范围（输入 dataScope）
      - 若输入含 violations，说明上一次输出未通过校验，必须逐条修正后重新输出
      """;

  private final ChatClient chat;
  private final JsonCodec json;

  public EasyVSpringAiAnalysisModel(ChatClient.Builder builder, JsonCodec json) {
    this.chat = builder.build();
    this.json = json;
  }

  @Override
  public PlanDecision plan(PlanRequest request) {
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("question", request.question());
    input.put("anchorDate", request.anchorDate());
    input.put("zone", request.zone());
    input.put("catalog", request.catalog());
    input.put("observations", request.observations());
    input.put("remainingQueries", request.remainingQueries());
    input.put("remainingCalls", request.remainingCalls());
    input.put("tools", request.tools());
    input.put("knownObjects", request.knownObjects());
    if (!request.previousConclusion().isEmpty()) input.put("previousConclusion", request.previousConclusion());
    if (!request.previousQueries().isEmpty()) input.put("previousQueries", request.previousQueries());
    if (!request.selectedObject().isEmpty()) input.put("selectedObject", request.selectedObject());
    if (!request.violations().isEmpty()) input.put("violations", request.violations());
    Map<String, Object> parsed = parseJson(stream(PLANNER_PROMPT, input, ignored -> {}, request.remainingMillis()), "EASYV_PLAN_INVALID");
    String status = parsed.get("status") instanceof String text ? text.trim().toLowerCase(Locale.ROOT) : "";
    return switch (status) {
      case "ready" -> {
        if (!(parsed.get("calls") instanceof List<?> calls)) {
          throw new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划缺少 calls 数组。");
        }
        yield new PlanDecision(PlanStatus.READY, new ArrayList<>(calls), null, List.of());
      }
      case "clarify" -> new PlanDecision(PlanStatus.CLARIFY, List.of(), text(parsed.get("question")),
          strings(parsed.get("options")));
      case "unsupported" -> new PlanDecision(PlanStatus.UNSUPPORTED, List.of(), text(parsed.get("reason")), List.of());
      case "finished" -> {
        if (!parsed.keySet().equals(java.util.Set.of("status"))) {
          throw new BackendException("EASYV_PLAN_INVALID", "finished 不接受查询或其他字段。");
        }
        yield new PlanDecision(PlanStatus.FINISHED, List.of(), null, List.of());
      }
      default -> throw new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划 status 无效：" + status);
    };
  }

  @Override
  public ComposedAnswer compose(ComposeRequest request, Consumer<String> partialAnswer) {
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("question", request.question());
    input.put("dataScope", request.dataScope());
    input.put("results", request.results());
    if (!request.violations().isEmpty()) input.put("violations", request.violations());
    Map<String, Object> parsed = parseJson(stream(COMPOSER_PROMPT, input, partialAnswer, request.remainingMillis()), "EASYV_ANSWER_INVALID");
    String answer = text(parsed.get("answer"));
    if (answer == null) {
      throw new BackendException("EASYV_ANSWER_INVALID", "EasyV 回答缺少 answer 文本。");
    }
    List<Citation> citations = new ArrayList<>();
    for (Map<?, ?> item : maps(parsed.get("citations"))) {
      if (item.get("row") instanceof Number row) {
        citations.add(new Citation(text(item.get("query")), row.intValue(), text(item.get("field"))));
      }
    }
    List<Highlight> highlights = new ArrayList<>();
    for (Map<?, ?> item : maps(parsed.get("highlights"))) {
      String viz = text(item.get("viz"));
      highlights.add(new Highlight(text(item.get("query")), viz == null ? "none" : viz.toLowerCase(Locale.ROOT)));
    }
    List<SuggestedAction> actions = new ArrayList<>();
    for (Map<?, ?> item : maps(parsed.get("suggestedActions"))) {
      String label = text(item.get("label"));
      String rationale = text(item.get("rationale"));
      if (label != null && rationale != null) actions.add(new SuggestedAction(label, rationale));
    }
    return new ComposedAnswer(answer, citations, highlights,
        strings(parsed.get("suggestions")).stream().limit(3).toList(), actions.stream().limit(3).toList());
  }

  /** 流式调用：按 chunk 累计缓冲，增量提取 answer 字段已完成前缀回调（累计值）。 */
  private String stream(String systemPrompt, Map<String, Object> input, Consumer<String> partialAnswer, long remainingMillis) {
    if (remainingMillis <= 0) throw new BackendException("AGENT_EXECUTION_TIMEOUT", "EasyV 分析已超过执行时限。");
    StringBuilder buffer = new StringBuilder();
    try {
      chat.prompt().options(OpenAiChatOptions.builder().responseFormat(OpenAiChatModel.ResponseFormat.builder()
              .type(OpenAiChatModel.ResponseFormat.Type.JSON_OBJECT).build()))
          .system(systemPrompt).user(json.write(input)).stream().content()
          .doOnNext(chunk -> {
            buffer.append(chunk);
            String partial = PartialJsonString.valueAt(buffer, "answer");
            if (partial != null && !partial.isBlank()) partialAnswer.accept(partial);
          })
          .blockLast(Duration.ofMillis(remainingMillis));
    } catch (RuntimeException error) {
      for (Throwable cause = error; cause != null; cause = cause.getCause()) {
        if (cause instanceof TimeoutException) {
          throw new BackendException("AGENT_EXECUTION_TIMEOUT", "EasyV 模型调用超过本轮剩余执行时限。", error);
        }
      }
      throw providerFailure(error);
    }
    return buffer.toString();
  }

  private Map<String, Object> parseJson(String content, String code) {
    if (content == null || content.isBlank()) {
      throw new BackendException(code, "EasyV 模型输出为空。");
    }
    String text = content.trim();
    int start = text.indexOf('{');
    int end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new BackendException(code, "EasyV 模型输出不是 JSON 对象。");
    }
    try {
      return json.map(text.substring(start, end + 1));
    } catch (RuntimeException error) {
      String detail = "";
      if (error.getCause() instanceof JsonProcessingException parse) {
        var location = parse.getLocation();
        detail = "：" + parse.getOriginalMessage();
        if (location != null) detail += "（第 " + location.getLineNr() + " 行，第 " + location.getColumnNr() + " 列）";
      }
      throw new BackendException(code, "EasyV 模型输出 JSON 解析失败" + detail + "。", error);
    }
  }

  private static String text(Object value) {
    return value instanceof String text && !text.isBlank() ? text.trim() : null;
  }

  private static List<String> strings(Object value) {
    if (!(value instanceof List<?> list)) return List.of();
    return list.stream().map(EasyVSpringAiAnalysisModel::text).filter(item -> item != null).toList();
  }

  private static List<Map<?, ?>> maps(Object value) {
    if (!(value instanceof List<?> list)) return List.of();
    List<Map<?, ?>> out = new ArrayList<>();
    for (Object item : list) {
      if (item instanceof Map<?, ?> map) out.add(map);
    }
    return out;
  }

  private static BackendException providerFailure(RuntimeException error) {
    Throwable current = error;
    while (current != null) {
      if (current instanceof BackendException known) return known;
      current = current.getCause();
    }
    return new BackendException("AGENT_PROVIDER_FAILURE", "EasyV 分析模型调用失败。", error);
  }
}
