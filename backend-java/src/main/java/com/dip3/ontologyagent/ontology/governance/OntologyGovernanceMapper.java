package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.support.JsonbTypeHandler;
import com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.ResultMap;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Mapper
public interface OntologyGovernanceMapper {
    String VERSION_COLUMNS = "id,semver,display_name,status,description,published_at,deprecated_at,retired_at,created_by,created_at,updated_at";
    String CHANGE_COLUMNS = "id,ontology_version_id,target_object_type,target_object_key,change_type,status,title,description,before_summary,after_summary,impact_scope,compatibility_type,compatibility_note,submitted_by,submitted_at,created_at,updated_at";
    String PUBLISH_COLUMNS = "id,ontology_version_id,published_by,previous_version_id,change_request_ids,publish_note,created_at";

    @Select("select pg_try_advisory_xact_lock(hashtextextended('ontology-governance-publish',0))")
    boolean tryLockPublish();

    @Select("select " + VERSION_COLUMNS + " from platform.ontology_versions where id=#{id}")
    @Results(id = "version", value = {
            @Result(property = "displayName", column = "display_name"),
            @Result(property = "publishedAt", column = "published_at"),
            @Result(property = "deprecatedAt", column = "deprecated_at"),
            @Result(property = "retiredAt", column = "retired_at"),
            @Result(property = "createdBy", column = "created_by"),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at")
    })
    GovernanceRows.VersionRow findVersion(String id);

    @Select("select " + VERSION_COLUMNS + " from platform.ontology_versions where id=#{id} for update")
    @ResultMap("version")
    GovernanceRows.VersionRow lockVersion(String id);

    @Select("select " + VERSION_COLUMNS + " from platform.ontology_versions order by created_at desc,id desc limit #{limit}")
    @ResultMap("version")
    List<GovernanceRows.VersionRow> listVersions(int limit);

    @Select("select " + VERSION_COLUMNS + " from platform.ontology_versions order by id for update")
    @ResultMap("version")
    List<GovernanceRows.VersionRow> lockAllVersions();

    @Select("""
            select 'entities' category,id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('synonyms',to_jsonb(synonyms),'parentBusinessKey',parent_business_key,'metadata',metadata) fields,
              created_at,updated_at
            from platform.ontology_entity_definitions where ontology_version_id=#{versionId}
            union all
            select 'metrics',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('applicableSubjectKeys',to_jsonb(applicable_subject_keys),'defaultAggregation',default_aggregation,'unit',unit,'metadata',metadata),
              created_at,updated_at
            from platform.ontology_metric_definitions where ontology_version_id=#{versionId}
            union all
            select 'metricVariants',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('parentMetricDefinitionId',parent_metric_definition_id,'semanticDiscriminator',semantic_discriminator,
                'cubeViewMapping',cube_view_mapping,'filterTemplate',filter_template,'metadata',metadata),
              created_at,updated_at
            from platform.ontology_metric_variants where ontology_version_id=#{versionId}
            union all
            select 'factors',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('category',category,'relatedMetricKeys',to_jsonb(related_metric_keys),'metadata',metadata),
              created_at,updated_at
            from platform.ontology_factor_definitions where ontology_version_id=#{versionId}
            union all
            select 'causalityEdges',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('sourceEntityKey',source_entity_key,'targetEntityKey',target_entity_key,'causalityType',causality_type,
                'isAttributionPathEnabled',is_attribution_path_enabled,'defaultWeight',default_weight,
                'neo4jRelationshipTypes',to_jsonb(neo4j_relationship_types),'temporalConstraints',temporal_constraints,
                'filterConditions',filter_conditions,'metadata',metadata),
              created_at,updated_at
            from platform.ontology_causality_edges where ontology_version_id=#{versionId}
            union all
            select 'planStepTemplates',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('intentTypes',to_jsonb(intent_types),'requiredCapabilities',to_jsonb(required_capabilities),
                'sortOrder',sort_order,'metadata',metadata),
              created_at,updated_at
            from platform.ontology_plan_step_templates where ontology_version_id=#{versionId}
            union all
            select 'toolBindings',id,ontology_version_id,tool_name,tool_name,description,status,
              jsonb_build_object('boundStepTemplateKey',bound_step_template_key,'boundCapabilityTag',bound_capability_tag,
                'toolName',tool_name,'activationConditions',activation_conditions,'priority',priority,'createdBy',created_by),
              created_at::timestamptz,updated_at::timestamptz
            from platform.ontology_tool_capability_bindings where ontology_version_id=#{versionId}
            union all
            select 'timeSemantics',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('semanticType',semantic_type,'entityDateFieldMapping',entity_date_field_mapping,
                'cubeTimeDimensionMapping',cube_time_dimension_mapping,'calculationRule',calculation_rule,
                'defaultGranularity',default_granularity,'metadata',metadata),
              created_at,updated_at
            from platform.ontology_time_semantics where ontology_version_id=#{versionId}
            union all
            select 'evidenceTypes',id,ontology_version_id,business_key,display_name,description,status,
              jsonb_build_object('evidenceCategory',evidence_category,'rendererConfig',renderer_config,
                'dataSourceConfig',data_source_config,'defaultPriority',default_priority,'isInteractive',is_interactive,
                'templateSchema',template_schema,'validationRules',validation_rules,'metadata',metadata),
              created_at,updated_at
            from platform.ontology_evidence_type_definitions where ontology_version_id=#{versionId}
            order by category,business_key,id
            """)
    @Results(id = "definition", value = {
            @Result(property = "ontologyVersionId", column = "ontology_version_id"),
            @Result(property = "businessKey", column = "business_key"),
            @Result(property = "displayName", column = "display_name"),
            @Result(property = "fields", column = "fields", typeHandler = JsonbTypeHandler.class),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at")
    })
    List<GovernanceRows.DefinitionRow> listDefinitions(String versionId);

