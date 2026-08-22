package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.JsonbTypeHandler;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Mapper
public interface GraphSyncIncrementalMapper {
    @Select("select pg_try_advisory_xact_lock(hashtextextended('graph-sync-source:' || #{sourceName},0))")
    boolean tryLockSource(String sourceName);

    @Select("select true from (select pg_advisory_xact_lock(hashtextextended('graph-sync-scope:' || #{scopeKey},0))) locked")
    boolean lockScope(String scopeKey);

    @Select("""
            select source_name,cursor_time,cursor_pk,last_run_id,updated_at
            from platform.graph_sync_cursors where source_name=#{sourceName}
            """)
    @ConstructorArgs({
            @Arg(column = "source_name", javaType = String.class),
            @Arg(column = "cursor_time", javaType = Instant.class),
            @Arg(column = "cursor_pk", javaType = String.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "updated_at", javaType = Instant.class)
    })
    GraphSyncCursor cursor(String sourceName);

    @Insert("""
            insert into platform.graph_sync_dirty_scopes
              (id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
               first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary)
            values
              (#{scope.id},#{scope.scopeType},#{scope.scopeKey},#{scope.reason},#{scope.sourceName},
               #{scope.sourcePk},#{scope.sourceProgress,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
               #{scope.firstDetectedAt},#{scope.lastDetectedAt},'pending',0,null,null)
            """)
    int insertDirty(@Param("scope") GraphSyncDirtyScope scope);

