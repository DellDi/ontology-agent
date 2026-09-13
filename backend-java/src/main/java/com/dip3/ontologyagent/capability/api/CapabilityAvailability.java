package com.dip3.ontologyagent.capability.api;

/** Registered capability and current principal's authorization, not execution/data readiness. */
public record CapabilityAvailability(
    String domainKey, String capabilityKey, String displayName, boolean available,
    String unavailableReason, String exampleQuestion, ResolvedScopeSnapshot resolvedScope) {}
