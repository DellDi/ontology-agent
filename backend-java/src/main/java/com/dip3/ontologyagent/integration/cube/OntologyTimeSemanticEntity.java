package com.dip3.ontologyagent.integration.cube;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.Map;

@TableName(value = "platform.ontology_time_semantics", autoResultMap = true)
public class OntologyTimeSemanticEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String ontologyVersionId;
    public String businessKey;
    public String status;
    public String semanticType;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> entityDateFieldMapping;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> cubeTimeDimensionMapping;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> calculationRule;
    public String defaultGranularity;
    public Instant updatedAt;
}
