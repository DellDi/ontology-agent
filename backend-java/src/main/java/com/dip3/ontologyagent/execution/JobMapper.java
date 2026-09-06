package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.dip3.ontologyagent.support.JsonbTypeHandler;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Result;
import org.apache.ibatis.annotations.Results;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.Instant;
import java.util.Map;

@Mapper
public interface JobMapper extends BaseMapper<JobEntity> {
    @Insert("""
            insert into platform.jobs
              (id,type,status,payload,result,error,attempt_count,max_attempts,available_at,locked_by,locked_until,
               redis_stream_entry_id,dispatch_status,owner_user_id,organization_id,session_id,
               dataset_version_set_id,origin_correlation_id,created_at,updated_at,started_at,completed_at,failed_at)
            values
              (#{row.id},#{row.type},#{row.status},
               #{row.payload,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
               #{row.result,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},#{row.error},
               #{row.attemptCount},#{row.maxAttempts},#{row.availableAt},#{row.lockedBy},#{row.lockedUntil},
               #{row.redisStreamEntryId},#{row.dispatchStatus},#{row.ownerUserId},#{row.organizationId},
               #{row.sessionId},#{row.datasetVersionSetId},#{row.originCorrelationId},#{row.createdAt},#{row.updatedAt},#{row.startedAt},
               #{row.completedAt},#{row.failedAt})
            on conflict (id) do nothing
            """)
    int insertIfAbsent(@Param("row") JobEntity row);

    @Select("""
            update platform.jobs set status='processing',locked_by=#{workerId},locked_until=#{lockedUntil},
                started_at=coalesce(started_at,now()),attempt_count=attempt_count+1,updated_at=now()
            where id=(select id from platform.jobs where type='analysis-execution'
                      and payload->>'executionContract' in ('java-initial-v1','java-follow-up-v1')
                      and ((status in ('pending','queued') and available_at<=now())
                           or (status='processing' and locked_until<now()))
                      order by available_at,created_at for update skip locked limit 1)
            returning id,session_id,owner_user_id,organization_id,dataset_version_set_id,origin_correlation_id,payload,
                      attempt_count,max_attempts
            """)
    @Results({
            @Result(property = "sessionId", column = "session_id"),
            @Result(property = "ownerUserId", column = "owner_user_id"),
            @Result(property = "organizationId", column = "organization_id"),
            @Result(property = "datasetVersionSetId", column = "dataset_version_set_id"),
            @Result(property = "originCorrelationId", column = "origin_correlation_id"),
            @Result(property = "payload", column = "payload", typeHandler = JsonbTypeHandler.class)
    })
    JobEntity claim(@Param("workerId") String workerId, @Param("lockedUntil") Instant lockedUntil);

    @Update("""
            update platform.jobs set locked_until=#{lockedUntil},updated_at=now()
            where id=#{executionId} and status='processing' and locked_by=#{workerId}
              and locked_until>=now()
              and payload->>'executionContract' in ('java-initial-v1','java-follow-up-v1')
            """)
    int renewLease(@Param("executionId") String executionId, @Param("workerId") String workerId,
                   @Param("lockedUntil") Instant lockedUntil);

    @Update("""
            update platform.jobs set status='completed',
                result=#{result,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},error=null,
                locked_by=null,locked_until=null,completed_at=now(),updated_at=now()
            where id=#{executionId} and status='processing' and locked_by=#{workerId}
              and locked_until>=now()
              and payload->>'executionContract' in ('java-initial-v1','java-follow-up-v1')
            """)
    int complete(@Param("executionId") String executionId, @Param("workerId") String workerId,
                 @Param("result") Map<String, Object> result);

    @Update("""
            update platform.jobs set status='failed',error=#{error},
                result=#{result,typeHandler=com.dip3.ontologyagent.support.JsonbTypeHandler},
                locked_by=null,locked_until=null,failed_at=now(),updated_at=now()
            where id=#{executionId} and status='processing' and locked_by=#{workerId}
              and locked_until>=now()
              and payload->>'executionContract' in ('java-initial-v1','java-follow-up-v1')
            """)
    int fail(@Param("executionId") String executionId, @Param("workerId") String workerId,
             @Param("error") String error,
             @Param("result") Map<String, Object> result);

    @Update("update platform.jobs set dispatch_status=#{status},updated_at=now() where id=#{executionId}")
    int updateDispatchStatus(@Param("executionId") String executionId, @Param("status") String status);
}
