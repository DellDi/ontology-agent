package com.dip3.ontologyagent.execution;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

@Service
public class InvocationEventRecorder {
    private final AgentInvocationRepository invocations;
    private final ExecutionRepository executions;

    public InvocationEventRecorder(AgentInvocationRepository invocations, ExecutionRepository executions) {
        this.invocations = invocations;
        this.executions = executions;
    }

    @Transactional
    public String start(String sessionId, String executionId, String ownerUserId, String agentName,
                        String toolName, String kind, String parentInvocationId, Map<String, Object> input,
                        String traceId, String leaseOwner) {
        executions.renewLease(executionId, leaseOwner, ExecutionRepository.EXECUTION_LEASE);
        return invocations.start(sessionId, executionId, ownerUserId, agentName, toolName, kind,
                parentInvocationId, input, traceId);
    }

    @Transactional
    public String startAgentRun(String sessionId, String executionId, String ownerUserId,
                                Map<String, Object> input, String traceId, String leaseOwner) {
        executions.renewLease(executionId, leaseOwner, ExecutionRepository.EXECUTION_LEASE);
        return invocations.startAgentRun(sessionId, executionId, ownerUserId, input, traceId);
    }

    @Transactional
    public void succeedWhileLeased(String invocationId, Map<String, Object> output,
                                   String executionId, String leaseOwner) {
        executions.renewLease(executionId, leaseOwner, ExecutionRepository.EXECUTION_LEASE);
        invocations.succeed(invocationId, output);
    }

    @Transactional
    public void failWhileLeased(String invocationId, String code, String message,
                                String executionId, String leaseOwner) {
        executions.renewLease(executionId, leaseOwner, ExecutionRepository.EXECUTION_LEASE);
        invocations.fail(invocationId, code, message);
    }

    @Transactional
    public int interruptRunningWhileLeased(String executionId, String leaseOwner) {
        executions.renewLease(executionId, leaseOwner, ExecutionRepository.EXECUTION_LEASE);
        return invocations.interruptRunning(executionId, "AGENT_EXECUTION_INTERRUPTED",
                "执行租约已被新 Worker 接管，上一租约内未结束的 Agent 调用已中止。");
    }

    @Transactional
    public void succeed(String invocationId, Map<String, Object> output, String ownerUserId,
                        String leaseOwner, ExecutionEvent event) {
        invocations.succeed(invocationId, output);
        executions.appendWhileLeased(ownerUserId, leaseOwner, event);
    }

    @Transactional
    public void fail(String invocationId, String code, String message, String ownerUserId,
                     String leaseOwner, ExecutionEvent event) {
        invocations.fail(invocationId, code, message);
        executions.appendWhileLeased(ownerUserId, leaseOwner, event);
    }
}
