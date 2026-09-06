package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.JsonbTypeHandler;
import org.apache.ibatis.annotations.Arg;
import org.apache.ibatis.annotations.ConstructorArgs;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.Instant;
import java.util.Map;

@Mapper
public interface GraphSyncRunMapper {
    @Select("select pg_current_xact_id()::text::bigint")
    long currentFencingToken();

    @Select("select pg_try_advisory_xact_lock(hashtextextended('graph-sync-bootstrap', 0))")
    boolean tryLockBootstrap();

    @Select("select pg_try_advisory_xact_lock(hashtextextended(#{organizationId}, 0))")
    boolean tryLockOrganization(String organizationId);

    @Insert("""
            insert into platform.graph_sync_runs
              (id,mode,status,scope_type,scope_key,trigger_type,triggered_by,cursor_snapshot,
               nodes_written,edges_written,error_summary,error_detail,started_at,finished_at,created_at,updated_at)
            values
              (#{run.id},#{run.mode},#{run.status},#{run.scopeType},#{run.scopeKey},#{run.triggerType},
               #{run.triggeredBy},#{run.cursorSnapshot,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
               #{run.nodesWritten},#{run.edgesWritten},#{run.errorSummary},
               #{run.errorDetail,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
               #{run.startedAt},#{run.finishedAt},#{run.createdAt},#{run.updatedAt})
            """)
    int insert(@Param("run") GraphSyncRun run);

    @Update("""
            update platform.graph_sync_runs
            set status=#{status},nodes_written=#{nodesWritten},edges_written=#{edgesWritten},
                error_summary=#{errorSummary},
                error_detail=#{errorDetail,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                started_at=coalesce(started_at,#{startedAt}),finished_at=#{finishedAt},updated_at=#{updatedAt}
            where id=#{id} and status=#{expectedStatus}
            """)
    int transition(@Param("id") String id, @Param("expectedStatus") String expectedStatus,
                   @Param("status") String status, @Param("nodesWritten") int nodesWritten,
                   @Param("edgesWritten") int edgesWritten, @Param("errorSummary") String errorSummary,
                   @Param("errorDetail") Map<String, Object> errorDetail, @Param("startedAt") Instant startedAt,
                   @Param("finishedAt") Instant finishedAt, @Param("updatedAt") Instant updatedAt);

    @Update("""
            update platform.graph_sync_runs
            set status=#{status},error_summary=#{errorSummary},
                error_detail=#{errorDetail,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                finished_at=#{finishedAt},updated_at=#{finishedAt}
            where id=#{id} and status in ('pending','running')
            """)
    int fail(@Param("id") String id, @Param("status") String status,
             @Param("errorSummary") String errorSummary, @Param("errorDetail") Map<String, Object> errorDetail,
             @Param("finishedAt") Instant finishedAt);

    @Select("""
            select id,mode,status,scope_type,scope_key,trigger_type,triggered_by,cursor_snapshot,
                   nodes_written,edges_written,error_summary,error_detail,started_at,finished_at,created_at,updated_at
            from platform.graph_sync_runs
            where scope_type='organization' and scope_key=#{organizationId}
            order by created_at desc,id desc limit 1
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "mode", javaType = String.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "trigger_type", javaType = String.class),
            @Arg(column = "triggered_by", javaType = String.class),
            @Arg(column = "cursor_snapshot", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "nodes_written", javaType = int.class), @Arg(column = "edges_written", javaType = int.class),
            @Arg(column = "error_summary", javaType = String.class),
            @Arg(column = "error_detail", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "started_at", javaType = Instant.class), @Arg(column = "finished_at", javaType = Instant.class),
            @Arg(column = "created_at", javaType = Instant.class), @Arg(column = "updated_at", javaType = Instant.class)
    })
    GraphSyncRun latest(String organizationId);

    @Select("""
            select id,mode,status,scope_type,scope_key,trigger_type,triggered_by,cursor_snapshot,
                   nodes_written,edges_written,error_summary,error_detail,started_at,finished_at,created_at,updated_at
            from platform.graph_sync_runs order by updated_at desc,id desc limit 1
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "mode", javaType = String.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "trigger_type", javaType = String.class),
            @Arg(column = "triggered_by", javaType = String.class),
            @Arg(column = "cursor_snapshot", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "nodes_written", javaType = int.class), @Arg(column = "edges_written", javaType = int.class),
            @Arg(column = "error_summary", javaType = String.class),
            @Arg(column = "error_detail", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "started_at", javaType = Instant.class), @Arg(column = "finished_at", javaType = Instant.class),
            @Arg(column = "created_at", javaType = Instant.class), @Arg(column = "updated_at", javaType = Instant.class)
    })
    GraphSyncRun latestAny();

    @Select("""
            select id,mode,status,scope_type,scope_key,trigger_type,triggered_by,cursor_snapshot,
                   nodes_written,edges_written,error_summary,error_detail,started_at,finished_at,created_at,updated_at
            from platform.graph_sync_runs where scope_type=#{scopeType} and scope_key=#{scopeKey}
            order by created_at desc,id desc limit 1
            """)
    @ConstructorArgs({
            @Arg(column = "id", javaType = String.class), @Arg(column = "mode", javaType = String.class),
            @Arg(column = "status", javaType = String.class), @Arg(column = "scope_type", javaType = String.class),
            @Arg(column = "scope_key", javaType = String.class), @Arg(column = "trigger_type", javaType = String.class),
            @Arg(column = "triggered_by", javaType = String.class),
            @Arg(column = "cursor_snapshot", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "nodes_written", javaType = int.class), @Arg(column = "edges_written", javaType = int.class),
            @Arg(column = "error_summary", javaType = String.class),
            @Arg(column = "error_detail", javaType = Map.class, typeHandler = JsonbTypeHandler.class),
            @Arg(column = "started_at", javaType = Instant.class), @Arg(column = "finished_at", javaType = Instant.class),
            @Arg(column = "created_at", javaType = Instant.class), @Arg(column = "updated_at", javaType = Instant.class)
    })
    GraphSyncRun latestScope(@Param("scopeType") String scopeType, @Param("scopeKey") String scopeKey);

    @Select("""
            select count(*) from platform.graph_sync_runs
            where mode='full-bootstrap' and scope_type='all' and scope_key='all'
              and status in ('pending','running')
            """)
    int activeBootstrapCount();

    @Update("""
            update platform.graph_sync_runs
            set status='failed',error_summary='进程中断导致任务租约过期。',
                error_detail=jsonb_build_object('code','GRAPH_SYNC_STALE_RUN_RECOVERED'),
                finished_at=#{now},updated_at=#{now}
            where scope_type=#{scopeType} and scope_key=#{scopeKey} and status in ('pending','running')
              and updated_at<#{staleBefore}
            """)
    int recoverStale(@Param("scopeType") String scopeType, @Param("scopeKey") String scopeKey,
                     @Param("staleBefore") Instant staleBefore, @Param("now") Instant now);

    @Update("update platform.graph_sync_runs set updated_at=#{now} where id=#{id} and status='running'")
    int heartbeat(@Param("id") String id, @Param("now") Instant now);
}
