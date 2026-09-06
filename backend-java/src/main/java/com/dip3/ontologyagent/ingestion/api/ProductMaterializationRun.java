package com.dip3.ontologyagent.ingestion.api;

import java.time.Instant;
import java.util.Map;

/** Immutable audit state for one product materialization attempt. */
public record ProductMaterializationRun(
        String id, String productKey, Mode mode, Status status,
        TriggerType triggerType, String triggeredBy, String correlationId,
        Map<String, String> inputSummary,
        Map<String, Long> rowCounts, String errorCode,
        Map<String, Object> errorDetail, Instant startedAt, Instant finishedAt,
        Instant createdAt, Instant updatedAt) {
    public ProductMaterializationRun {
        id = ValueChecks.opaqueId(id, "id");
        productKey = ValueChecks.catalogKey(productKey, "productKey");
        if (mode == null) throw new IllegalArgumentException("mode must not be null");
        if (status == null) throw new IllegalArgumentException("status must not be null");
        if (triggerType == null) throw new IllegalArgumentException("triggerType must not be null");
        if (triggeredBy != null && triggeredBy.isBlank()) {
            throw new IllegalArgumentException("triggeredBy must not be blank when supplied");
        }
        if (correlationId != null && correlationId.isBlank()) {
            throw new IllegalArgumentException("correlationId must not be blank when supplied");
        }
        inputSummary = ValueChecks.catalogToOpaqueMap(inputSummary, "inputSummary");
        rowCounts = ValueChecks.nonNegativeCounts(rowCounts, "rowCounts");
        if (errorCode != null && errorCode.isBlank()) {
            throw new IllegalArgumentException("errorCode must not be blank when supplied");
        }
        if (errorDetail != null) errorDetail = ValueChecks.objectMap(errorDetail, "errorDetail");
        if (startedAt != null && finishedAt != null && finishedAt.isBefore(startedAt)) {
            throw new IllegalArgumentException("finishedAt must not be before startedAt");
        }
        if (status.terminal() && finishedAt == null) {
            throw new IllegalArgumentException("finishedAt is required for terminal runs");
        }
        if (!status.terminal() && finishedAt != null) {
            throw new IllegalArgumentException("finishedAt is not allowed for non-terminal runs");
        }
        if (status == Status.RUNNING && startedAt == null) {
            throw new IllegalArgumentException("startedAt is required for running runs");
        }
        if (status == Status.FAILED
                && (errorCode == null || errorCode.isBlank())
                && (errorDetail == null || errorDetail.isEmpty())) {
            throw new IllegalArgumentException("failed runs require errorCode or errorDetail");
        }
        if (createdAt == null) throw new IllegalArgumentException("createdAt must not be null");
        if (updatedAt == null) throw new IllegalArgumentException("updatedAt must not be null");
        if (updatedAt.isBefore(createdAt)) {
            throw new IllegalArgumentException("updatedAt must not be before createdAt");
        }
    }

    /** Typed interpretation of input_summary: input key to source version id. */
    public Map<String, String> sourceDatasetVersionIds() {
        return inputSummary;
    }

    public enum Mode {
        FULL,
        INCREMENTAL,
        RECONCILE
    }

    public enum Status {
        PENDING(false),
        RUNNING(false),
        COMPLETED(true),
        FAILED(true),
        CANCELLED(true);

        private final boolean terminal;

        Status(boolean terminal) {
            this.terminal = terminal;
        }

        public boolean terminal() {
            return terminal;
        }
    }

    public enum TriggerType {
        MANUAL,
        SCHEDULED,
        BOOTSTRAP,
        RETRY
    }
}
