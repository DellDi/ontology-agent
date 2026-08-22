package com.dip3.ontologyagent.workspace;

import com.dip3.ontologyagent.support.JsonbTypeHandler;
import com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.ResultMap;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Mapper
public interface WorkspaceHomeMapper {
    @Select("""
            select id,owner_user_id,organization_id,project_ids,area_ids,question_text,saved_context,
                   status,created_at,updated_at
            from platform.analysis_sessions
            where owner_user_id=#{ownerUserId} and organization_id=#{organizationId}
              and project_ids <@ #{projectIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler}
              and area_ids <@ #{areaIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler}
            order by updated_at desc,id
            """)
    @Results({
            @Result(property = "ownerUserId", column = "owner_user_id"),
            @Result(property = "organizationId", column = "organization_id"),
            @Result(property = "projectIds", column = "project_ids", typeHandler = PostgresTextArrayTypeHandler.class),
            @Result(property = "areaIds", column = "area_ids", typeHandler = PostgresTextArrayTypeHandler.class),
            @Result(property = "questionText", column = "question_text"),
            @Result(property = "savedContext", column = "saved_context", typeHandler = JsonbTypeHandler.class),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at")
    })
    List<SessionRow> listSessions(@Param("ownerUserId") String ownerUserId,
                                  @Param("organizationId") String organizationId,
                                  @Param("projectIds") String[] projectIds,
                                  @Param("areaIds") String[] areaIds);

    @Select("""
            <script>
            with candidates as (
              select j.session_id,j.id as execution_id,j.created_at as fact_created_at
              from platform.jobs j
              where j.type='analysis-execution' and j.owner_user_id=#{ownerUserId}
                and j.organization_id=#{organizationId}
                and j.payload->>'executionContract'='java-initial-v1'
                and j.session_id in
                <foreach collection="sessionIds" item="sessionId" open="(" separator="," close=")">
                  #{sessionId}
                </foreach>
              union all
              select s.session_id,s.execution_id,s.created_at
              from platform.analysis_execution_snapshots s
              where s.owner_user_id=#{ownerUserId} and s.session_id in
                <foreach collection="sessionIds" item="sessionId" open="(" separator="," close=")">
                  #{sessionId}
                </foreach>
                and s.follow_up_id is null
                and s.plan_snapshot->>'_executionContract'='java-initial-v1'
                and not exists (
                  select 1 from platform.jobs j
                  where j.id=s.execution_id and j.session_id=s.session_id and j.owner_user_id=s.owner_user_id
                    and j.organization_id=#{organizationId}
                    and j.payload->>'executionContract'='java-initial-v1'
                )
            ), latest as (
              select distinct on (session_id) session_id,execution_id
              from candidates
              order by session_id,fact_created_at desc,execution_id desc
            )
            select latest.session_id,latest.execution_id,j.status as job_status,s.status as snapshot_status,
                   s.conclusion_state,s.failure_point,s.error_code,j.error as job_error,
                   coalesce(s.trace_id,j.origin_correlation_id) as trace_id,
                   coalesce(j.created_at,s.created_at) as created_at,
                   greatest(j.updated_at,s.updated_at) as updated_at
            from latest
            left join platform.jobs j on j.id=latest.execution_id and j.session_id=latest.session_id
                                      and j.owner_user_id=#{ownerUserId} and j.organization_id=#{organizationId}
                                      and j.payload->>'executionContract'='java-initial-v1'
            left join platform.analysis_execution_snapshots s
                   on s.execution_id=latest.execution_id and s.session_id=latest.session_id
                  and s.owner_user_id=#{ownerUserId}
                  and s.follow_up_id is null
                  and s.plan_snapshot->>'_executionContract'='java-initial-v1'
            </script>
            """)
    @Results({
            @Result(property = "sessionId", column = "session_id"),
            @Result(property = "executionId", column = "execution_id"),
            @Result(property = "jobStatus", column = "job_status"),
            @Result(property = "snapshotStatus", column = "snapshot_status"),
            @Result(property = "conclusionState", column = "conclusion_state", typeHandler = JsonbTypeHandler.class),
            @Result(property = "failurePoint", column = "failure_point", typeHandler = JsonbTypeHandler.class),
            @Result(property = "errorCode", column = "error_code"),
            @Result(property = "jobError", column = "job_error"),
            @Result(property = "traceId", column = "trace_id"),
            @Result(property = "createdAt", column = "created_at"),
            @Result(property = "updatedAt", column = "updated_at")
    })
    List<ExecutionRow> listLatestExecutions(@Param("ownerUserId") String ownerUserId,
                                            @Param("organizationId") String organizationId,
                                            @Param("sessionIds") List<String> sessionIds);

