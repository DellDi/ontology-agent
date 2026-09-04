package com.dip3.ontologyagent.capability.api;

import java.util.List;

public record CapabilityResult<R, E>(CapabilityBinding binding, String scopeSnapshotRef, R result,
                                     List<CapabilityEvidence<E>> evidence) {
    public CapabilityResult {
        if (binding == null) throw new IllegalArgumentException("binding must not be null");
        if (scopeSnapshotRef == null || scopeSnapshotRef.isBlank()) {
            throw new IllegalArgumentException("scopeSnapshotRef must not be blank");
        }
        if (result == null) throw new IllegalArgumentException("result must not be null");
        evidence = List.copyOf(evidence);
        if (evidence.stream().anyMatch(item -> !binding.equals(item.binding())
                || !scopeSnapshotRef.equals(item.scopeSnapshotRef()))) {
            throw new IllegalArgumentException("evidence must match result binding and scope");
        }
    }
}
