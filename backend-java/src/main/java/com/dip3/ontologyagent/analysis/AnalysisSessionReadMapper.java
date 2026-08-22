package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.support.JsonbTypeHandler;
import com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Mapper
public interface AnalysisSessionReadMapper {
    @Select("""
            select id,organization_id,project_ids,area_ids,question_text,saved_context,status,created_at,updated_at
            from platform.analysis_sessions
            where id=#{sessionId} and owner_user_id=#{ownerUserId} and organization_id=#{organizationId}
              and project_ids <@ #{projectIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler}
              and area_ids <@ #{areaIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler}
            """)
    @Results({
            @Result(property = "organizationId", column = "organization_id"),
            @Result(property = "projectIds", column = "project_ids", typeHandler = PostgresTextArrayTypeHandler.class),
            @Result(property = "areaIds", column = "area_ids", typeHandler = PostgresTextArrayTypeHandler.class),
            @Result(property = "questionText", column = "question_text"),
            @Result(property = "savedContext", column = "saved_context", typeHandler = JsonbTypeHandler.class),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at")
    })
    SessionRow findSession(@Param("sessionId") String sessionId,
                           @Param("ownerUserId") String ownerUserId,
                           @Param("organizationId") String organizationId,
                           @Param("projectIds") String[] projectIds,
                           @Param("areaIds") String[] areaIds);

    @Select("""
            <script>
            with execution_facts as (
              select j.id as execution_id,j.created_at as fact_created_at
              from platform.jobs j
              where j.type='analysis-execution' and j.session_id=#{sessionId} and j.owner_user_id=#{ownerUserId}
                and j.organization_id=#{organizationId}
                and j.payload->>'executionContract' in ('java-initial-v1','java-follow-up-v1')
              union all
              select s.execution_id,s.created_at
              from platform.analysis_execution_snapshots s
              where s.session_id=#{sessionId} and s.owner_user_id=#{ownerUserId}
                and s.plan_snapshot->>'_executionContract' in ('java-initial-v1','java-follow-up-v1')
                and not exists (
                  select 1 from platform.jobs j
                  where j.id=s.execution_id and j.session_id=s.session_id and j.owner_user_id=s.owner_user_id
                    and j.organization_id=#{organizationId}
                    and j.payload->>'executionContract'=s.plan_snapshot->>'_executionContract'
                )
            ), selected_execution as (
              select execution_id from execution_facts
              <if test="executionId != null">
                where execution_id=#{executionId}
              </if>
              order by fact_created_at desc,execution_id desc
              limit 1
            )
            select selected.execution_id as resolved_execution_id,
                   j.status as job_status,j.result as job_result,j.error as job_error,
                   j.attempt_count,j.max_attempts,j.dispatch_status,
                   j.origin_correlation_id as job_trace_id,j.created_at as job_created_at,
                   j.updated_at as job_updated_at,j.started_at,j.completed_at,j.failed_at,
                   s.follow_up_id,s.ontology_version_id,s.ontology_version_binding_source,
                   s.status as snapshot_status,s.plan_snapshot,s.step_results,s.conclusion_state,
                   s.result_blocks,s.mobile_projection,s.failure_point,s.error_code as snapshot_error_code,
                   s.trace_id as snapshot_trace_id,s.created_at as snapshot_created_at,
                   s.updated_at as snapshot_updated_at
            from selected_execution selected
            left join platform.jobs j
                  on j.id=selected.execution_id and j.type='analysis-execution'
                  and j.session_id=#{sessionId} and j.owner_user_id=#{ownerUserId}
                  and j.organization_id=#{organizationId}
                  and j.payload->>'executionContract' in ('java-initial-v1','java-follow-up-v1')
            left join platform.analysis_execution_snapshots s
                   on s.execution_id=selected.execution_id
                  and s.session_id=#{sessionId} and s.owner_user_id=#{ownerUserId}
                  and s.plan_snapshot->>'_executionContract' in ('java-initial-v1','java-follow-up-v1')
            </script>
            """)
    @Results({
            @Result(property = "resolvedExecutionId", column = "resolved_execution_id"),
            @Result(property = "jobStatus", column = "job_status"),
            @Result(property = "jobResult", column = "job_result", typeHandler = JsonbTypeHandler.class),
            @Result(property = "jobError", column = "job_error"),
            @Result(property = "attemptCount", column = "attempt_count"),
            @Result(property = "maxAttempts", column = "max_attempts"),
            @Result(property = "dispatchStatus", column = "dispatch_status"),
            @Result(property = "jobTraceId", column = "job_trace_id"),
            @Result(property = "jobCreatedAt", column = "job_created_at"),
            @Result(property = "jobUpdatedAt", column = "job_updated_at"),
            @Result(property = "startedAt", column = "started_at"),
            @Result(property = "completedAt", column = "completed_at"),
            @Result(property = "failedAt", column = "failed_at"),
            @Result(property = "followUpId", column = "follow_up_id"),
            @Result(property = "ontologyVersionId", column = "ontology_version_id"),
            @Result(property = "ontologyVersionBindingSource", column = "ontology_version_binding_source"),
            @Result(property = "snapshotStatus", column = "snapshot_status"),
            @Result(property = "planSnapshot", column = "plan_snapshot", typeHandler = JsonbTypeHandler.class),
            @Result(property = "stepResults", column = "step_results", typeHandler = JsonbTypeHandler.class),
            @Result(property = "conclusionState", column = "conclusion_state", typeHandler = JsonbTypeHandler.class),
            @Result(property = "resultBlocks", column = "result_blocks", typeHandler = JsonbTypeHandler.class),
            @Result(property = "mobileProjection", column = "mobile_projection", typeHandler = JsonbTypeHandler.class),
            @Result(property = "failurePoint", column = "failure_point", typeHandler = JsonbTypeHandler.class),
            @Result(property = "snapshotErrorCode", column = "snapshot_error_code"),
            @Result(property = "snapshotTraceId", column = "snapshot_trace_id"),
            @Result(property = "snapshotCreatedAt", column = "snapshot_created_at"),
            @Result(property = "snapshotUpdatedAt", column = "snapshot_updated_at")
    })
    ExecutionRow findExecution(@Param("sessionId") String sessionId,
                               @Param("ownerUserId") String ownerUserId,
                               @Param("organizationId") String organizationId,
                               @Param("executionId") String executionId);