    @Select("""
            select p.precinct_id,p.precinct_no,p.precinct_name,
                   coalesce(nullif(p.organization_id::text,'0'),p.org_id) as scoped_organization_id,
                   p.area_id,p.area_name
            from erp_staging.dw_datacenter_precinct p
            where p.precinct_id=any(
                    #{projectIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler})
              and coalesce(p.is_delete,0) != 1 and coalesce(p.delete_flag,0) != 1
              and (
                p.org_id=#{organizationId} or p.organization_id::text=#{organizationId}
                or exists (
                  select 1 from erp_staging.dw_datacenter_system_organization o
                  where (o.source_id::text=p.org_id or o.source_id=p.organization_id)
                    and (o.source_id::text=#{organizationId}
                         or strpos(coalesce(o.organization_path,''),'/' || #{organizationId} || '/') > 0)
                )
              )
            order by p.precinct_name,p.precinct_id
            """)
    @Results(id = "workspaceProject", value = {
            @Result(property = "id", column = "precinct_id"),
            @Result(property = "code", column = "precinct_no"),
            @Result(property = "name", column = "precinct_name"),
            @Result(property = "organizationId", column = "scoped_organization_id"),
            @Result(property = "areaId", column = "area_id"),
            @Result(property = "areaName", column = "area_name")
    })
    List<ProjectRow> listProjects(@Param("organizationId") String organizationId,
                                  @Param("projectIds") String[] projectIds);

    @Select("""
            select p.precinct_id,p.precinct_no,p.precinct_name,
                   coalesce(nullif(p.organization_id::text,'0'),p.org_id) as scoped_organization_id,
                   p.area_id,p.area_name
            from erp_staging.dw_datacenter_precinct p
            where p.area_id=any(
                    #{areaIds,typeHandler=com.dip3.ontologyagent.support.PostgresTextArrayTypeHandler})
              and coalesce(p.is_delete,0) != 1 and coalesce(p.delete_flag,0) != 1
              and (
                p.org_id=#{organizationId} or p.organization_id::text=#{organizationId}
                or exists (
                  select 1 from erp_staging.dw_datacenter_system_organization o
                  where (o.source_id::text=p.org_id or o.source_id=p.organization_id)
                    and (o.source_id::text=#{organizationId}
                         or strpos(coalesce(o.organization_path,''),'/' || #{organizationId} || '/') > 0)
                )
              )
            order by p.precinct_name,p.precinct_id
            """)
    @ResultMap("workspaceProject")
    List<ProjectRow> listProjectsByAreas(@Param("organizationId") String organizationId,
                                         @Param("areaIds") String[] areaIds);

    final class SessionRow {
        public String id;
        public String ownerUserId;
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
        public String sessionId;
        public String executionId;
        public String jobStatus;
        public String snapshotStatus;
        public Map<String, Object> conclusionState;
        public Map<String, Object> failurePoint;
        public String errorCode;
        public String jobError;
        public String traceId;
        public Instant createdAt;
        public Instant updatedAt;
    }

    final class ProjectRow {
        public String id;
        public String code;
        public String name;
        public String organizationId;
        public String areaId;
        public String areaName;
    }
}
