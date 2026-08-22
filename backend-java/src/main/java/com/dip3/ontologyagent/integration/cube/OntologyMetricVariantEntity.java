package com.dip3.ontologyagent.integration.cube;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.dip3.ontologyagent.support.JsonbTypeHandler;

import java.time.Instant;
import java.util.Map;

@TableName(value = "platform.ontology_metric_variants", autoResultMap = true)
public class OntologyMetricVariantEntity {
    @TableId(type = IdType.INPUT)
    public String id;
    public String ontologyVersionId;
    public String parentMetricDefinitionId;
    public String businessKey;
    public String status;
    public String semanticDiscriminator;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> cubeViewMapping;
    @TableField(typeHandler = JsonbTypeHandler.class)
    public Map<String, Object> filterTemplate;
    public Instant updatedAt;
}
