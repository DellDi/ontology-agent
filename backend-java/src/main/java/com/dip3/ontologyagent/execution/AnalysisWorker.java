package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.agent.MainAgent;
import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.AnalysisWorkflow;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
public final class AnalysisWorker {
    private static final Logger log = LoggerFactory.getLogger(AnalysisWorker.class);
    private static final Duration HEARTBEAT = Duration.ofSeconds(30);
    private final ExecutionRepository executions;
    private final AnalysisSessionRepository sessions;
    private final OntologyRepository ontologies;
    private final MainAgent mainAgent;
    private final AgentInvocationRepository invocations;
    private final InvocationEventRecorder recorder;
    private final ScheduledExecutorService leaseHeartbeats = Executors.newSingleThreadScheduledExecutor(r ->
            Thread.ofPlatform().daemon(true).name("analysis-lease-heartbeat").unstarted(r));

    public AnalysisWorker(ExecutionRepository executions, AnalysisSessionRepository sessions,
                          OntologyRepository ontologies, MainAgent mainAgent,
                          AgentInvocationRepository invocations, InvocationEventRecorder recorder) {
        this.executions = executions;
        this.sessions = sessions;
        this.ontologies = ontologies;
        this.mainAgent = mainAgent;
        this.invocations = invocations;
        this.recorder = recorder;
    }

