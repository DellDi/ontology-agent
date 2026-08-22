package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@TableName(value = "platform.analysis_execution_events", autoResultMap = true)
public class ExecutionEventEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String sessionId;
    public String executionId;
    public String ownerUserId;
    public Long sequence;
    public String kind;
    public Instant eventTimestamp;
    public String status;
    public String message;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public List<Map<String, Object>> renderBlocks;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> metadata;
    public String errorCode;
    public String traceId;
    public Instant createdAt;
}
