package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import com.dip3.ontologyagent.easyv.internal.application.EasyVAnalysisModel;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import org.springframework.ai.chat.client.ChatClient;
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
      只能输出一个 JSON 对象，三选一：
      1. {"status":"ready","queries":[查询意图, ...]}：1-4 个查询，每个查询以一个 object 为根
      2. {"status":"clarify","question":"需要用户确认的问题","options":["候选1","候选2"]}：问题存在多种合理理解且会得到不同结果时
      3. {"status":"unsupported","reason":"原因"}：目录中没有能回答该问题的对象、属性或指标时
      查询意图结构：
      {"object":"对象 key","measures":["该对象的指标 key"],"dimensions":["属性 key 或 关系key.属性key"],
       "filters":[{"member":"属性路径或指标 key","operator":"equals|not-equals|contains|gt|gte|lt|lte|set|not-set","values":["值"]}],
       "time":{"dimension":"可选，时间属性路径，缺省用对象默认时间","expression":时间表达式,"granularity":"可选 day|week|month|quarter|year"}（必填）,
       "compare":可选的对比区间时间表达式,"order":[{"member":"指标/维度/time","direction":"asc|desc"}],"limit":可选 Top N}
      时间表达式：{"sourceText":"用户原话","kind":"relative|calendar|to-date|absolute|all|ambiguous", ...}
      - relative：最近 n 个 unit（含锚点当天），需要 unit(day|week|month|quarter|year) 与 n
      - calendar：自然周期偏移，需要 unit 与 offset（0=本期截至今天，-1=上一期完整区间）
      - to-date：本周/本月/本季度/今年以来，只需要 unit
      - absolute：需要 from 与 to（yyyy-MM-dd）
      - all：用户没有指定时间时必须显式使用 all，按全部数据
      - ambiguous：无法确定时，给出 candidates（候选时间表达式数组）
      规则：
      - object/measures/dimensions/filters 只能逐字使用目录中的 key；关系路径为 “关系key.目标属性key”
      - 时间只用时间表达式描述，不要自行计算日期；锚点日期与时区由输入给出
      - 趋势类问题用 time.granularity；排行类问题用 order + limit；环比/同比用 compare
      - 追问时 previousQueries 是上一轮已执行的查询，按用户的新问题在其基础上调整
      - 若输入含 violations，说明上一次输出未通过校验，必须逐条修正后重新输出
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
      - citations 列出回答中每个关键数字对应的数据点（query 为结果 id，row 为 rows 下标，field 为列 key），至少一个
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
    if (!request.previousConclusion().isEmpty()) input.put("previousConclusion", request.previousConclusion());
    if (!request.previousQueries().isEmpty()) input.put("previousQueries", request.previousQueries());
    if (!request.violations().isEmpty()) input.put("violations", request.violations());
    Map<String, Object> parsed = parseJson(call(PLANNER_PROMPT, input), "EASYV_PLAN_INVALID");
    String status = parsed.get("status") instanceof String text ? text.trim().toLowerCase(Locale.ROOT) : "";
    return switch (status) {
      case "ready" -> {
        if (!(parsed.get("queries") instanceof List<?> queries)) {
          throw new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划缺少 queries 数组。");
        }
        yield new PlanDecision(PlanStatus.READY, new ArrayList<>(queries), null, List.of());
      }
      case "clarify" -> new PlanDecision(PlanStatus.CLARIFY, List.of(), text(parsed.get("question")),
          strings(parsed.get("options")));
      case "unsupported" -> new PlanDecision(PlanStatus.UNSUPPORTED, List.of(), text(parsed.get("reason")), List.of());
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
    Map<String, Object> parsed = parseJson(stream(COMPOSER_PROMPT, input, partialAnswer), "EASYV_ANSWER_INVALID");
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

  private String call(String systemPrompt, Map<String, Object> input) {
    try {
      return chat.prompt().system(systemPrompt).user(json.write(input)).call().content();
    } catch (RuntimeException error) {
      throw providerFailure(error);
    }
  }

  /** 流式调用：按 chunk 累计缓冲，增量提取 answer 字段已完成前缀回调（累计值）。 */
  private String stream(String systemPrompt, Map<String, Object> input, Consumer<String> partialAnswer) {
    StringBuilder buffer = new StringBuilder();
    try {
      chat.prompt().system(systemPrompt).user(json.write(input)).stream().content()
          .doOnNext(chunk -> {
            buffer.append(chunk);
            String partial = PartialJsonString.valueAt(buffer, "answer");
            if (partial != null && !partial.isBlank()) partialAnswer.accept(partial);
          })
          .blockLast();
    } catch (RuntimeException error) {
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
      throw new BackendException(code, "EasyV 模型输出 JSON 解析失败。", error);
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
