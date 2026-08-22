package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionEvent;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSnapshot;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.text.Normalizer;

@Service
public final class AnalysisService {
    private static final Logger log = LoggerFactory.getLogger(AnalysisService.class);
    private final AnalysisSessionRepository sessions;
    private final ExecutionRepository executions;
    private final WakeupPublisher wakeups;
    private final OntologyRepository ontologies;

    public AnalysisService(AnalysisSessionRepository sessions, ExecutionRepository executions,
                           WakeupPublisher wakeups, OntologyRepository ontologies) {
        this.sessions = sessions;
        this.executions = executions;
        this.wakeups = wakeups;
        this.ontologies = ontologies;
    }

    public AnalysisSession createSession(AuthSession owner, String rawQuestion) {
        String question = rawQuestion == null ? "" : Normalizer.normalize(rawQuestion, Normalizer.Form.NFKC)
                .replaceAll("[\\s\\u3000]+", " ").trim();
        if (question.isEmpty()) throw new BackendException("INVALID_ANALYSIS_QUESTION", "请输入要分析的问题。");
        if (question.length() > 300) throw new BackendException("INVALID_ANALYSIS_QUESTION", "问题长度不能超过 300 个字符。");
        if (AnalysisCapabilityPolicy.unsupportedBusinessScope(question)) {
            throw new BackendException("UNSUPPORTED_ANALYSIS_SCOPE",
                    "当前版本仅支持物业分析场景，暂不支持客服系统、CRM、营销、呼叫中心等业务。请聚焦收费、工单、投诉、满意度等物业数据问题。");
        }
        if (!AnalysisCapabilityPolicy.supportsInitialCollectionRate(question)) {
            throw new BackendException("ANALYSIS_CAPABILITY_UNSUPPORTED",
                    "当前 Java 首次分析仅支持项目收缴率，请明确提出收缴率、收费率或回款率问题。");
        }
        if (owner.scope().projectIds().isEmpty() && owner.scope().areaIds().isEmpty()) {
            throw new BackendException("ACCESS_SCOPE_EMPTY", "当前账号还没有可直接发起分析的项目或区域范围。");
        }
        return sessions.create(owner, question, initialContext());
    }

    public String submit(String sessionId, AuthSession owner, String idempotencyKey, String traceId) {
        AnalysisSession session = ownedSession(sessionId, owner);
        if (!ExecutionRepository.EXECUTION_CONTRACT.equals(
                session.savedContext().get("_executionContract"))) {
            throw new BackendException("LEGACY_EXECUTION_NOT_MIGRATED",
                    "该会话由旧后端创建，本切片不会自动或手动重跑首次分析。");
        }
        String ontologyVersionId = ontologies.currentPublished().versionId();
        ExecutionSubmission submission = executions.submit(session, normalizeIdempotencyKey(idempotencyKey), traceId,
                ontologyVersionId);
        if (!submission.created()) return submission.executionId();
        try {
            wakeups.publish(submission.executionId());
            executions.markDispatchPublished(submission.executionId());
        } catch (RuntimeException error) {
            executions.markDispatchFailed(submission.executionId());
            log.warn("redis_wakeup_failed executionId={} traceId={} message={}", submission.executionId(),
                    traceId, error.getMessage(), error);
        }
        return submission.executionId();
    }

    public AnalysisSession ownedSession(String sessionId, AuthSession owner) {
        return sessions.findOwned(sessionId, owner)
                .orElseThrow(() -> new BackendException("SESSION_NOT_FOUND", "会话不存在或无权访问。"));
    }

    public List<ExecutionEvent> events(String sessionId, String executionId, AuthSession owner, long afterSequence) {
        ownedSession(sessionId, owner);
        boolean exists = executions.findOwnedJavaJob(sessionId, executionId, owner.userId()).isPresent()
                || executions.findJavaSnapshot(sessionId, executionId, owner.userId()).isPresent();
        if (!exists) throw new BackendException("EXECUTION_NOT_FOUND", "执行不存在或无权访问。");
        return executions.listAfter(sessionId, executionId, owner.userId(), afterSequence);
    }

    public Optional<ExecutionSnapshot> snapshot(String sessionId, String executionId, AuthSession owner) {
        ownedSession(sessionId, owner);
        return executions.findJavaSnapshot(sessionId, executionId, owner.userId());
    }

    private static String normalizeIdempotencyKey(String key) {
        if (key == null || key.isBlank()) return "initial";
        String normalized = key.trim();
        if (normalized.length() > 128) {
            throw new BackendException("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key 不能超过 128 个字符。");
        }
        return normalized;
    }

    private static Map<String, Object> initialContext() {
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("_executionContract", ExecutionRepository.EXECUTION_CONTRACT);
        context.put("targetMetric", field("目标指标"));
        context.put("entity", field("分析对象"));
        context.put("timeRange", field("时间范围"));
        context.put("comparison", field("比较基线"));
        context.put("constraints", List.of());
        return context;
    }

    private static Map<String, Object> field(String label) {
        return Map.of("label", label, "value", "待由 Agent 基于已发布本体确认", "state", "missing");
    }

}