    @Select("""
            with category_counts(category,total) as (
              select 'entity_definition',count(*) from platform.ontology_entity_definitions where ontology_version_id=#{versionId} and status='approved'
              union all select 'metric_definition',count(*) from platform.ontology_metric_definitions where ontology_version_id=#{versionId} and status='approved'
              union all select 'metric_variant',count(*) from platform.ontology_metric_variants where ontology_version_id=#{versionId} and status='approved'
              union all select 'factor_definition',count(*) from platform.ontology_factor_definitions where ontology_version_id=#{versionId} and status='approved'
              union all select 'causality_edge',count(*) from platform.ontology_causality_edges where ontology_version_id=#{versionId} and status='approved'
              union all select 'plan_step_template',count(*) from platform.ontology_plan_step_templates where ontology_version_id=#{versionId} and status='approved'
              union all select 'tool_capability_binding',count(*) from platform.ontology_tool_capability_bindings where ontology_version_id=#{versionId} and status='approved'
              union all select 'time_semantic',count(*) from platform.ontology_time_semantics where ontology_version_id=#{versionId} and status='approved'
              union all select 'evidence_type_definition',count(*) from platform.ontology_evidence_type_definitions where ontology_version_id=#{versionId} and status='approved'
            ), issues(issue) as (
              select 'missing:' || category from category_counts where total=0
              union all
              select 'orphan:metric_variant:' || v.business_key
              from platform.ontology_metric_variants v
              where v.ontology_version_id=#{versionId} and v.status='approved' and not exists (
                select 1 from platform.ontology_metric_definitions d
                where d.ontology_version_id=v.ontology_version_id and d.status='approved'
                  and (d.id=v.parent_metric_definition_id or d.business_key=v.parent_metric_definition_id))
              union all
              select 'invalid:tool_binding:' || b.id
              from platform.ontology_tool_capability_bindings b
              where b.ontology_version_id=#{versionId} and b.status='approved' and (
                (b.bound_step_template_key is null and b.bound_capability_tag is null) or
                (b.bound_step_template_key is not null and not exists (
                  select 1 from platform.ontology_plan_step_templates s
                  where s.ontology_version_id=b.ontology_version_id and s.status='approved'
                    and s.business_key=b.bound_step_template_key)))
              union all
              select 'duplicate:' || category || ':' || business_key from (
                select 'entity_definition' category,business_key from platform.ontology_entity_definitions where ontology_version_id=#{versionId} and status='approved'
                union all select 'metric_definition',business_key from platform.ontology_metric_definitions where ontology_version_id=#{versionId} and status='approved'
                union all select 'metric_variant',business_key from platform.ontology_metric_variants where ontology_version_id=#{versionId} and status='approved'
                union all select 'factor_definition',business_key from platform.ontology_factor_definitions where ontology_version_id=#{versionId} and status='approved'
                union all select 'causality_edge',business_key from platform.ontology_causality_edges where ontology_version_id=#{versionId} and status='approved'
                union all select 'plan_step_template',business_key from platform.ontology_plan_step_templates where ontology_version_id=#{versionId} and status='approved'
                union all select 'time_semantic',business_key from platform.ontology_time_semantics where ontology_version_id=#{versionId} and status='approved'
                union all select 'evidence_type_definition',business_key from platform.ontology_evidence_type_definitions where ontology_version_id=#{versionId} and status='approved'
              ) definitions group by category,business_key having count(*) > 1
            ) select issue from issues order by issue
            """)
    List<String> publishIntegrityIssues(String versionId);