    @Select("""
            select s.execution_id,s.status,s.ontology_version_id,s.ontology_version_binding_source,
                   s.plan_snapshot,s.conclusion_state,s.created_at
            from platform.analysis_execution_snapshots s
            where s.session_id=#{sessionId} and s.owner_user_id=#{ownerUserId}
              and s.follow_up_id is null
              and s.plan_snapshot->>'_executionContract'='java-initial-v1'
            order by s.created_at desc,s.execution_id desc
            limit 1
            """)
    @Results({
            @Result(property = "executionId", column = "execution_id"),
            @Result(property = "ontologyVersionId", column = "ontology_version_id"),
            @Result(property = "ontologyVersionBindingSource", column = "ontology_version_binding_source"),
            @Result(property = "planSnapshot", column = "plan_snapshot", typeHandler = JsonbTypeHandler.class),
            @Result(property = "conclusionState", column = "conclusion_state", typeHandler = JsonbTypeHandler.class),
            @Result(property = "createdAt", column = "created_at")
    })
    HistoryRow findRootHistory(@Param("sessionId") String sessionId, @Param("ownerUserId") String ownerUserId);

    @Select("""
            select f.id,f.question_text,f.id as follow_up_id,f.result_execution_id as execution_id,
                   coalesce(s.status,j.status) as status,
                   coalesce(s.ontology_version_id,f.ontology_version_id) as ontology_version_id,
                   coalesce(s.ontology_version_binding_source,f.ontology_version_binding_source)
                     as ontology_version_binding_source,
                   s.plan_snapshot,s.conclusion_state,f.created_at
            from platform.analysis_session_follow_ups f
            left join platform.analysis_execution_snapshots s
              on s.execution_id=f.result_execution_id and s.session_id=f.session_id
             and s.owner_user_id=f.owner_user_id and s.follow_up_id=f.id
             and s.plan_snapshot->>'_executionContract'='java-follow-up-v1'
            left join platform.jobs j
              on j.id=f.result_execution_id and j.session_id=f.session_id
             and j.owner_user_id=f.owner_user_id
             and j.payload->>'executionContract'='java-follow-up-v1'
             and j.payload->>'followUpId'=f.id
            where f.session_id=#{sessionId} and f.owner_user_id=#{ownerUserId}
            order by f.created_order,f.created_at,f.id
            """)
    @Results({
            @Result(property = "questionText", column = "question_text"),
            @Result(property = "followUpId", column = "follow_up_id"),
            @Result(property = "executionId", column = "execution_id"),
            @Result(property = "ontologyVersionId", column = "ontology_version_id"),
            @Result(property = "ontologyVersionBindingSource", column = "ontology_version_binding_source"),
            @Result(property = "planSnapshot", column = "plan_snapshot", typeHandler = JsonbTypeHandler.class),
            @Result(property = "conclusionState", column = "conclusion_state", typeHandler = JsonbTypeHandler.class),
            @Result(property = "createdAt", column = "created_at")
    })
    List<HistoryRow> listFollowUpHistory(@Param("sessionId") String sessionId,
                                         @Param("ownerUserId") String ownerUserId);

