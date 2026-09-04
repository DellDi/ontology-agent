package com.dip3.ontologyagent.easyv.internal.adapter.out.llm;

import java.time.LocalDate;
import org.springframework.ai.tool.annotation.ToolParam;

/** Only published ontology keys and the server-approved date range cross the model boundary. */
public record EasyVToolInput(
    @ToolParam(description = "已发布 EasyV 本体中的实体 businessKey", required = true)
        String entityKey,
    @ToolParam(description = "已发布 EasyV 本体中的指标 businessKey", required = true)
        String metricKey,
    @ToolParam(description = "已发布 EasyV 本体中的时间语义 businessKey", required = true)
        String timeKey,
    @ToolParam(description = "服务器确定的起始日期 yyyy-MM-dd", required = true) LocalDate from,
    @ToolParam(description = "服务器确定的结束日期 yyyy-MM-dd", required = true) LocalDate to) {}
