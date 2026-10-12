package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

/** Durable command/audit boundary; retries are new requests, never implicit re-execution. */
public interface IngestionReleasePort {
    record Task(String id, String sourceKey, List<String> productKeys, String mode, String triggerType,
                String status, String retryOf, String requestedBy, String correlationId, String errorCode,
                Instant createdAt, Instant startedAt, Instant finishedAt) {}
    /** Exactly one side is set: the enqueued (or already enqueued) task, or the active task that made this fire redundant. */
    record ScheduledSubmission(Task task, String blockedBy) {}
    Optional<Task> find(String id);
    List<Task> recent();
    Task submit(String id, String sourceKey, List<String> products, String mode, String retryOf,
                AuthSession actor, String correlationId);
    /**
     * System-owned enqueue for one schedule fire. Replays of the same id return the original task; an equivalent
     * pending/running task (same source, products and mode) is never stacked and is audited as skipped instead.
     */
    ScheduledSubmission submitScheduled(String id, String scheduleName, Instant fireTime, String sourceKey,
                                        List<String> products, String mode);
    /** Serializes web releases across workers. A running task is handed back for interruption reconciliation. */
    void withNext(Consumer<Task> work);
    void start(String id);
    void finish(String id, String errorCode);
    /** Reconciles durable publication first, otherwise closes only this task's unfinished child runs. */
    void recover(String id, String errorCode);
}
