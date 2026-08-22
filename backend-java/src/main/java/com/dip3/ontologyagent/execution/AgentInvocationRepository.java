package com.dip3.ontologyagent.execution;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class AgentInvocationRepository {
    private final AgentInvocationMapper mapper;

    public AgentInvocationRepository(AgentInvocationMapper mapper) {
        this.mapper = mapper;
    }

    public String start(String sessionId, String executionId, String ownerUserId, String agentName,
                        String toolName, String kind, String parentInvocationId,
                        Map<String, Object> input, String traceId) {
        Instant now = Instant.now();
        AgentInvocationEntity row = new AgentInvocationEntity();
        row.id = UUID.randomUUID().toString();
        row.sessionId = sessionId;
        row.executionId = executionId;
        row.ownerUserId = ownerUserId;
        row.agentName = agentName;
        row.toolName = toolName;
        row.kind = kind;
        row.parentInvocationId = parentInvocationId;
        row.input = input;
        row.status = "running";
        row.traceId = traceId;
        row.startedAt = now;
        row.createdAt = now;
        row.updatedAt = now;
        mapper.insert(row);
        return row.id;
    }

    public String startAgentRun(String sessionId, String executionId, String ownerUserId,
                                Map<String, Object> input, String traceId) {
        try {
            return start(sessionId, executionId, ownerUserId, "main-agent", "main-agent", "agent-run", null,
                    input, traceId);
        } catch (DuplicateKeyException error) {
            throw new BackendException("AGENT_RUN_ALREADY_STARTED",
                    "该执行已启动过 Main Agent，禁止在租约切换后重复调用模型。", error);
        }
    }

    public void succeed(String invocationId, Map<String, Object> output) {
        AgentInvocationEntity patch = new AgentInvocationEntity();
        patch.output = output;
        patch.status = "completed";
        patch.completedAt = Instant.now();
        patch.updatedAt = patch.completedAt;
        requireSingleUpdate(mapper.update(patch, new UpdateWrapper<AgentInvocationEntity>()
                .eq("id", invocationId).eq("status", "running")));
    }

    public void fail(String invocationId, String code, String message) {
        AgentInvocationEntity patch = new AgentInvocationEntity();
        patch.status = "failed";
        patch.errorCode = code;
        patch.errorMessage = message;
        patch.completedAt = Instant.now();
        patch.updatedAt = patch.completedAt;
        requireSingleUpdate(mapper.update(patch, new UpdateWrapper<AgentInvocationEntity>()
                .eq("id", invocationId).eq("status", "running")));
    }

    public int interruptRunning(String executionId, String code, String message) {
        AgentInvocationEntity patch = new AgentInvocationEntity();
        patch.status = "failed";
        patch.errorCode = code;
        patch.errorMessage = message;
        patch.completedAt = Instant.now();
        patch.updatedAt = patch.completedAt;
        return mapper.update(patch, new UpdateWrapper<AgentInvocationEntity>()
                .eq("execution_id", executionId).eq("status", "running"));
    }

    public long count(String executionId, String kind, String toolName) {
        return mapper.selectCount(new QueryWrapper<AgentInvocationEntity>().eq("execution_id", executionId)
                .eq("kind", kind).eq("tool_name", toolName));
    }

    public Map<String, Object> singleInput(String executionId, String kind, String toolName) {
        List<AgentInvocationEntity> rows = mapper.selectList(new QueryWrapper<AgentInvocationEntity>()
                .eq("execution_id", executionId).eq("kind", kind).eq("tool_name", toolName));
        if (rows.size() != 1) {
            throw new BackendException("INVOCATION_AUDIT_INVALID",
                    "预期恰好一条 " + toolName + " 审计，实际 " + rows.size() + " 条。");
        }
        return rows.getFirst().input;
    }

    private static void requireSingleUpdate(int changed) {
        if (changed != 1) throw new BackendException("INVOCATION_STATE_CONFLICT", "Agent invocation 状态更新冲突。");
    }
}
