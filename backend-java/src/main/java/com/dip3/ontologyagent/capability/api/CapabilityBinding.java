package com.dip3.ontologyagent.capability.api;

import java.util.Map;

public record CapabilityBinding(CapabilityId id, String ontologyVersionId,
                                ResolvedScopeSnapshot resolvedScope) {
    public CapabilityBinding {
        if (id == null) throw new IllegalArgumentException("id must not be null");
        if (ontologyVersionId == null || ontologyVersionId.isBlank()) {
            throw new IllegalArgumentException("ontologyVersionId must not be blank");
        }
        if (resolvedScope == null) throw new IllegalArgumentException("resolvedScope must not be null");
        if (!id.domainKey().equals(resolvedScope.domainKey())) {
            throw new IllegalArgumentException("capability and scope domain must match");
        }
    }

    public Map<String, Object> snapshot() {
        return Map.of(
                "domainKey", id.domainKey(),
                "capabilityKey", id.capabilityKey(),
                "ontologyVersionId", ontologyVersionId,
                "resolvedScope", Map.of(
                        "domainKey", resolvedScope.domainKey(),
                        "schemaVersion", resolvedScope.schemaVersion(),
                        "values", resolvedScope.values()));
    }

    /**
     * Rehydrates the exact binding persisted at submission time.  This is
     * intentionally strict: callers must not turn a legacy marker into a
     * newly selected capability.
     */
    @SuppressWarnings("unchecked")
    public static CapabilityBinding fromSnapshot(Map<String, Object> raw) {
        if (raw == null) throw new IllegalArgumentException("binding must not be null");
        Object scopeRaw = raw.get("resolvedScope");
        if (!(scopeRaw instanceof Map<?, ?> scope)
                || scope.keySet().stream().anyMatch(key -> !(key instanceof String))) {
            throw new IllegalArgumentException("resolvedScope must be an object");
        }
        Object schemaVersion = scope.get("schemaVersion");
        if (!(schemaVersion instanceof Number version)) {
            throw new IllegalArgumentException("resolvedScope.schemaVersion must be a number");
        }
        Object valuesRaw = scope.get("values");
        if (!(valuesRaw instanceof Map<?, ?> values)
                || values.keySet().stream().anyMatch(key -> !(key instanceof String))) {
            throw new IllegalArgumentException("resolvedScope.values must be an object");
        }
        Map<String, Object> valuesCopy = (Map<String, Object>) values;
        try {
            return new CapabilityBinding(
                    new CapabilityId(text(raw, "domainKey"), text(raw, "capabilityKey")),
                    text(raw, "ontologyVersionId"),
                    new ResolvedScopeSnapshot(text(scope, "domainKey"), version.intValue(), valuesCopy));
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("invalid capability binding", error);
        }
    }

    public static Map<String, Object> legacySnapshot() {
        return Map.of("source", "legacy/unknown");
    }

    public String scopeSnapshotRef(String executionId) {
        if (executionId == null || executionId.isBlank()) {
            throw new IllegalArgumentException("executionId must not be blank");
        }
        return "job:" + executionId + ":capabilityBinding.resolvedScope";
    }

    private static String text(Map<?, ?> source, String key) {
        Object value = source.get(key);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException(key + " must be a non-blank string");
        }
        return text;
    }
}
