package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.dip3.ontologyagent.support.JsonbTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface ExecutionEventMapper extends BaseMapper<ExecutionEventEntity> {
    @Select("""
            with locked as (
              select pg_advisory_xact_lock(hashtextextended(#{row.executionId},0))
            ), next_sequence as (
              select coalesce(max(sequence),0)+1 as sequence
              from platform.analysis_execution_events,locked where execution_id=#{row.executionId}
            )
            insert into platform.analysis_execution_events
            (id,session_id,execution_id,owner_user_id,sequence,kind,event_timestamp,status,message,
             render_blocks,metadata,error_code,trace_id,created_at)
            select #{row.id},#{row.sessionId},#{row.executionId},#{row.ownerUserId},sequence,#{row.kind},
                   #{row.eventTimestamp},#{row.status},#{row.message},
                   #{row.renderBlocks,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                   #{row.metadata,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                   #{row.errorCode},#{row.traceId},#{row.createdAt}
            from next_sequence returning sequence
            """)
    Long append(@Param("row") ExecutionEventEntity row);

    @Select("""
            select id,session_id,execution_id,owner_user_id,sequence,kind,event_timestamp,status,message,
                   render_blocks,metadata,error_code,trace_id,created_at
            from platform.analysis_execution_events
            where session_id=#{sessionId} and execution_id=#{executionId}
              and owner_user_id=#{ownerUserId} and sequence>#{afterSequence}
            order by sequence
            """)
    @Results(id = "executionEvent", value = {
            @Result(property = "sessionId", column = "session_id"),
            @Result(property = "executionId", column = "execution_id"),
            @Result(property = "ownerUserId", column = "owner_user_id"),
            @Result(property = "eventTimestamp", column = "event_timestamp"),
            @Result(property = "renderBlocks", column = "render_blocks", typeHandler = JsonbTypeHandler.class),
            @Result(property = "metadata", column = "metadata", typeHandler = JsonbTypeHandler.class),
            @Result(property = "errorCode", column = "error_code"),
            @Result(property = "traceId", column = "trace_id"),
            @Result(property = "createdAt", column = "created_at")
    })
    List<ExecutionEventEntity> listAfter(@Param("sessionId") String sessionId,
                                         @Param("executionId") String executionId,
                                         @Param("ownerUserId") String ownerUserId,
                                         @Param("afterSequence") long afterSequence);
}
