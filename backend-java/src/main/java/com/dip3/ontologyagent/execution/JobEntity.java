package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.Map;

@TableName(value = "platform.jobs", autoResultMap = true)
public class JobEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String type;
    public String status;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> payload;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> result;
    public String error;
    public Integer attemptCount;
    public Integer maxAttempts;
    public Instant availableAt;
    public String lockedBy;
    public Instant lockedUntil;
    public String redisStreamEntryId;
    public String dispatchStatus;
    public String ownerUserId;
    public String organizationId;
    public String sessionId;
    public String datasetVersionSetId;
    public String originCorrelationId;
    public Instant createdAt;
    public Instant updatedAt;
    public Instant startedAt;
    public Instant completedAt;
    public Instant failedAt;
}
