package com.dip3.ontologyagent.followup;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.Map;

@TableName(value = "platform.analysis_session_follow_ups", autoResultMap = true)
public class AnalysisFollowUpEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String sessionId;
    public String ownerUserId;
    public String questionText;
    public String parentFollowUpId;
    public String referencedExecutionId;
    public String referencedConclusionTitle;
    public String referencedConclusionSummary;
    public String resultExecutionId;
    public String ontologyVersionId;
    public String ontologyVersionBindingSource;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> inheritedContext;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> mergedContext;
    @TableField(insertStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.NEVER,
            updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.NEVER)
    public Long createdOrder;
    public Integer planVersion;
    @TableField(typeHandler = JsonbTypeHandler.class,
            updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.ALWAYS)
    public Map<String, Object> currentPlanSnapshot;
    @TableField(typeHandler = JsonbTypeHandler.class,
            updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.ALWAYS)
    public Map<String, Object> previousPlanSnapshot;
    @TableField(typeHandler = JsonbTypeHandler.class,
            updateStrategy = com.baomidou.mybatisplus.annotation.FieldStrategy.ALWAYS)
    public Map<String, Object> currentPlanDiff;
    public Instant createdAt;
    public Instant updatedAt;
}
