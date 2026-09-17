package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 会话删除：用户数据整体移除（会话/追问/执行/事件/投影/调用记录），
 * 平台审计日志（audit_events）不在删除范围——它有独立的保留期语义。
 * 存在非终态执行时拒绝删除：worker 写入中的会话删除会产生孤儿数据。
 */
@Service
public class AnalysisSessionDeletionService {
    private final AnalysisSessionDeleteMapper mapper;

    public AnalysisSessionDeletionService(AnalysisSessionDeleteMapper mapper) {
        this.mapper = mapper;
    }

    @Transactional
    public void delete(String sessionId, AuthSession viewer) {
        if (sessionId == null || sessionId.isBlank()) {
            throw new BackendException("SESSION_ID_REQUIRED", "sessionId 不能为空。");
        }
        if (mapper.countOwnedSession(sessionId, viewer.userId(),
                viewer.scope().organizationId()) == 0) {
            throw new BackendException("SESSION_NOT_FOUND", "会话不存在或无权访问。");
        }
        if (mapper.countActiveJobs(sessionId, viewer.userId()) > 0
                || mapper.countActiveSnapshots(sessionId, viewer.userId()) > 0) {
            throw new BackendException("ANALYSIS_SESSION_ACTIVE",
                    "该会话存在正在进行的分析，请等待完成后再删除。");
        }
        mapper.deleteDispatchOutbox(sessionId, viewer.userId());
        mapper.deleteJobEvents(sessionId, viewer.userId());
        mapper.deleteJobs(sessionId, viewer.userId());
        mapper.deleteExecutionEvents(sessionId, viewer.userId());
        mapper.deleteUiProjections(sessionId, viewer.userId());
        mapper.deleteAgentInvocations(sessionId, viewer.userId());
        mapper.deleteSnapshots(sessionId, viewer.userId());
        mapper.deleteFollowUps(sessionId, viewer.userId());
        mapper.deleteChatMemory(sessionId);
        mapper.deleteSession(sessionId, viewer.userId());
    }
}