    @Insert("""
            insert into platform.ontology_change_requests
            (id,ontology_version_id,target_object_type,target_object_key,change_type,status,title,description,
             before_summary,after_summary,impact_scope,compatibility_type,compatibility_note,submitted_by,
             submitted_at,created_at,updated_at)
            values (#{row.id},#{row.ontologyVersionId},#{row.targetObjectType},#{row.targetObjectKey},
             #{row.changeType},#{row.status},#{row.title},#{row.description},
             #{row.beforeSummary,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
             #{row.afterSummary,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
             #{row.impactScope,jdbcType=ARRAY,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler},
             #{row.compatibilityType},#{row.compatibilityNote},#{row.submittedBy},#{row.submittedAt},
             #{row.createdAt},#{row.updatedAt})
            """)
    int insertChangeRequest(@Param("row") GovernanceRows.ChangeRequestRow row);

    @Select("select " + CHANGE_COLUMNS + " from platform.ontology_change_requests where id=#{id}")
    @Results(id = "changeRequest", value = {
            @Result(property = "ontologyVersionId", column = "ontology_version_id"),
            @Result(property = "targetObjectType", column = "target_object_type"),
            @Result(property = "targetObjectKey", column = "target_object_key"),
            @Result(property = "changeType", column = "change_type"),
            @Result(property = "beforeSummary", column = "before_summary", typeHandler = JsonbTypeHandler.class),
            @Result(property = "afterSummary", column = "after_summary", typeHandler = JsonbTypeHandler.class),
            @Result(property = "impactScope", column = "impact_scope", typeHandler = PostgresTextArrayTypeHandler.class),
            @Result(property = "compatibilityType", column = "compatibility_type"),
            @Result(property = "compatibilityNote", column = "compatibility_note"),
            @Result(property = "submittedBy", column = "submitted_by"),
            @Result(property = "submittedAt", column = "submitted_at"),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at")
    })
    GovernanceRows.ChangeRequestRow findChangeRequest(String id);

    @Select("select " + CHANGE_COLUMNS + " from platform.ontology_change_requests where id=#{id} for update")
    @ResultMap("changeRequest")
    GovernanceRows.ChangeRequestRow lockChangeRequest(String id);

    @Select("select " + CHANGE_COLUMNS + " from platform.ontology_change_requests order by created_at desc,id desc limit #{limit}")
    @ResultMap("changeRequest")
    List<GovernanceRows.ChangeRequestRow> listChangeRequests(int limit);

    @Select("select " + CHANGE_COLUMNS + " from platform.ontology_change_requests where status=#{status} order by created_at desc,id desc limit #{limit}")
    @ResultMap("changeRequest")
    List<GovernanceRows.ChangeRequestRow> listChangeRequestsByStatus(@Param("status") String status,
                                                                     @Param("limit") int limit);

