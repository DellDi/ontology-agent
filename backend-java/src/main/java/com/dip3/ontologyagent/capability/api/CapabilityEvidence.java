package com.dip3.ontologyagent.capability.api;

public record CapabilityEvidence<E>(CapabilityBinding binding, String scopeSnapshotRef,
                                    String evidenceType, String sourceSystem, E payload) {
    public CapabilityEvidence {
        if (binding == null) throw new IllegalArgumentException("binding must not be null");
        if (scopeSnapshotRef == null || scopeSnapshotRef.isBlank()) {
            throw new IllegalArgumentException("scopeSnapshotRef must not be blank");
        }
        if (evidenceType == null || evidenceType.isBlank()) {
            throw new IllegalArgumentException("evidenceType must not be blank");
        }
        if (sourceSystem == null || sourceSystem.isBlank()) {
            throw new IllegalArgumentException("sourceSystem must not be blank");
        }
        if (payload == null) throw new IllegalArgumentException("payload must not be null");
    }
}
