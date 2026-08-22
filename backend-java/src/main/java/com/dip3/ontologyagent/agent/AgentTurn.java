package com.dip3.ontologyagent.agent;

import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.support.BackendException;

import java.time.Instant;
import java.util.Map;

/** The immutable business input for one Main Agent execution. */
public record AgentTurn(String contract, String sessionId, String questionText, String followUpId,
                        String referencedExecutionId, Map<String, Object> referencedConclusion,
                        Map<String, Object> effectiveContext, Instant anchoredAt) {
    public AgentTurn {
        if (!ExecutionRepository.isJavaContract(contract)) {
            throw new BackendException("EXECUTION_CONTRACT_INVALID", "Main Agent 收到不受支持的执行契约。");
        }
        if (sessionId == null || sessionId.isBlank() || questionText == null || questionText.isBlank()
                || anchoredAt == null) {
            throw new BackendException("AGENT_TURN_INVALID", "Main Agent 缺少有效的轮次输入。");
        }
        boolean followUp = ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT.equals(contract);
        if (followUp != (followUpId != null && !followUpId.isBlank())
                || followUp && (referencedExecutionId == null || referencedExecutionId.isBlank())) {
            throw new BackendException("AGENT_TURN_INVALID", "追问轮次缺少 followUpId 或 referencedExecutionId。");
        }
        effectiveContext = effectiveContext == null ? Map.of() : Map.copyOf(effectiveContext);
        referencedConclusion = referencedConclusion == null ? Map.of() : Map.copyOf(referencedConclusion);
        if (!followUp && !referencedConclusion.isEmpty()
                || followUp && !validReferencedConclusion(referencedConclusion)) {
            throw new BackendException("AGENT_TURN_INVALID", "追问轮次缺少受控的来源结论。");
        }
    }

    public boolean followUp() {
        return ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT.equals(contract);
    }

    private static boolean validReferencedConclusion(Map<String, Object> value) {
        if (!value.keySet().equals(java.util.Set.of("title", "summary"))
                || !(value.get("title") instanceof String title)
                || !(value.get("summary") instanceof String summary)) return false;
        return !title.isBlank() || !summary.isBlank();
    }
}
