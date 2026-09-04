package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@TableName(value = "platform.analysis_execution_snapshots", autoResultMap = true)
public class ExecutionSnapshotEntity {
    @TableId(value = "execution_id", type = IdType.INPUT)
    public String executionId;
    public String sessionId;
    public String ownerUserId;
    public String followUpId;
    public String ontologyVersionId;
    public String ontologyVersionBindingSource;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> capabilityBinding;
    public String status;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> planSnapshot;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public List<Map<String, Object>> stepResults;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> conclusionState;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public List<Map<String, Object>> resultBlocks;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> mobileProjection;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> failurePoint;
    public String errorCode;
    public String traceId;
    public Instant createdAt;
    public Instant updatedAt;
}
