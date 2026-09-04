package com.dip3.ontologyagent.capability.api;

/**
 * A registration's deterministic answer to whether it can own an initial question.
 *
 * <p>Matching must not use domain validation exceptions as control flow. The registry
 * aggregates these decisions and only then produces a binding or a stable selection error.
 */
public record InitialCapabilityCandidate(CapabilityId capabilityId, boolean matched) {
  public InitialCapabilityCandidate {
    if (capabilityId == null) {
      throw new IllegalArgumentException("capabilityId must not be null");
    }
  }

  public static InitialCapabilityCandidate matched(CapabilityId capabilityId) {
    return new InitialCapabilityCandidate(capabilityId, true);
  }

  public static InitialCapabilityCandidate notMatched(CapabilityId capabilityId) {
    return new InitialCapabilityCandidate(capabilityId, false);
  }
}
