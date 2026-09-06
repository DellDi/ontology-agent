package com.dip3.ontologyagent.ingestion.api;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Public SPI implemented by a reviewed Domain Data Pack to publish one typed
 * canonical relation. Implementations are trusted application code; catalog
 * definitions never contain executable SQL or scripts.
 */
public interface CanonicalProductTransform {
    String transformRef();

    PreparedProduct prepare(Context context);

    record Context(DataProductDefinition product, String productVersionId,
                   Map<String, SourceInput> inputs) {
        public Context {
            if (product == null) throw new IllegalArgumentException("product must not be null");
            if (productVersionId == null || productVersionId.isBlank()) {
                throw new IllegalArgumentException("productVersionId must not be blank");
            }
            if (inputs == null || inputs.entrySet().stream().anyMatch(entry ->
                    entry.getKey() == null || entry.getValue() == null
                            || !entry.getKey().equals(entry.getValue().input().inputKey()))) {
                throw new IllegalArgumentException("inputs must be keyed by inputKey");
            }
            inputs = Map.copyOf(new LinkedHashMap<>(inputs));
        }
    }

    record SourceInput(DataProductInput input, DatasetDefinition dataset,
                       String sourceVersionId, List<SourceRow> rows) {
        public SourceInput {
            if (input == null || dataset == null) {
                throw new IllegalArgumentException("input and dataset must not be null");
            }
            if (!input.datasetKey().equals(dataset.datasetKey())) {
                throw new IllegalArgumentException("input dataset does not match its definition");
            }
            if (sourceVersionId == null || sourceVersionId.isBlank()) {
                throw new IllegalArgumentException("sourceVersionId must not be blank");
            }
            if (rows == null || rows.stream().anyMatch(row -> row == null)) {
                throw new IllegalArgumentException("rows must not contain null");
            }
            rows = List.copyOf(rows);
        }
    }

    record PreparedProduct(String storageRef, long rowCount, String contentHash,
                           CanonicalWrite canonicalWrite) {
        public PreparedProduct {
            if (storageRef == null || storageRef.isBlank()) {
                throw new IllegalArgumentException("storageRef must not be blank");
            }
            if (rowCount < 0) throw new IllegalArgumentException("rowCount must not be negative");
            if (contentHash == null || contentHash.isBlank()) {
                throw new IllegalArgumentException("contentHash must not be blank");
            }
            if (canonicalWrite == null) {
                throw new IllegalArgumentException("canonicalWrite must not be null");
            }
        }
    }

    /** Typed canonical-table write executed inside the platform publication transaction. */
    @FunctionalInterface
    interface CanonicalWrite {
        void execute();
    }
}
