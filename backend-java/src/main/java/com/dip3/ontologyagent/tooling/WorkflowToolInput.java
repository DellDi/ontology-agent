package com.dip3.ontologyagent.tooling;

import org.springframework.ai.tool.annotation.ToolParam;

import java.time.LocalDate;
import java.util.List;

public record WorkflowToolInput(
        @ToolParam(description = "当前已发布本体中的实体 businessKey", required = true) String entityKey,
        @ToolParam(description = "当前已发布本体中的父指标 businessKey", required = true) String metricDefinitionKey,
        @ToolParam(description = "父指标下当前可执行口径 variant businessKey", required = true) String metricVariantKey,
        @ToolParam(description = "当前已发布本体中的时间语义 businessKey", required = true) String timeSemanticKey,
        @ToolParam(description = "本次分析的授权项目 ID 子集；空数组表示完整授权范围", required = true)
        List<String> projectIds,
        @ToolParam(description = "分析起始日期，ISO-8601 yyyy-MM-dd", required = true) LocalDate from,
        @ToolParam(description = "分析结束日期，ISO-8601 yyyy-MM-dd", required = true) LocalDate to) {}