    @Select("""
            select id,session_id,execution_id,sequence,kind,event_timestamp,status,message,
                   render_blocks,metadata,error_code,trace_id
            from platform.analysis_execution_events
            where session_id=#{sessionId} and execution_id=#{executionId} and owner_user_id=#{ownerUserId}
            order by sequence
            """)
    @Results({
            @Result(property = "sessionId", column = "session_id"),
            @Result(property = "executionId", column = "execution_id"),
            @Result(property = "timestamp", column = "event_timestamp"),
            @Result(property = "renderBlocks", column = "render_blocks", typeHandler = JsonbTypeHandler.class),
            @Result(property = "metadata", column = "metadata", typeHandler = JsonbTypeHandler.class),
            @Result(property = "errorCode", column = "error_code"),
            @Result(property = "traceId", column = "trace_id")
    })
    List<EventRow> listEvents(@Param("sessionId") String sessionId,
                              @Param("executionId") String executionId,
                              @Param("ownerUserId") String ownerUserId);

    final class SessionRow {
        public String id;
        public String organizationId;
        public String[] projectIds;
        public String[] areaIds;
        public String questionText;
        public Map<String, Object> savedContext;
        public String status;
        public Instant createdAt;
        public Instant updatedAt;
    }

    final class ExecutionRow {
        public String resolvedExecutionId;
        public String jobStatus;
        public Map<String, Object> jobResult;
        public String jobError;
        public Integer attemptCount;
        public Integer maxAttempts;
        public String dispatchStatus;
        public String jobTraceId;
        public Instant jobCreatedAt;
        public Instant jobUpdatedAt;
        public Instant startedAt;
        public Instant completedAt;
        public Instant failedAt;
        public String followUpId;
        public String ontologyVersionId;
        public String ontologyVersionBindingSource;
        public String snapshotStatus;
        public Map<String, Object> planSnapshot;
        public List<Map<String, Object>> stepResults;
        public Map<String, Object> conclusionState;
        public List<Map<String, Object>> resultBlocks;
        public Map<String, Object> mobileProjection;
        public Map<String, Object> failurePoint;
        public String snapshotErrorCode;
        public String snapshotTraceId;
        public Instant snapshotCreatedAt;
        public Instant snapshotUpdatedAt;
    }

    final class EventRow {
        public String id;
        public String sessionId;
        public String executionId;
        public Long sequence;
        public String kind;
        public Instant timestamp;
        public String status;
        public String message;
        public List<Map<String, Object>> renderBlocks;
        public Map<String, Object> metadata;
        public String errorCode;
        public String traceId;
    }

    final class HistoryRow {
        public String id;
        public String questionText;
        public String followUpId;
        public String executionId;
        public String status;
        public String ontologyVersionId;
        public String ontologyVersionBindingSource;
        public Map<String, Object> planSnapshot;
        public Map<String, Object> conclusionState;
        public Instant createdAt;
    }
}
