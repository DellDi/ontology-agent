package com.dip3.ontologyagent.analysis;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;
import com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler;

import java.time.Instant;
import java.util.Map;

@TableName(value = "platform.analysis_sessions", autoResultMap = true)
public class AnalysisSessionEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String ownerUserId;
    public String organizationId;
    @TableField(typeHandler = PostgresTextArrayTypeHandler.class)
    public String[] projectIds;
    @TableField(typeHandler = PostgresTextArrayTypeHandler.class)
    public String[] areaIds;
    public String questionText;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> savedContext;
    public String status;
    public Instant createdAt;
    public Instant updatedAt;
}
