package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.semantic.api.OntologyLink;
import com.dip3.ontologyagent.semantic.api.OntologyLink.Cardinality;
import com.dip3.ontologyagent.semantic.api.OntologyMetric;
import com.dip3.ontologyagent.semantic.api.OntologyMetric.Aggregation;
import com.dip3.ontologyagent.semantic.api.OntologyObjectType;
import com.dip3.ontologyagent.semantic.api.OntologyProperty;
import com.dip3.ontologyagent.semantic.api.OntologyProperty.Type;
import java.util.List;

/**
 * EasyV 本体对象声明：Cube 模型与后续对象/动作工具的唯一来源。
 * 口径与既有 canonical facts 冻结语义一致：应用只含未删除记录（tombstone 保留在 facts 中供复核）。
 */
public final class EasyVOntologyModel {
  private static final String TERMINAL = "lower({CUBE}.status) in ('completed','failed','cancelled')";
  private static final String TIMED_TERMINAL =
      TERMINAL + " and {CUBE}.started_at is not null and {CUBE}.finished_at is not null";
  private static final String DURATION_MS =
      "extract(epoch from ({CUBE}.finished_at - {CUBE}.started_at)) * 1000";

  public static final OntologyObjectType APPLICATION = new OntologyObjectType(
      "easyv-ai-application", "AI 应用", "用户创建的 AI 大屏应用（仅未删除）",
      "EasyvApplication", "easyv-ai-application", "facts.easyv_ai_application", "not is_deleted",
      List.of(
          OntologyProperty.key("appId", "应用 ID", "app_id"),
          OntologyProperty.column("generationTaskId", "原型生成任务 ID", "应用关联的原型流水线任务",
              Type.STRING, "generation_task_id"),
          new OntologyProperty("userId", "创建用户 ID", "创建应用的用户", Type.STRING, "{CUBE}.user_id::text", false),
          new OntologyProperty("spaceId", "空间 ID", "应用所属空间", Type.STRING, "{CUBE}.space_id::text", false),
          OntologyProperty.column("scopeType", "归属类型", "应用归属范围（USER 等）", Type.STRING, "scope_type"),
          OntologyProperty.column("createdAt", "应用创建时间", "应用创建时间（上海时区）", Type.TIME, "created_at")),
      List.of(),
      List.of(
          new OntologyMetric("count", "AI 应用数", "去重应用数", Aggregation.COUNT_DISTINCT, "{CUBE}.app_id", null),
          new OntologyMetric("userCount", "创建用户数", "创建过应用的去重用户数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.user_id", null)));

  public static final OntologyObjectType FORGE_TASK = new OntologyObjectType(
      "easyv-forge-task", "应用生成任务", "Forge 生成任务（每次生成一条）",
      "EasyvForgeTask", "easyv-forge-task", "facts.easyv_forge_generation_task", null,
      List.of(
          OntologyProperty.key("taskId", "生成任务 ID", "task_id"),
          OntologyProperty.column("appId", "应用 ID", "任务所属应用", Type.STRING, "app_id"),
          OntologyProperty.column("status", "任务状态", "completed / failed / cancelled / 进行中", Type.STRING, "status"),
          new OntologyProperty("failureReason", "失败原因", "归一化失败原因；无记录时为“（无失败原因记录）”",
              Type.STRING, "coalesce(nullif({CUBE}.failure_reason, ''), '（无失败原因记录）')", false),
          OntologyProperty.column("createdAt", "任务创建时间", "任务创建时间（上海时区）", Type.TIME, "created_at"),
          OntologyProperty.column("startedAt", "开始时间", "任务开始执行时间", Type.TIME, "started_at"),
          OntologyProperty.column("finishedAt", "结束时间", "任务结束时间", Type.TIME, "finished_at")),
      List.of(new OntologyLink("application", APPLICATION.key(), "appId", "appId", Cardinality.MANY_TO_ONE)),
      List.of(
          new OntologyMetric("count", "生成任务数", "去重生成任务数", Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", null),
          new OntologyMetric("failedCount", "失败任务数", "状态为 failed 的任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", "lower({CUBE}.status) = 'failed'"),
          new OntologyMetric("terminalCount", "终态任务数", "completed/failed/cancelled 任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", TERMINAL),
          new OntologyMetric("timedTerminalCount", "可计时终态任务数", "有开始与结束时间的终态任务数",
              Aggregation.COUNT_DISTINCT, "{CUBE}.task_id", TIMED_TERMINAL),
          new OntologyMetric("durationP50Ms", "耗时 P50（毫秒）", "终态任务耗时中位数",
              Aggregation.PERCENTILE_50, DURATION_MS, TIMED_TERMINAL),
          new OntologyMetric("durationP95Ms", "耗时 P95（毫秒）", "终态任务耗时 P95",
              Aggregation.PERCENTILE_95, DURATION_MS, TIMED_TERMINAL)));

  public static final List<OntologyObjectType> OBJECTS = List.of(APPLICATION, FORGE_TASK);

  private EasyVOntologyModel() {}
}
