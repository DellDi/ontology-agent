package com.dip3.ontologyagent.capability.api;

import java.util.Set;

public record CapabilityDescriptor(CapabilityId id, String displayName,
                                   Set<String> supportedOntologyDefinitionKeys,
                                   Set<String> requiredDataProductKeys,
                                   Set<String> requiredEvidenceTypes,
                                   Set<String> allowedClaimKinds,
                                   CapabilityInvocationContract invocationContract) {
    public CapabilityDescriptor {
        if (id == null) throw new IllegalArgumentException("id must not be null");
        if (displayName == null || displayName.isBlank()) {
            throw new IllegalArgumentException("displayName must not be blank");
        }
        supportedOntologyDefinitionKeys = Set.copyOf(supportedOntologyDefinitionKeys);
        requiredDataProductKeys = Set.copyOf(requiredDataProductKeys);
        requiredEvidenceTypes = Set.copyOf(requiredEvidenceTypes);
        allowedClaimKinds = Set.copyOf(allowedClaimKinds);
        if (invocationContract == null) {
            throw new IllegalArgumentException("invocationContract must not be null");
        }
        if (supportedOntologyDefinitionKeys.isEmpty() || requiredEvidenceTypes.isEmpty()
                || allowedClaimKinds.isEmpty()) {
            throw new IllegalArgumentException("capability descriptor contracts must not be empty");
        }
        if (requiredDataProductKeys.stream().anyMatch(key ->
                key == null || !key.matches("[a-z][a-z0-9_-]*"))) {
            throw new IllegalArgumentException("requiredDataProductKeys must contain catalog keys");
        }
    }
}
