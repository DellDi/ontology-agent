package com.dip3.ontologyagent.ontology;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.dip3.ontologyagent.support.JsonbTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.ResultMap;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface OntologyMapper extends BaseMapper<OntologyVersionEntity> {
    @Select("""
            select id,semver,status,published_at from platform.ontology_versions
            where status='approved' and published_at is not null
            order by published_at desc limit 1
            """)
    OntologyVersionEntity currentPublished();

    @Select("""
            select id,semver,status,published_at from platform.ontology_versions
            where id=#{versionId} and status in ('approved','deprecated') and published_at is not null
            """)
    OntologyVersionEntity publishedById(String versionId);

    @Select("select id,semver,status,published_at from platform.ontology_versions where id=#{versionId}")
    OntologyVersionEntity versionById(String versionId);

    @Select("""
            select business_key,display_name,metadata from platform.ontology_entity_definitions
            where ontology_version_id=#{versionId} and status='approved' order by business_key
            """)
    @Results(id = "ontologyDefinition", value = {
            @Result(property = "businessKey", column = "business_key"),
            @Result(property = "displayName", column = "display_name"),
            @Result(property = "metadata", column = "metadata", typeHandler = JsonbTypeHandler.class)
    })
    List<OntologyDefinitionEntity> entities(String versionId);

    @Select("""
            select business_key,display_name,
                   coalesce(metadata,'{}'::jsonb) ||
                   jsonb_build_object('applicableSubjectKeys',applicable_subject_keys,
                     'defaultAggregation',default_aggregation,'unit',unit) as metadata
            from platform.ontology_metric_definitions
            where ontology_version_id=#{versionId} and status='approved' order by business_key
            """)
    @ResultMap("ontologyDefinition")
    List<OntologyDefinitionEntity> metrics(String versionId);

    @Select("""
            select v.business_key,v.display_name,
                   coalesce(v.metadata,'{}'::jsonb) ||
                   jsonb_build_object('parentMetricDefinitionKey',d.business_key,
                     'semanticDiscriminator',v.semantic_discriminator,
                     'cubeViewMapping',v.cube_view_mapping,
                     'filterTemplate',v.filter_template) as metadata
            from platform.ontology_metric_variants v
            join platform.ontology_metric_definitions d
              on d.ontology_version_id=v.ontology_version_id and d.status='approved'
             and (d.id=v.parent_metric_definition_id or d.business_key=v.parent_metric_definition_id)
            where v.ontology_version_id=#{versionId} and v.status='approved'
            order by v.business_key
            """)
    @ResultMap("ontologyDefinition")
    List<OntologyDefinitionEntity> metricVariants(String versionId);

    @Select("""
            select business_key,display_name,metadata from platform.ontology_factor_definitions
            where ontology_version_id=#{versionId} and status='approved' order by business_key
            """)
    @ResultMap("ontologyDefinition")
    List<OntologyDefinitionEntity> factors(String versionId);

    @Select("""
            select business_key,display_name,
                   coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
                     'semanticType',semantic_type,
                     'entityDateFieldMapping',entity_date_field_mapping,
                     'cubeTimeDimensionMapping',cube_time_dimension_mapping,
                     'calculationRule',calculation_rule,
                     'defaultGranularity',default_granularity) as metadata
            from platform.ontology_time_semantics
            where ontology_version_id=#{versionId} and status='approved' order by business_key
            """)
    @ResultMap("ontologyDefinition")
    List<OntologyDefinitionEntity> timeSemantics(String versionId);

    @Select("""
            select business_key,display_name,
                   coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
                     'intentTypes',intent_types,
                     'requiredCapabilities',required_capabilities,
                     'sortOrder',sort_order) as metadata
            from platform.ontology_plan_step_templates
            where ontology_version_id=#{versionId} and status='approved'
            order by sort_order,business_key
            """)
    @ResultMap("ontologyDefinition")
    List<OntologyDefinitionEntity> planSteps(String versionId);

    @Select("""
            select b.id,b.tool_name,b.bound_step_template_key,b.bound_capability_tag,b.activation_conditions,b.priority
            from platform.ontology_tool_capability_bindings b
            where b.ontology_version_id=#{versionId} and b.status='approved'
              and (b.bound_step_template_key is not null or b.bound_capability_tag is not null)
              and (b.bound_step_template_key is null or exists (
                    select 1 from platform.ontology_plan_step_templates s
                    where s.ontology_version_id=b.ontology_version_id
                      and s.business_key=b.bound_step_template_key and s.status='approved'
              ))
            order by b.priority desc,b.id
            """)
    @Results(id = "toolBinding", value = {
            @Result(property = "toolName", column = "tool_name"),
            @Result(property = "stepTemplateKey", column = "bound_step_template_key"),
            @Result(property = "capabilityTag", column = "bound_capability_tag"),
            @Result(property = "activationConditions", column = "activation_conditions",
                    typeHandler = JsonbTypeHandler.class)
    })
    List<OntologyToolBindingEntity> toolBindings(String versionId);
}
