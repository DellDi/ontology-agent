package com.dip3.ontologyagent.easyv.internal.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * EasyV 受控问答查询目录：LLM 只能按 key 选择这里发布的事实查询，
 * 服务端据此执行固定 SQL 模板；新增可回答问题只通过扩展目录完成。
 */
public final class EasyVQueryCatalog {

  public enum Shape {
    /** label/value 序列行，可渲染为图表或表格。 */
    SERIES,
    /** 单行多列指标记录，渲染为指标表。 */
    RECORD
  }

  public record Spec(String key, String label, String description, String fact, Shape shape) {}

  private static final Map<String, Spec> SPECS = new LinkedHashMap<>();

  static {
    register(new Spec("ai-application-count", "AI 应用总数",
        "统计范围内的 AI 应用（大屏）数量", "application", Shape.RECORD));
    register(new Spec("prototype-count", "原型总数",
        "进入原型流水线的应用数量", "application", Shape.RECORD));
    register(new Spec("user-count", "操作用户数",
        "统计范围内创建过 AI 应用的去重用户数；采集数据没有注册表，只能回答活跃用户口径",
        "application", Shape.RECORD));
    register(new Spec("user-first-active", "各用户首次创建应用时间",
        "每个用户在采集数据中首次创建应用的时间；采集数据没有注册时间字段，这是最接近的事实",
        "application", Shape.SERIES));
    register(new Spec("application-by-day", "应用创建日趋势",
        "按日统计应用创建数量", "application", Shape.SERIES));
    register(new Spec("application-by-user", "各用户应用数",
        "按用户统计创建的应用数量（前 50）", "application", Shape.SERIES));
    register(new Spec("application-by-scope", "应用按归属类型分布",
        "按 scope_type 统计应用归属分布", "application", Shape.SERIES));
    register(new Spec("forge-task-by-status", "Forge 任务状态分布",
        "按任务终态统计生成任务数量", "forge", Shape.SERIES));
    register(new Spec("forge-failure-reasons", "Forge 失败原因分布",
        "按归一化失败原因统计失败任务数量", "forge", Shape.SERIES));
    register(new Spec("forge-duration-summary", "Forge 耗时摘要",
        "终态任务耗时 P50/P95 与覆盖数", "forge", Shape.RECORD));
    register(new Spec("forge-task-by-day", "Forge 任务日趋势",
        "按日统计生成任务数量", "forge", Shape.SERIES));
    register(new Spec("pipeline-step-p95", "原型阶段 P95 耗时",
        "MAIN 主链各阶段 P95 耗时", "pipeline", Shape.SERIES));
    register(new Spec("pipeline-node-by-status", "流水线节点状态分布",
        "MAIN 主链节点按状态统计", "pipeline", Shape.SERIES));
    register(new Spec("pipeline-task-outcome", "流水线任务结果",
        "原型任务完成/失败/未完成数量", "pipeline", Shape.RECORD));
    register(new Spec("feedback-operation-count", "操作反馈摘要",
        "操作记录数、有效评分数、平均评分、另存数", "feedback", Shape.RECORD));
    register(new Spec("feedback-by-action-type", "操作类型分布",
        "按 AI 操作类型统计记录数", "feedback", Shape.SERIES));
    register(new Spec("feedback-by-execute-result", "执行结果分布",
        "按 execute_result 统计组合成功/失败记录数", "feedback", Shape.SERIES));
    register(new Spec("feedback-by-rating", "评分分布",
        "按评分档位统计记录数", "feedback", Shape.SERIES));
    register(new Spec("feedback-by-day", "操作日趋势",
        "按日统计操作记录数", "feedback", Shape.SERIES));
    register(new Spec("feedback-by-user", "各用户操作数",
        "按用户统计操作记录数（前 50）", "feedback", Shape.SERIES));
  }

  /** 规划失败时的回退查询集：等价于质量总览的最小事实面。 */
  public static final List<String> DEFAULT_KEYS = List.of(
      "ai-application-count",
      "prototype-count",
      "user-count",
      "forge-task-by-status",
      "forge-failure-reasons",
      "pipeline-step-p95",
      "feedback-operation-count",
      "feedback-by-execute-result");

  private static void register(Spec spec) {
    SPECS.put(spec.key(), spec);
  }

  public static Spec require(String key) {
    Spec spec = SPECS.get(key);
    if (spec == null) {
      throw new IllegalArgumentException("EasyV 未发布的查询 key: " + key);
    }
    return SPECS.get(key);
  }

  public static boolean contains(String key) {
    return SPECS.containsKey(key);
  }

  public static List<Spec> all() {
    return List.copyOf(SPECS.values());
  }

  /** LLM 规划提示用目录描述。 */
  public static List<Map<String, String>> describeForPrompt() {
    return all().stream()
        .map(spec -> Map.of(
            "key", spec.key(),
            "label", spec.label(),
            "description", spec.description(),
            "shape", spec.shape().name().toLowerCase(java.util.Locale.ROOT)))
        .toList();
  }

  private EasyVQueryCatalog() {}
}
