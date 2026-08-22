package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.Map;

@TableName(value = "platform.agent_invocations", autoResultMap = true)
public class AgentInvocationEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String sessionId;
    public String executionId;
    public String ownerUserId;
    public String agentName;
    public String toolName;
    public String kind;
    public String parentInvocationId;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> input;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> output;
    public String status;
    public String errorCode;
    public String errorMessage;
    public String traceId;
    public Instant startedAt;
    public Instant completedAt;
    public Instant createdAt;
    public Instant updatedAt;
}
