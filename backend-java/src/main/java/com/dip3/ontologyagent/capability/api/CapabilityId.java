package com.dip3.ontologyagent.capability.api;

public record CapabilityId(String domainKey, String capabilityKey) {
    public CapabilityId {
        domainKey = requireText(domainKey, "domainKey");
        capabilityKey = requireText(capabilityKey, "capabilityKey");
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
