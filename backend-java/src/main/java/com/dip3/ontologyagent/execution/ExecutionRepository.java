package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ExecutionRepository {
    public static final String INITIAL_EXECUTION_CONTRACT = "java-initial-v1";
    public static final String FOLLOW_UP_EXECUTION_CONTRACT = "java-follow-up-v1";
    /** Kept as the initial-analysis alias for existing callers. */
    public static final String EXECUTION_CONTRACT = INITIAL_EXECUTION_CONTRACT;
    public static final Duration EXECUTION_LEASE = Duration.ofMinutes(2);

    private final JobMapper jobs;
    private final ExecutionEventMapper events;
    private final ExecutionSnapshotMapper snapshots;

    public ExecutionRepository(JobMapper jobs, ExecutionEventMapper events, ExecutionSnapshotMapper snapshots) {
        this.jobs = jobs;
        this.events = events;
        this.snapshots = snapshots;
    }

    public ExecutionSubmission submit(AnalysisSession session, String idempotencyKey, String traceId,
                                      String ontologyVersionId) {
        String executionId = idempotencyKey == null ? UUID.randomUUID().toString()
                : UUID.nameUUIDFromBytes(("analysis-execution:" + session.id() + ":" + idempotencyKey)
                .getBytes(StandardCharsets.UTF_8)).toString();
        Instant now = Instant.now();
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("executionContract", EXECUTION_CONTRACT);
        payload.put("sessionId", session.id());
        payload.put("ownerUserId", session.ownerUserId());
        payload.put("organizationId", session.scope().organizationId());
        payload.put("projectIds", session.scope().projectIds());
        payload.put("areaIds", session.scope().areaIds());
        payload.put("questionText", session.questionText());
        payload.put("traceId", traceId);
        payload.put("ontologyVersionId", ontologyVersionId);
        JobEntity row = new JobEntity();
        row.id = executionId;
        row.type = "analysis-execution";
        row.status = "queued";
        row.payload = payload;
        row.attemptCount = 0;
        row.maxAttempts = 2;
        row.availableAt = now;
        row.dispatchStatus = "pending";
        row.ownerUserId = session.ownerUserId();
        row.organizationId = session.scope().organizationId();
        row.sessionId = session.id();
        row.originCorrelationId = traceId;
        row.createdAt = now;
        row.updatedAt = now;
        boolean created = jobs.insertIfAbsent(row) == 1;
        if (!created) requireSameIdentity(row, jobs.selectById(executionId));
        return new ExecutionSubmission(executionId, created);
    }

    public ExecutionSubmission submitFollowUp(AnalysisSession session, String followUpId,
                                               String referencedExecutionId, String questionText,
                                               Map<String, Object> referencedConclusion,
                                               Map<String, Object> effectiveContext, String idempotencyKey,
                                               String traceId, String ontologyVersionId) {
        requireText(followUpId, "followUpId");
        requireText(referencedExecutionId, "referencedExecutionId");
        requireText(questionText, "questionText");
        requireText(traceId, "traceId");
        requireText(ontologyVersionId, "ontologyVersionId");
        Map<String, Object> context = effectiveContext == null ? Map.of() : Map.copyOf(effectiveContext);
        Map<String, Object> conclusion = validatedReferencedConclusion(referencedConclusion);
        String executionId = idempotencyKey == null ? UUID.randomUUID().toString()
                : UUID.nameUUIDFromBytes(("analysis-follow-up-execution:" + session.id() + ":" + followUpId
                + ":" + idempotencyKey).getBytes(StandardCharsets.UTF_8)).toString();
        Map<String, Object> payload = basePayload(session, FOLLOW_UP_EXECUTION_CONTRACT, questionText, traceId,
                ontologyVersionId);
        payload.put("followUpId", followUpId);
        payload.put("referencedExecutionId", referencedExecutionId);
        payload.put("referencedConclusion", conclusion);
        payload.put("effectiveContext", context);
        JobEntity row = job(executionId, session, payload, traceId);
        boolean created = jobs.insertIfAbsent(row) == 1;
        if (!created) requireSameIdentity(row, jobs.selectById(executionId));
        return new ExecutionSubmission(executionId, created);
    }

    public Optional<ExecutionJob> claim(String workerId, Duration lease) {
        JobEntity row = jobs.claim(workerId, Instant.now().plus(lease));
        if (row == null) return Optional.empty();
        try {
            String contract = requiredText(row.payload, "executionContract");
            if (!isJavaContract(contract)) {
                throw new BackendException("JOB_PAYLOAD_INVALID", "任务执行契约不受支持。");
            }
            boolean followUp = FOLLOW_UP_EXECUTION_CONTRACT.equals(contract);
            return Optional.of(new ExecutionJob(row.id, contract, required(row.sessionId, "sessionId"),
                    required(row.ownerUserId, "ownerUserId"), required(row.organizationId, "organizationId"),
                    stringList(row.payload.get("projectIds")), stringList(row.payload.get("areaIds")),
                    requiredText(row.payload, "questionText"), requiredText(row.payload, "traceId"),
                    requiredText(row.payload, "ontologyVersionId"),
                    followUp ? requiredText(row.payload, "followUpId") : null,
                    followUp ? requiredText(row.payload, "referencedExecutionId") : null,
                    followUp ? validatedReferencedConclusion(objectMap(
                            row.payload.get("referencedConclusion"), "referencedConclusion")) : Map.of(),
                    followUp ? objectMap(row.payload.get("effectiveContext"), "effectiveContext") : Map.of(), workerId,
                    row.attemptCount, row.maxAttempts));
        } catch (BackendException error) {
            String traceId = nullableText(row.payload.get("traceId"));
            if (traceId == null) traceId = row.originCorrelationId == null ? "unknown" : row.originCorrelationId;
            jobs.fail(row.id, workerId, error.code() + ": " + error.getMessage(),
                    Map.of("code", error.code(), "message", error.getMessage(), "traceId", traceId));
            throw error;
        }
    }

    public void renewLease(String executionId, String workerId, Duration lease) {
        if (jobs.renewLease(executionId, workerId, Instant.now().plus(lease)) != 1) {
            throw new BackendException("JOB_LEASE_LOST", "执行任务租约已被其他 Worker 接管。");
        }
    }

    public void markDispatchPublished(String executionId) {
        requireDispatchUpdate(jobs.updateDispatchStatus(executionId, "published"));
    }

    public void markDispatchFailed(String executionId) {
        requireDispatchUpdate(jobs.updateDispatchStatus(executionId, "failed"));
    }

    public void complete(String executionId, String workerId, Map<String, Object> result) {
        if (jobs.complete(executionId, workerId, result) != 1) {
            throw new BackendException("JOB_STATE_CONFLICT", "执行任务无法从 processing 转为 completed。");
        }
    }

    public void fail(String executionId, String workerId, String code, String message, String traceId) {
        Map<String, Object> detail = Map.of("code", code, "message", message, "traceId", traceId);
        if (jobs.fail(executionId, workerId, code + ": " + message, detail) != 1) {
            throw new BackendException("JOB_STATE_CONFLICT", "执行任务无法转为 failed。");
        }
    }

    @Transactional
    public void completeAtomically(String ownerUserId, String workerId, ExecutionEvent terminal, ExecutionSnapshot snapshot,
                                   Map<String, Object> result) {
        append(ownerUserId, terminal);
        saveSnapshot(withEvents(snapshot, listAfter(snapshot.sessionId(), snapshot.executionId(), ownerUserId, 0)));
        complete(snapshot.executionId(), workerId, result);
    }

    @Transactional
    public void failAtomically(String ownerUserId, String workerId, ExecutionEvent terminal, ExecutionSnapshot snapshot,
                               String code, String message, String traceId) {
        append(ownerUserId, terminal);
        saveSnapshot(withEvents(snapshot, listAfter(snapshot.sessionId(), snapshot.executionId(), ownerUserId, 0)));
        fail(snapshot.executionId(), workerId, code, message, traceId);
    }

    @Transactional
    public ExecutionEvent append(String ownerUserId, ExecutionEvent event) {
        ExecutionEventEntity row = new ExecutionEventEntity();
        row.id = event.id();
        row.sessionId = event.sessionId();
        row.executionId = event.executionId();
        row.ownerUserId = ownerUserId;
        row.kind = event.kind();
        row.eventTimestamp = event.timestamp();
        row.status = event.status();
        row.message = event.message();
        row.renderBlocks = event.renderBlocks();
        row.metadata = event.metadata();
        row.errorCode = event.errorCode();
        row.traceId = event.traceId();
        row.createdAt = Instant.now();
        Long sequence = events.append(row);
        if (sequence == null) throw new BackendException("EVENT_APPEND_FAILED", "执行事件写入失败。");
        return new ExecutionEvent(event.id(), event.sessionId(), event.executionId(), sequence, event.kind(),
                event.timestamp(), event.status(), event.message(), event.renderBlocks(), event.metadata(),
                event.errorCode(), event.traceId());
    }

    @Transactional
    public ExecutionEvent appendWhileLeased(String ownerUserId, String leaseOwner, ExecutionEvent event) {
        renewLease(event.executionId(), leaseOwner, EXECUTION_LEASE);
        return append(ownerUserId, event);
    }

    public List<ExecutionEvent> listAfter(String sessionId, String executionId, String ownerUserId, long afterSequence) {
        return events.listAfter(sessionId, executionId, ownerUserId, afterSequence).stream()
                .map(ExecutionRepository::event).toList();
    }

    public Optional<String> findOwnedJob(String sessionId, String executionId, String ownerUserId) {
        JobEntity row = jobs.selectById(executionId);
        return row != null && sessionId.equals(row.sessionId) && ownerUserId.equals(row.ownerUserId)
                && row.payload != null && EXECUTION_CONTRACT.equals(row.payload.get("executionContract"))
                ? Optional.of(row.id) : Optional.empty();
    }

    public Optional<String> findOwnedJavaJob(String sessionId, String executionId, String ownerUserId) {
        JobEntity row = jobs.selectById(executionId);
        return row != null && sessionId.equals(row.sessionId) && ownerUserId.equals(row.ownerUserId)
                && row.payload != null && isJavaContract(nullableText(row.payload.get("executionContract")))
                ? Optional.of(row.id) : Optional.empty();
    }

    public Optional<String> findOwnedFollowUpJob(String sessionId, String followUpId, String executionId,
                                                 String ownerUserId) {
        JobEntity row = jobs.selectById(executionId);
        return row != null && sessionId.equals(row.sessionId) && ownerUserId.equals(row.ownerUserId)
                && row.payload != null
                && FOLLOW_UP_EXECUTION_CONTRACT.equals(row.payload.get("executionContract"))
                && followUpId.equals(row.payload.get("followUpId")) ? Optional.of(row.id) : Optional.empty();
    }

    @Transactional
    public void saveSnapshot(ExecutionSnapshot snapshot) {
        ExecutionSnapshotEntity row = new ExecutionSnapshotEntity();
        row.executionId = snapshot.executionId();
        row.sessionId = snapshot.sessionId();
        row.ownerUserId = snapshot.ownerUserId();
        row.followUpId = snapshot.followUpId();
        row.ontologyVersionId = snapshot.ontologyVersionId();
        row.ontologyVersionBindingSource = snapshot.ontologyVersionBinding().get("source").toString();
        row.status = snapshot.status();
        row.planSnapshot = snapshot.planSnapshot();
        row.stepResults = snapshot.stepResults().stream().map(ExecutionRepository::eventMap).toList();
        row.conclusionState = snapshot.conclusionState();
        row.resultBlocks = snapshot.resultBlocks();
        row.mobileProjection = snapshot.mobileProjection();
        row.failurePoint = snapshot.failurePoint();
        row.errorCode = snapshot.errorCode();
        row.traceId = snapshot.traceId();
        row.createdAt = snapshot.createdAt();
        row.updatedAt = snapshot.updatedAt();
        if (snapshots.selectById(snapshot.executionId()) == null) snapshots.insert(row);
        else snapshots.updateById(row);
    }

    public Optional<ExecutionSnapshot> findSnapshot(String sessionId, String executionId, String ownerUserId) {
        ExecutionSnapshotEntity row = snapshots.selectById(executionId);
        if (row == null || !sessionId.equals(row.sessionId) || !ownerUserId.equals(row.ownerUserId)
                || row.followUpId != null || row.planSnapshot == null
                || !EXECUTION_CONTRACT.equals(row.planSnapshot.get("_executionContract"))) {
            return Optional.empty();
        }
        return Optional.of(snapshot(row));
    }

    public Optional<ExecutionSnapshot> findFollowUpSnapshot(String sessionId, String followUpId,
                                                            String executionId, String ownerUserId) {
        ExecutionSnapshotEntity row = snapshots.selectById(executionId);
        if (row == null || !sessionId.equals(row.sessionId) || !ownerUserId.equals(row.ownerUserId)
                || !followUpId.equals(row.followUpId) || row.planSnapshot == null
                || !FOLLOW_UP_EXECUTION_CONTRACT.equals(row.planSnapshot.get("_executionContract"))) {
            return Optional.empty();
        }
        return Optional.of(snapshot(row));
    }

    public Optional<ExecutionSnapshot> findJavaSnapshot(String sessionId, String executionId, String ownerUserId) {
        ExecutionSnapshotEntity row = snapshots.selectById(executionId);
        if (row == null || !sessionId.equals(row.sessionId) || !ownerUserId.equals(row.ownerUserId)
                || row.planSnapshot == null
                || !isJavaContract(nullableText(row.planSnapshot.get("_executionContract")))) {
            return Optional.empty();
        }
        return Optional.of(snapshot(row));
    }

    private static ExecutionSnapshot snapshot(ExecutionSnapshotEntity row) {
        return new ExecutionSnapshot(row.executionId, row.sessionId, row.ownerUserId, row.followUpId,
                row.ontologyVersionId, ontologyBinding(row.ontologyVersionId, row.ontologyVersionBindingSource),
                row.status, row.planSnapshot,
                row.stepResults == null ? List.of() : row.stepResults.stream().map(ExecutionRepository::event).toList(),
                row.conclusionState, row.resultBlocks, row.mobileProjection, row.failurePoint, row.errorCode, row.traceId,
                row.createdAt, row.updatedAt);
    }

    public static boolean isJavaContract(String contract) {
        return INITIAL_EXECUTION_CONTRACT.equals(contract) || FOLLOW_UP_EXECUTION_CONTRACT.equals(contract);
    }

    private static Map<String, Object> ontologyBinding(String ontologyVersionId, String source) {
        Map<String, Object> binding = new LinkedHashMap<>();
        binding.put("ontologyVersionId", ontologyVersionId);
        binding.put("source", source);
        return binding;
    }

    private static ExecutionEvent event(ExecutionEventEntity row) {
        return new ExecutionEvent(row.id, row.sessionId, row.executionId, row.sequence, row.kind,
                row.eventTimestamp, row.status, row.message, row.renderBlocks, row.metadata, row.errorCode, row.traceId);
    }

    private static ExecutionEvent event(Map<String, Object> row) {
        return new ExecutionEvent(text(row, "id"), text(row, "sessionId"), text(row, "executionId"),
                ((Number) row.get("sequence")).longValue(), text(row, "kind"), Instant.parse(text(row, "timestamp")),
                nullableText(row.get("status")), nullableText(row.get("message")), castMapList(row.get("renderBlocks")),
                castMap(row.get("metadata")), nullableText(row.get("errorCode")), nullableText(row.get("traceId")));
    }

    private static Map<String, Object> eventMap(ExecutionEvent event) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("id", event.id());
        row.put("sessionId", event.sessionId());
        row.put("executionId", event.executionId());
        row.put("sequence", event.sequence());
        row.put("kind", event.kind());
        row.put("timestamp", event.timestamp().toString());
        row.put("status", event.status());
        row.put("message", event.message());
        row.put("renderBlocks", event.renderBlocks());
        row.put("metadata", event.metadata());
        row.put("errorCode", event.errorCode());
        row.put("traceId", event.traceId());
        return row;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castMapList(Object value) {
        return value == null ? List.of() : (List<Map<String, Object>>) value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        return value == null ? Map.of() : (Map<String, Object>) value;
    }

    private static String text(Map<String, Object> source, String key) {
        String value = nullableText(source.get(key));
        if (value == null) throw new BackendException("DATABASE_JSON_INVALID", "执行事件缺少字段 " + key + "。");
        return value;
    }

    private static String nullableText(Object value) {
        return value == null ? null : value.toString();
    }

    private static String requiredText(Map<String, Object> source, String key) {
        String value = nullableText(source.get(key));
        if (value == null || value.isBlank()) throw new BackendException("JOB_PAYLOAD_INVALID", "任务缺少字段 " + key + "。");
        return value;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list)) throw new BackendException("JOB_PAYLOAD_INVALID", "任务 scope 数组无效。");
        if (list.stream().anyMatch(item -> !(item instanceof String text) || text.isBlank())) {
            throw new BackendException("JOB_PAYLOAD_INVALID", "任务 scope 数组无效。");
        }
        return list.stream().map(String.class::cast).toList();
    }

    private static String required(String value, String key) {
        if (value == null || value.isBlank()) {
            throw new BackendException("JOB_PAYLOAD_INVALID", "任务缺少字段 " + key + "。");
        }
        return value;
    }

    private static void requireText(String value, String key) {
        if (value == null || value.isBlank()) {
            throw new BackendException("FOLLOW_UP_EXECUTION_INVALID", "追问执行缺少字段 " + key + "。");
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> objectMap(Object value, String key) {
        if (!(value instanceof Map<?, ?> map)
                || map.keySet().stream().anyMatch(item -> !(item instanceof String))) {
            throw new BackendException("JOB_PAYLOAD_INVALID", "任务字段 " + key + " 必须是对象。");
        }
        return Map.copyOf((Map<String, Object>) map);
    }

    private static Map<String, Object> validatedReferencedConclusion(Map<String, Object> value) {
        if (value == null || !value.keySet().equals(java.util.Set.of("title", "summary"))
                || !(value.get("title") instanceof String title)
                || !(value.get("summary") instanceof String summary)
                || title.isBlank() && summary.isBlank()) {
            throw new BackendException("FOLLOW_UP_EXECUTION_INVALID", "追问执行缺少受控的来源结论。");
        }
        return Map.of("title", title, "summary", summary);
    }

    private static Map<String, Object> basePayload(AnalysisSession session, String contract, String questionText,
                                                   String traceId, String ontologyVersionId) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("executionContract", contract);
        payload.put("sessionId", session.id());
        payload.put("ownerUserId", session.ownerUserId());
        payload.put("organizationId", session.scope().organizationId());
        payload.put("projectIds", session.scope().projectIds());
        payload.put("areaIds", session.scope().areaIds());
        payload.put("questionText", questionText);
        payload.put("traceId", traceId);
        payload.put("ontologyVersionId", ontologyVersionId);
        return payload;
    }

    private static JobEntity job(String executionId, AnalysisSession session, Map<String, Object> payload,
                                 String traceId) {
        Instant now = Instant.now();
        JobEntity row = new JobEntity();
        row.id = executionId;
        row.type = "analysis-execution";
        row.status = "queued";
        row.payload = payload;
        row.attemptCount = 0;
        row.maxAttempts = 2;
        row.availableAt = now;
        row.dispatchStatus = "pending";
        row.ownerUserId = session.ownerUserId();
        row.organizationId = session.scope().organizationId();
        row.sessionId = session.id();
        row.originCorrelationId = traceId;
        row.createdAt = now;
        row.updatedAt = now;
        return row;
    }

    private static void requireSameIdentity(JobEntity expected, JobEntity actual) {
        if (actual == null || !expected.sessionId.equals(actual.sessionId)
                || !expected.ownerUserId.equals(actual.ownerUserId)
                || !expected.organizationId.equals(actual.organizationId)
                || !expected.type.equals(actual.type)
                || actual.payload == null
                || !java.util.Objects.equals(expected.payload.get("executionContract"),
                actual.payload.get("executionContract"))
                || FOLLOW_UP_EXECUTION_CONTRACT.equals(expected.payload.get("executionContract"))
                && !sameFollowUpIdentity(expected.payload, actual.payload)) {
            throw new BackendException("IDEMPOTENCY_CONFLICT", "幂等执行标识已绑定到不同的请求身份或载荷。");
        }
    }

    private static boolean sameFollowUpIdentity(Map<String, Object> expected, Map<String, Object> actual) {
        return java.util.Objects.equals(expected.get("followUpId"), actual.get("followUpId"))
                && java.util.Objects.equals(expected.get("referencedExecutionId"), actual.get("referencedExecutionId"))
                && java.util.Objects.equals(expected.get("questionText"), actual.get("questionText"))
                && java.util.Objects.equals(expected.get("effectiveContext"), actual.get("effectiveContext"))
                && java.util.Objects.equals(expected.get("referencedConclusion"), actual.get("referencedConclusion"))
                && java.util.Objects.equals(expected.get("ontologyVersionId"), actual.get("ontologyVersionId"));
    }

    private static ExecutionSnapshot withEvents(ExecutionSnapshot snapshot, List<ExecutionEvent> events) {
        return new ExecutionSnapshot(snapshot.executionId(), snapshot.sessionId(), snapshot.ownerUserId(),
                snapshot.followUpId(), snapshot.ontologyVersionId(), snapshot.ontologyVersionBinding(),
                snapshot.status(), snapshot.planSnapshot(), events, snapshot.conclusionState(),
                snapshot.resultBlocks(), snapshot.mobileProjection(), snapshot.failurePoint(), snapshot.errorCode(),
                snapshot.traceId(), snapshot.createdAt(), snapshot.updatedAt());
    }

    private static void requireDispatchUpdate(int changed) {
        if (changed != 1) throw new BackendException("JOB_DISPATCH_STATE_CONFLICT", "任务分发状态更新冲突。");
    }
}