    public boolean runOne(String workerId) {
        String claimToken = workerId + ":" + UUID.randomUUID();
        var claimed = executions.claim(claimToken, ExecutionRepository.EXECUTION_LEASE);
        if (claimed.isEmpty()) return false;
        ExecutionJob job = claimed.get();
        AtomicBoolean leaseLost = new AtomicBoolean();
        var heartbeat = leaseHeartbeats.scheduleAtFixedRate(() -> renewLease(job, leaseLost),
                HEARTBEAT.toSeconds(), HEARTBEAT.toSeconds(), TimeUnit.SECONDS);
        AuthSession owner = new AuthSession("worker:" + workerId, job.ownerUserId(), job.ownerUserId(),
                new AccessScope(job.organizationId(), job.projectIds(), job.areaIds(), List.of()), Instant.MAX);
        String agentRunId = null;
        try {
            if (job.attemptCount() > 1) {
                recorder.interruptRunningWhileLeased(job.executionId(), job.workerId());
            }
            if (job.attemptCount() > job.maxAttempts()) {
                throw new BackendException("JOB_ATTEMPTS_EXHAUSTED", "执行任务已超过最大尝试次数。");
            }
            if (job.attemptCount() > 1
                    && invocations.count(job.executionId(), "workflow-tool", "analysis_workflow") > 0) {
                throw new BackendException("AGENT_EXECUTION_INTERRUPTED",
                        "上一次租约内已开始 Workflow Tool，禁止再次调用 Agent；本次执行显式失败。");
            }
            AnalysisSession session = sessions.findOwned(job.sessionId(), owner)
                    .orElseThrow(() -> new BackendException("SESSION_NOT_FOUND", "执行关联的会话不存在或 scope 已失效。"));
            executions.appendWhileLeased(job.ownerUserId(), job.workerId(),
                    event(job, "processing", "分析执行已开始", null));
            var ontology = ontologies.published(job.ontologyVersionId());
            Map<String, Object> agentInput = new java.util.LinkedHashMap<>();
            agentInput.put("ontologyVersionId", ontology.versionId());
            agentInput.put("attemptCount", job.attemptCount());
            agentInput.put("executionContract", job.contract());
            agentInput.put("questionText", job.questionText());
            agentInput.put("followUpId", job.followUpId());
            agentInput.put("referencedExecutionId", job.referencedExecutionId());
            agentInput.put("referencedConclusion", job.referencedConclusion());
            agentInput.put("effectiveContext", job.effectiveContext());
            agentRunId = recorder.startAgentRun(job.sessionId(), job.executionId(), job.ownerUserId(), agentInput,
                    job.traceId(), job.workerId());
            AgentTurn turn = new AgentTurn(job.contract(), job.sessionId(), job.questionText(), job.followUpId(),
                    job.referencedExecutionId(), job.referencedConclusion(), job.effectiveContext(), session.createdAt());
            WorkflowResult result = mainAgent.execute(owner, turn, job.executionId(), ontology, job.traceId(), job.workerId());
            long workflowCalls = invocations.count(job.executionId(), "workflow-tool", "analysis_workflow");
            if (workflowCalls != 1) {
                throw new BackendException("AGENT_TOOL_CONTRACT_VIOLATION",
                        "Main Agent 必须且只能调用一次 analysis_workflow，实际调用 " + workflowCalls + " 次。");
            }
            recorder.succeedWhileLeased(agentRunId, Map.of("workflowInvocations", workflowCalls),
                    job.executionId(), job.workerId());
            agentRunId = null;
            persistSuccess(job, ontology.versionId(), result);
            return true;
        } catch (RuntimeException error) {
            if (agentRunId != null) error = failAgentRun(job, agentRunId, error);
            String code = error instanceof BackendException known ? known.code() : "EXECUTION_FAILED";
            if ("JOB_LEASE_LOST".equals(code) || leaseLost.get()) {
                log.warn("analysis_job_lease_lost executionId={} workerId={} traceId={}",
                        job.executionId(), job.workerId(), job.traceId());
                return true;
            }
            log.error("analysis_job_failed executionId={} workerId={} code={} traceId={}",
                    job.executionId(), job.workerId(), code, job.traceId(), error);
            try {
                executions.renewLease(job.executionId(), job.workerId(), ExecutionRepository.EXECUTION_LEASE);
                persistFailure(job, code,
                        error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
            } catch (BackendException persistenceError) {
                if (!"JOB_LEASE_LOST".equals(persistenceError.code())
                        && !"JOB_STATE_CONFLICT".equals(persistenceError.code())) throw persistenceError;
                log.warn("analysis_job_terminal_write_rejected executionId={} workerId={} code={} traceId={}",
                        job.executionId(), job.workerId(), persistenceError.code(), job.traceId());
            }
            return true;
        } finally {
            heartbeat.cancel(false);
        }
    }

    private void renewLease(ExecutionJob job, AtomicBoolean leaseLost) {
        try {
            executions.renewLease(job.executionId(), job.workerId(), ExecutionRepository.EXECUTION_LEASE);
        } catch (BackendException error) {
            if ("JOB_LEASE_LOST".equals(error.code())) leaseLost.set(true);
            log.error("analysis_job_heartbeat_failed executionId={} workerId={} code={} traceId={}",
                    job.executionId(), job.workerId(), error.code(), job.traceId(), error);
        } catch (RuntimeException error) {
            log.error("analysis_job_heartbeat_failed executionId={} workerId={} traceId={}",
                    job.executionId(), job.workerId(), job.traceId(), error);
        }
    }

    private RuntimeException failAgentRun(ExecutionJob job, String invocationId, RuntimeException cause) {
        String code = cause instanceof BackendException known ? known.code() : "EXECUTION_FAILED";
        try {
            recorder.failWhileLeased(invocationId, code,
                    cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage(),
                    job.executionId(), job.workerId());
            return cause;
        } catch (RuntimeException auditError) {
            if (auditError instanceof BackendException known && "JOB_LEASE_LOST".equals(known.code())) {
                auditError.addSuppressed(cause);
                return auditError;
            }
            BackendException failure = new BackendException("INVOCATION_AUDIT_FAILURE",
                    "Main Agent 失败后，agent-run 审计写入失败。", auditError);
            failure.addSuppressed(cause);
            return failure;
        }
    }

    @PreDestroy
    void close() {
        leaseHeartbeats.shutdownNow();
    }

    private void persistSuccess(ExecutionJob job, String ontologyVersionId, WorkflowResult result) {
        if (!job.contract().equals(result.plan().get("_executionContract"))
                || !result.plan().containsKey("_resolvedContext")
                || job.followUpId() != null && !job.followUpId().equals(result.plan().get("_followUpId"))) {
            throw new BackendException("WORKFLOW_RESULT_INVALID", "Workflow 结果缺少当前 Java 执行契约或受控上下文。");
        }
        Set<String> evidenceSources = result.evidence().stream().map(Evidence::source)
                .collect(java.util.stream.Collectors.toSet());
        if (!evidenceSources.equals(Set.of("erp-staging", "cube", "neo4j"))
                || result.evidence().stream().anyMatch(item -> item.rows().isEmpty())
                || result.claims() == null || result.claims().isEmpty()) {
            throw new BackendException("WORKFLOW_RESULT_INVALID", "Workflow 完成态缺少必需且非空的受治理证据。");
        }
        Instant now = Instant.now();
        List<Map<String, Object>> conclusionEvidence = result.evidence().stream()
                .map(item -> Map.<String, Object>of("label", item.title(), "summary", summarize(item))).toList();
        Map<String, Object> cause = new java.util.LinkedHashMap<>();
        cause.put("id", "cause-1");
        cause.put("rank", 1);
        cause.put("title", "综合证据结论");
        cause.put("summary", result.conclusion());
        cause.put("confidence", null);
        cause.put("evidence", conclusionEvidence);
        Map<String, Object> terminalMetadata = new java.util.LinkedHashMap<>();
        terminalMetadata.put("ontologyVersionId", ontologyVersionId);
        terminalMetadata.put("executionContract", job.contract());
        terminalMetadata.put("followUpId", job.followUpId());
        ExecutionEvent terminal = new ExecutionEvent(UUID.randomUUID().toString(), job.sessionId(),
                job.executionId(), 0, "execution-status", now, "completed", "分析执行已完成",
                result.renderBlocks(), terminalMetadata, null, job.traceId());
        Map<String, Object> conclusionState = new java.util.LinkedHashMap<>();
        conclusionState.put("causes", List.of(cause));
        conclusionState.put("renderBlocks", result.renderBlocks());
        conclusionState.put("evidence", AnalysisWorkflow.evidenceProjection(result.evidence()));
        conclusionState.put("claims", result.claims());
        ExecutionSnapshot snapshot = new ExecutionSnapshot(job.executionId(), job.sessionId(), job.ownerUserId(),
                job.followUpId(), ontologyVersionId, ontologyBinding(ontologyVersionId,
                job.followUpId() == null ? "grounded-context" : "inherited"), "completed", result.plan(),
                List.of(), conclusionState, result.renderBlocks(),
                mobileProjection(result.conclusion(), "completed", now), null, null, job.traceId(), now, now);
        Map<String, Object> completion = new java.util.LinkedHashMap<>();
        completion.put("workflowInvocations", 1L);
        completion.put("ontologyVersionId", ontologyVersionId);
        completion.put("executionContract", job.contract());
        completion.put("followUpId", job.followUpId());
        completion.put("evidenceSources", List.of("erp-staging", "cube", "neo4j"));
        executions.completeAtomically(job.ownerUserId(), job.workerId(), terminal, snapshot, completion);
    }

    private void persistFailure(ExecutionJob job, String code, String message) {
        Instant now = Instant.now();
        ExecutionEvent terminal = event(job, "failed", message, code);
        Map<String, Object> failedPlan = new java.util.LinkedHashMap<>();
        failedPlan.put("mode", "minimal");
        failedPlan.put("summary", "执行在完成计划前失败");
        failedPlan.put("steps", List.of());
        failedPlan.put("_executionContract", job.contract());
        failedPlan.put("_resolvedContext", job.effectiveContext());
        if (job.followUpId() != null) failedPlan.put("_followUpId", job.followUpId());
        if (job.referencedExecutionId() != null) {
            failedPlan.put("_referencedExecutionId", job.referencedExecutionId());
        }
        ExecutionSnapshot snapshot = new ExecutionSnapshot(job.executionId(), job.sessionId(), job.ownerUserId(),
                job.followUpId(), job.ontologyVersionId(), ontologyBinding(job.ontologyVersionId(),
                job.followUpId() == null ? "grounded-context" : "inherited"), "failed",
                Map.copyOf(failedPlan),
                List.of(), Map.of("causes", List.of(), "renderBlocks", List.of()), List.of(),
                mobileProjection(message, "failed", now), Map.of("id", "execution", "order", 0, "title",
                job.followUpId() == null ? "首次分析" : "追问分析"),
                code, job.traceId(), now, now);
        executions.failAtomically(job.ownerUserId(), job.workerId(), terminal, snapshot, code, message, job.traceId());
    }

    private static ExecutionEvent event(ExecutionJob job, String status, String message, String code) {
        Map<String, Object> statusBlock = Map.of("type", "status", "title", "执行状态", "value",
                "failed".equals(status) ? "已失败" : "处理中", "tone",
                "failed".equals(status) ? "error" : "info");
        List<Map<String, Object>> blocks = code == null ? List.of(statusBlock) : List.of(statusBlock,
                Map.of("type", "kv-list", "title", "失败诊断", "items", List.of(
                        Map.of("label", "错误代码", "value", code),
                        Map.of("label", "Trace ID", "value", job.traceId()))));
        Map<String, Object> metadata = new java.util.LinkedHashMap<>();
        metadata.put("traceId", job.traceId());
        metadata.put("executionContract", job.contract());
        if (job.followUpId() != null) metadata.put("followUpId", job.followUpId());
        if (code != null) metadata.put("errorCode", code);
        return new ExecutionEvent(UUID.randomUUID().toString(), job.sessionId(), job.executionId(), 0,
                "execution-status", Instant.now(), status, message,
                blocks, metadata, code, job.traceId());
    }

    private static String summarize(Evidence evidence) {
        return evidence.rows().isEmpty() ? "数据源返回空结果" : "返回 " + evidence.rows().size() + " 条受范围约束的证据";
    }

    private static Map<String, Object> ontologyBinding(String ontologyVersionId, String source) {
        Map<String, Object> binding = new java.util.LinkedHashMap<>();
        binding.put("ontologyVersionId", ontologyVersionId);
        binding.put("source", source);
        return binding;
    }

    private static Map<String, Object> mobileProjection(String summary, String status, Instant updatedAt) {
        return Map.of("summary", summary, "status", status, "updatedAt", updatedAt.toString());
    }
}
