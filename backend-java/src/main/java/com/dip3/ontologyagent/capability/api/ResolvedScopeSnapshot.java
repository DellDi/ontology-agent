package com.dip3.ontologyagent.capability.api;

import java.util.Map;

public record ResolvedScopeSnapshot(String domainKey, int schemaVersion, Map<String, Object> values) {
    public ResolvedScopeSnapshot {
        if (domainKey == null || domainKey.isBlank()) {
            throw new IllegalArgumentException("domainKey must not be blank");
        }
        if (schemaVersion < 1) throw new IllegalArgumentException("schemaVersion must be positive");
        values = Map.copyOf(values);
        if (values.isEmpty()) throw new IllegalArgumentException("resolved scope must not be empty");
    }
}
