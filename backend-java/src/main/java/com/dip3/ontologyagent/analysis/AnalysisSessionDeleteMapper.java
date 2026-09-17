package com.dip3.ontologyagent.analysis;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AnalysisSessionDeleteMapper {

    @Select("""
            select count(*) from platform.analysis_sessions
            where id=#{sessionId} and owner_user_id=#{ownerUserId} and organization_id=#{organizationId}
            """)
    int countOwnedSession(@Param("sessionId") String sessionId,
                          @Param("ownerUserId") String ownerUserId,
                          @Param("organizationId") String organizationId);

    /**
     * 非终态执行存在时禁止删除：worker 仍在向该会话写事件/快照，
     * 删除会产生孤儿写入与半删状态。
     */
    @Select("""
            select count(*) from platform.jobs
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
              and status in ('pending','queued','processing')
            """)
    int countActiveJobs(@Param("sessionId") String sessionId,
                        @Param("ownerUserId") String ownerUserId);

    @Select("""
            select count(*) from platform.analysis_execution_snapshots
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
              and status not in ('completed','failed','dead_letter','cancelled')
            """)
    int countActiveSnapshots(@Param("sessionId") String sessionId,
                             @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.job_dispatch_outbox
            where job_id in (select id from platform.jobs
                             where session_id=#{sessionId} and owner_user_id=#{ownerUserId})
            """)
    int deleteDispatchOutbox(@Param("sessionId") String sessionId,
                             @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.job_events
            where job_id in (select id from platform.jobs
                             where session_id=#{sessionId} and owner_user_id=#{ownerUserId})
            """)
    int deleteJobEvents(@Param("sessionId") String sessionId,
                        @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.jobs
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteJobs(@Param("sessionId") String sessionId,
                   @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.analysis_execution_events
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteExecutionEvents(@Param("sessionId") String sessionId,
                              @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.analysis_ui_message_projections
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteUiProjections(@Param("sessionId") String sessionId,
                            @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.agent_invocations
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteAgentInvocations(@Param("sessionId") String sessionId,
                               @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.analysis_execution_snapshots
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteSnapshots(@Param("sessionId") String sessionId,
                        @Param("ownerUserId") String ownerUserId);

    @Delete("""
            delete from platform.analysis_session_follow_ups
            where session_id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteFollowUps(@Param("sessionId") String sessionId,
                        @Param("ownerUserId") String ownerUserId);

    /** Spring AI 对话记忆按 sessionId 作为 conversation_id 存储。 */
    @Delete("""
            delete from spring_ai_chat_memory
            where conversation_id=#{sessionId}
            """)
    int deleteChatMemory(@Param("sessionId") String sessionId);

    @Delete("""
            delete from platform.analysis_sessions
            where id=#{sessionId} and owner_user_id=#{ownerUserId}
            """)
    int deleteSession(@Param("sessionId") String sessionId,
                      @Param("ownerUserId") String ownerUserId);
}