    @Select("select " + CHANGE_COLUMNS + " from platform.ontology_change_requests where ontology_version_id=#{versionId} order by id for update")
    @ResultMap("changeRequest")
    List<GovernanceRows.ChangeRequestRow> lockChangeRequestsForVersion(String versionId);

    @Update("""
            update platform.ontology_change_requests
            set status=#{next},submitted_at=coalesce(#{submittedAt},submitted_at),updated_at=#{now}
            where id=#{id} and status=#{expected}
            """)
    int transitionChangeRequest(@Param("id") String id, @Param("expected") String expected,
                                @Param("next") String next, @Param("submittedAt") Instant submittedAt,
                                @Param("now") Instant now);

    @Insert("""
            insert into platform.ontology_approval_records
            (id,change_request_id,decision,reviewed_by,comment,created_at)
            values (#{row.id},#{row.changeRequestId},#{row.decision},#{row.reviewedBy},#{row.comment},#{row.createdAt})
            """)
    int insertApproval(@Param("row") GovernanceRows.ApprovalRow row);

    @Select("select id,change_request_id,decision,reviewed_by,comment,created_at from platform.ontology_approval_records where change_request_id=#{id} order by created_at,id")
    @Results(id = "approval", value = {
            @Result(property = "changeRequestId", column = "change_request_id"),
            @Result(property = "reviewedBy", column = "reviewed_by"),
            @Result(property = "createdAt", column = "created_at")
    })
    List<GovernanceRows.ApprovalRow> listApprovals(String id);

    @Update("update platform.ontology_versions set published_at=#{now},updated_at=#{now} where id=#{id} and status='approved' and published_at is null")
    int publishVersion(@Param("id") String id, @Param("now") Instant now);

    @Update("update platform.ontology_versions set status='deprecated',deprecated_at=#{now},updated_at=#{now} where id=#{id} and status='approved' and published_at is not null")
    int deprecateVersion(@Param("id") String id, @Param("now") Instant now);

    @Insert("""
            insert into platform.ontology_publish_records
            (id,ontology_version_id,published_by,previous_version_id,change_request_ids,publish_note,created_at)
            values (#{row.id},#{row.ontologyVersionId},#{row.publishedBy},#{row.previousVersionId},
             #{row.changeRequestIds,jdbcType=ARRAY,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler},
             #{row.publishNote},#{row.createdAt})
            """)
    int insertPublish(@Param("row") GovernanceRows.PublishRow row);

    @Select("select " + PUBLISH_COLUMNS + " from platform.ontology_publish_records order by created_at desc,id desc limit #{limit}")
    @Results(id = "publish", value = {
            @Result(property = "ontologyVersionId", column = "ontology_version_id"),
            @Result(property = "publishedBy", column = "published_by"),
            @Result(property = "previousVersionId", column = "previous_version_id"),
            @Result(property = "changeRequestIds", column = "change_request_ids", typeHandler = PostgresTextArrayTypeHandler.class),
            @Result(property = "publishNote", column = "publish_note"),
            @Result(property = "createdAt", column = "created_at")
    })
    List<GovernanceRows.PublishRow> listPublishes(int limit);

    @Select("select count(*) from platform.ontology_change_requests where status=#{status}")
    long countChangeRequests(String status);

    @Insert("""
            insert into platform.audit_events
            (id,user_id,organization_id,session_id,event_type,event_result,event_source,correlation_id,payload,created_at,retention_until)
            values (#{id},#{actor.userId},#{actor.organizationId},#{actor.sessionId},#{eventType},'succeeded',
             'application',#{correlationId},#{payload,jdbcType=OTHER,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
             #{createdAt},#{retentionUntil})
            """)
    int insertAudit(@Param("id") String id, @Param("actor") GovernanceAuditActor actor,
                    @Param("eventType") String eventType, @Param("correlationId") String correlationId,
                    @Param("payload") Map<String, Object> payload, @Param("createdAt") Instant createdAt,
                    @Param("retentionUntil") Instant retentionUntil);

    record GovernanceAuditActor(String userId, String organizationId, String sessionId) {}
}
