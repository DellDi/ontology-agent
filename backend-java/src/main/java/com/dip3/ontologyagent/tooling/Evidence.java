package com.dip3.ontologyagent.tooling;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Grounded evidence with the frozen Ontology and Dataset Version provenance required to replay it. */
public record Evidence(String source, String title, List<Map<String, Object>> rows, Provenance provenance) {
    public Evidence {
        if (source == null || source.isBlank()) {
            throw new IllegalArgumentException("evidence source must not be blank");
        }
        if (title == null || title.isBlank()) {
            throw new IllegalArgumentException("evidence title must not be blank");
        }
        if (rows == null || rows.stream().anyMatch(Objects::isNull)) {
            throw new IllegalArgumentException("evidence rows must not contain null");
        }
        rows = List.copyOf(rows);
        if (provenance == null) {
            throw new IllegalArgumentException("evidence provenance must not be null");
        }
    }

    public static List<Map<String, Object>> projection(List<Evidence> evidence) {
        return evidence.stream().map(item -> {
            Map<String, Object> projected = new LinkedHashMap<>();
            projected.put("source", item.source());
            projected.put("title", item.title());
            projected.put("rowCount", item.rows().size());
            projected.put("rows", item.rows());
            projected.put("ontologyVersionId", item.provenance().ontologyVersionId());
            projected.put("datasetVersionSetId", item.provenance().datasetVersionSetId());
            projected.put("freshnessAt", item.provenance().freshnessAt().toString());
            projected.put("productVersionIds", item.provenance().productVersionIds());
            return Map.copyOf(projected);
        }).toList();
    }

    /** Frozen catalog and product versions that produced this evidence. */
    public record Provenance(String ontologyVersionId, String datasetVersionSetId, Instant freshnessAt,
                             Map<String, String> productVersionIds) {
        public Provenance {
            if (ontologyVersionId == null || ontologyVersionId.isBlank()) {
                throw new IllegalArgumentException("ontologyVersionId must not be blank");
            }
            if (datasetVersionSetId == null || datasetVersionSetId.isBlank()) {
                throw new IllegalArgumentException("datasetVersionSetId must not be blank");
            }
            if (freshnessAt == null) {
                throw new IllegalArgumentException("freshnessAt must not be null");
            }
            if (productVersionIds == null || productVersionIds.isEmpty()) {
                throw new IllegalArgumentException("productVersionIds must not be empty");
            }
            Map<String, String> copy = new LinkedHashMap<>();
            for (Map.Entry<String, String> entry : productVersionIds.entrySet()) {
                if (entry.getKey() == null || entry.getKey().isBlank()
                        || entry.getValue() == null || entry.getValue().isBlank()) {
                    throw new IllegalArgumentException("productVersionIds must contain catalog keys");
                }
                copy.put(entry.getKey(), entry.getValue());
            }
            productVersionIds = Map.copyOf(copy);
        }
    }
}