    @Select("""
            select id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary
            from platform.graph_sync_dirty_scopes
            where scope_type='organization' and scope_key=#{scopeKey} and status in ('failed','pending')
            order by case status when 'failed' then 0 else 1 end,first_detected_at limit 1 for update
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "reason", javaType = String.class),
            @Arg(column = "source_name", javaType = String.class), @Arg(column = "source_pk", javaType = String.class),
            @Arg(column = "source_progress", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "first_detected_at", javaType = Instant.class),
            @Arg(column = "last_detected_at", javaType = Instant.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "attempt_count", javaType = int.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "error_summary", javaType = String.class)
    })
    GraphSyncDirtyScope pendingForScope(String scopeKey);

    @Update("""
            update platform.graph_sync_dirty_scopes
            set reason=#{reason},source_name=#{sourceName},source_pk=#{sourcePk},
                source_progress=source_progress || #{sourceProgress,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                last_detected_at=#{detectedAt}
            where id=#{id} and status in ('pending','failed')
            """)
    int mergeDirty(@Param("id") String id, @Param("reason") String reason,
                   @Param("sourceName") String sourceName, @Param("sourcePk") String sourcePk,
                   @Param("sourceProgress") Map<String, Object> sourceProgress,
                   @Param("detectedAt") Instant detectedAt);

    @Select("""
            select id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary
            from platform.graph_sync_dirty_scopes
            where status='pending' and jsonb_exists(source_progress,#{sourceName})
              and not exists (
                select 1 from platform.graph_sync_dirty_scopes exhausted
                where exhausted.scope_type=graph_sync_dirty_scopes.scope_type
                  and exhausted.scope_key=graph_sync_dirty_scopes.scope_key
                  and exhausted.status='failed' and exhausted.attempt_count>=#{maxAttempts}
              )
            order by first_detected_at,id
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "reason", javaType = String.class),
            @Arg(column = "source_name", javaType = String.class), @Arg(column = "source_pk", javaType = String.class),
            @Arg(column = "source_progress", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "first_detected_at", javaType = Instant.class),
            @Arg(column = "last_detected_at", javaType = Instant.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "attempt_count", javaType = int.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "error_summary", javaType = String.class)
    })
    List<GraphSyncDirtyScope> pending(@Param("sourceName") String sourceName,
                                      @Param("maxAttempts") int maxAttempts);

    @Update("""
            update platform.graph_sync_dirty_scopes
            set status='processing',attempt_count=attempt_count+1,error_summary=null,
                last_detected_at=#{claimedAt},last_run_id=#{sourceRunId}
            where id=#{id} and status='pending'
            """)
    int claim(@Param("id") String id, @Param("sourceRunId") String sourceRunId,
              @Param("claimedAt") Instant claimedAt);

    @Update("""
            update platform.graph_sync_dirty_scopes set status='completed',last_run_id=#{runId},error_summary=null
            where id=#{id} and status='processing'
            """)
    int completeDirty(@Param("id") String id, @Param("runId") String runId);

    @Update("""
            update platform.graph_sync_dirty_scopes set status='failed',last_run_id=#{runId},error_summary=#{error}
            where id=#{id} and status='processing'
            """)
    int failDirty(@Param("id") String id, @Param("runId") String runId, @Param("error") String error);

    @Update("""
            update platform.graph_sync_dirty_scopes set status='pending',error_summary=null
            where id=#{id} and status='failed' and attempt_count<#{maxAttempts}
            """)
    int retryDirty(@Param("id") String id, @Param("maxAttempts") int maxAttempts);

    @Update("""
            update platform.graph_sync_dirty_scopes dirty
            set status='failed',error_summary='进程中断导致 dirty scope 处理过期。'
            where dirty.status='processing' and dirty.last_detected_at<#{staleBefore}
              and jsonb_exists(dirty.source_progress,#{sourceName})
              and (dirty.last_run_id is null or not exists (
                    select 1 from platform.graph_sync_runs run
                    where run.id=dirty.last_run_id and run.status in ('pending','running')
                      and run.updated_at>=#{staleBefore}
              ))
            """)
    int recoverProcessing(@Param("sourceName") String sourceName, @Param("staleBefore") Instant staleBefore);

    @Insert("""
            insert into platform.graph_sync_cursors(source_name,cursor_time,cursor_pk,last_run_id,updated_at)
            values(#{sourceName},#{cursorTime},#{cursorPk},#{runId},#{updatedAt})
            on conflict(source_name) do update set cursor_time=excluded.cursor_time,cursor_pk=excluded.cursor_pk,
                last_run_id=excluded.last_run_id,updated_at=excluded.updated_at
            """)
    int saveCursor(@Param("sourceName") String sourceName, @Param("cursorTime") Instant cursorTime,
                   @Param("cursorPk") String cursorPk, @Param("runId") String runId,
                   @Param("updatedAt") Instant updatedAt);

    @Update("""
            update platform.graph_sync_dirty_scopes
            set status='completed',last_run_id=#{runId},error_summary=null
            where status in ('pending','processing','failed')
            """)
    int completeAllDirty(String runId);

    @Select("""
            select source_name,cursor_time,cursor_pk,last_run_id,updated_at
            from platform.graph_sync_cursors order by source_name
            """)
    @ConstructorArgs({
            @Arg(column = "source_name", javaType = String.class),
            @Arg(column = "cursor_time", javaType = Instant.class),
            @Arg(column = "cursor_pk", javaType = String.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "updated_at", javaType = Instant.class)
    })
    List<GraphSyncCursor> cursors();

    @Select("select status,count(*)::int from platform.graph_sync_dirty_scopes group by status")
    List<Map<String, Object>> backlog();

    @Select("""
            select status,count(*)::int from platform.graph_sync_dirty_scopes
            where scope_type='organization' and scope_key=#{organizationId} group by status
            """)
    List<Map<String, Object>> scopedBacklog(String organizationId);

    @Select("""
            select id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary
            from platform.graph_sync_dirty_scopes where status='failed'
            order by last_detected_at desc,id desc limit #{limit}
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "reason", javaType = String.class),
            @Arg(column = "source_name", javaType = String.class), @Arg(column = "source_pk", javaType = String.class),
            @Arg(column = "source_progress", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "first_detected_at", javaType = Instant.class),
            @Arg(column = "last_detected_at", javaType = Instant.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "attempt_count", javaType = int.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "error_summary", javaType = String.class)
    })
    List<GraphSyncDirtyScope> failures(int limit);

    @Select("""
            select id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary
            from platform.graph_sync_dirty_scopes
            where status='failed' and scope_type='organization' and scope_key=#{organizationId}
            order by last_detected_at desc,id desc limit #{limit}
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "reason", javaType = String.class),
            @Arg(column = "source_name", javaType = String.class), @Arg(column = "source_pk", javaType = String.class),
            @Arg(column = "source_progress", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "first_detected_at", javaType = Instant.class),
            @Arg(column = "last_detected_at", javaType = Instant.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "attempt_count", javaType = int.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "error_summary", javaType = String.class)
    })
    List<GraphSyncDirtyScope> scopedFailures(@Param("organizationId") String organizationId,
                                             @Param("limit") int limit);

    @Select("""
            select id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary
            from platform.graph_sync_dirty_scopes
            where status='failed' and jsonb_exists(source_progress,#{sourceName}) and attempt_count<#{maxAttempts}
            order by last_detected_at,id
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "reason", javaType = String.class),
            @Arg(column = "source_name", javaType = String.class), @Arg(column = "source_pk", javaType = String.class),
            @Arg(column = "source_progress", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "first_detected_at", javaType = Instant.class),
            @Arg(column = "last_detected_at", javaType = Instant.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "attempt_count", javaType = int.class),
            @Arg(column = "last_run_id", javaType = String.class),
            @Arg(column = "error_summary", javaType = String.class)
    })
    List<GraphSyncDirtyScope> retryable(@Param("sourceName") String sourceName,
                                        @Param("maxAttempts") int maxAttempts);

    @Select("""
            select source_id::text from erp_staging.dw_datacenter_system_organization
            where coalesce(is_deleted,0)<>1 order by source_id limit #{limit}
            """)
    List<String> organizationIds(int limit);
}
