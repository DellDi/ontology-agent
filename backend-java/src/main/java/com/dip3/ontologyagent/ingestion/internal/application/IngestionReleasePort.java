package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.function.Consumer;

/** Durable command/audit boundary; retries are new requests, never implicit re-execution. */
public interface IngestionReleasePort {
    record Task(String id, String sourceKey, List<String> productKeys, String mode, String status,
                String retryOf, String requestedBy, String correlationId, String errorCode,
                Instant createdAt, Instant startedAt, Instant finishedAt) {}
    Optional<Task> find(String id);
    List<Task> recent();
    Task submit(String id, String sourceKey, List<String> products, String mode, String retryOf,
                AuthSession actor, String correlationId);
    /** Serializes web releases across workers. A running task is handed back for interruption reconciliation. */
    void withNext(Consumer<Task> work);
    void start(String id);
    void finish(String id, String errorCode);
    /** Reconciles durable publication first, otherwise closes only this task's unfinished child runs. */
    void recover(String id, String errorCode);
}
