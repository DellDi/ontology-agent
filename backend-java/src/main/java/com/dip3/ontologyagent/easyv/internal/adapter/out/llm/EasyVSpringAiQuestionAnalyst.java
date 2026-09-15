package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import com.dip3.ontologyagent.easyv.internal.application.EasyVQuestionAnalyst;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVQueryCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * LLM 问题分析适配器：规划阶段只输出目录内查询 key，综合阶段只引用
 * 已返回数据。两次调用各允许一次纠正重试；规划仍失败由工作流回退到
 * 默认总览查询集，综合失败按 fail loud 上抛。
 */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVSpringAiQuestionAnalyst implements EasyVQuestionAnalyst {

  private static final int MAX_PLAN_QUERIES = 8;
  private static final Set<String> VIZ = Set.of("bar", "pie", "line", "table", "none");

  private static final String PLANNER_PROMPT =
      """
      你是 EasyV 数据分析规划器。根据用户问题，从已发布查询目录中选择需要执行的查询 key。
      规则：
      - 只能输出 JSON：{"queries": ["key1", "key2", ...]}，1 到 %d 个 key，按回答需要排序
      - key 必须逐字来自目录，不得编造
      - 用户问"多少/数量/分布/趋势/排行"等事实问题时选择对应查询；问生成质量类综合问题时选择覆盖面足够的多个查询
      - 数据边界：采集数据包含 AI 应用、原型流水线、Forge 生成任务、用户操作反馈四类事实；没有用户注册时间字段（最接近的是各用户首次创建应用时间），没有应用名称、空间名称等文本字段
      """.formatted(MAX_PLAN_QUERIES);

  private static final String COMPOSER_PROMPT =
      """
      你是 EasyV 数据分析回答器。基于给定的事实查询结果，用中文直接回答用户问题。
      规则：
      - 只能使用提供的数据，数字必须与数据一致，禁止编造
      - 数据没有覆盖的信息要如实说明（例如：采集数据没有用户注册时间字段，可改为给出各用户首次创建应用时间）
      - 输出 JSON：{"answer": "markdown 回答", "highlights": [{"key": "查询key", "viz": "bar|pie|line|table|none"}]}
      - answer 为 markdown，可使用列表与表格；先直接给结论，再给必要明细
      - highlights 只从已执行的查询 key 中选择真正支撑回答的 0-3 个；series 形状数据才可配图表，record 形状数据用 table 或 none
      """;

  private final ChatClient chat;
  private final JsonCodec json;

  public EasyVSpringAiQuestionAnalyst(ChatClient.Builder builder, JsonCodec json) {
    this.chat = builder.build();
    this.json = json;
  }

  @Override
  public List<String> planQueries(String question, List<EasyVQueryCatalog.Spec> catalog) {
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("question", question);
    input.put("catalog", EasyVQueryCatalog.describeForPrompt());
    BackendException last = null;
    for (int attempt = 1; attempt <= 2; attempt += 1) {
      if (last != null) {
        input.put("previousAttemptError", last.getMessage());
      }
      String content = call(PLANNER_PROMPT, input);
      try {
        return sanitizeKeys(parseQueries(content));
      } catch (BackendException error) {
        last = error;
      }
    }
    throw last == null
        ? new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划未返回有效查询 key。")
        : last;
  }

  @Override
  public ComposedAnswer composeAnswer(
      String question, String rangeDescription, List<QueryResult> results) {
    Map<String, Object> input = new LinkedHashMap<>();
    input.put("question", question);
    input.put("range", rangeDescription);
    input.put("results", results.stream().map(this::resultProjection).toList());
    BackendException last = null;
    for (int attempt = 1; attempt <= 2; attempt += 1) {
      if (last != null) {
        input.put("previousAttemptError", last.getMessage());
      }
      String content = call(COMPOSER_PROMPT, input);
      try {
        return parseAnswer(content, results);
      } catch (BackendException error) {
        last = error;
      }
    }
    throw last == null
        ? new BackendException("EASYV_ANSWER_INVALID", "EasyV 回答生成未返回有效内容。")
        : last;
  }

  private String call(String systemPrompt, Map<String, Object> input) {
    try {
      return chat.prompt().system(systemPrompt).user(json.write(input)).call().content();
    } catch (RuntimeException error) {
      BackendException cause = backendCause(error);
      if (cause != null) {
        throw cause;
      }
      throw new BackendException("AGENT_PROVIDER_FAILURE", "EasyV 问题分析模型调用失败。", error);
    }
  }

  private List<String> parseQueries(String content) {
    Map<String, Object> parsed = parseJson(content, "EASYV_PLAN_INVALID");
    Object queries = parsed.get("queries");
    if (!(queries instanceof List<?> list) || list.isEmpty()) {
      throw new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划缺少 queries 数组。");
    }
    List<String> keys = new ArrayList<>();
    for (Object item : list) {
      if (item instanceof String key) {
        keys.add(key);
      }
    }
    if (keys.isEmpty()) {
      throw new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划 queries 无有效 key。");
    }
    return keys;
  }

  private static List<String> sanitizeKeys(List<String> keys) {
    Set<String> valid = new LinkedHashSet<>();
    for (String key : keys) {
      if (EasyVQueryCatalog.contains(key)) {
        valid.add(key);
      }
    }
    if (valid.isEmpty()) {
      throw new BackendException("EASYV_PLAN_INVALID", "EasyV 查询规划不含已发布查询 key。");
    }
    return valid.stream().limit(MAX_PLAN_QUERIES).toList();
  }

  private ComposedAnswer parseAnswer(String content, List<QueryResult> results) {
    Map<String, Object> parsed = parseJson(content, "EASYV_ANSWER_INVALID");
    Object answer = parsed.get("answer");
    if (!(answer instanceof String markdown) || markdown.isBlank()) {
      throw new BackendException("EASYV_ANSWER_INVALID", "EasyV 回答缺少 answer 文本。");
    }
    Set<String> seriesKeys = new LinkedHashSet<>();
    Set<String> allKeys = new LinkedHashSet<>();
    for (QueryResult result : results) {
      allKeys.add(result.spec().key());
      if (result.spec().shape() == EasyVQueryCatalog.Shape.SERIES) {
        seriesKeys.add(result.spec().key());
      }
    }
    List<Highlight> highlights = new ArrayList<>();
    Object rawHighlights = parsed.get("highlights");
    if (rawHighlights instanceof List<?> list) {
      for (Object item : list) {
        if (!(item instanceof Map<?, ?> entry)) {
          continue;
        }
        Object key = entry.get("key");
        Object viz = entry.get("viz");
        if (!(key instanceof String queryKey) || !allKeys.contains(queryKey)) {
          continue;
        }
        String vizValue = viz instanceof String text ? text.toLowerCase(java.util.Locale.ROOT) : "none";
        if (!VIZ.contains(vizValue)) {
          vizValue = "none";
        }
        if (!seriesKeys.contains(queryKey) && !"table".equals(vizValue) && !"none".equals(vizValue)) {
          vizValue = "table";
        }
        highlights.add(new Highlight(queryKey, vizValue));
      }
    }
    return new ComposedAnswer(markdown, highlights);
  }

  private Map<String, Object> resultProjection(QueryResult result) {
    Map<String, Object> projection = new LinkedHashMap<>();
    projection.put("key", result.spec().key());
    projection.put("label", result.spec().label());
    projection.put("description", result.spec().description());
    projection.put("shape", result.spec().shape().name().toLowerCase(java.util.Locale.ROOT));
    projection.put("rows", result.rows());
    return projection;
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

  private static BackendException backendCause(Throwable error) {
    Throwable current = error;
    while (current != null) {
      if (current instanceof BackendException known) {
        return known;
      }
      current = current.getCause();
    }
    return null;
  }
}
