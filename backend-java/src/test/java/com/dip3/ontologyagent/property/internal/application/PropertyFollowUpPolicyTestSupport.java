package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.capability.api.FollowUpPolicy;

/** Test-only factory that keeps follow-up characterization tests on the real property policy. */
public final class PropertyFollowUpPolicyTestSupport {
  private PropertyFollowUpPolicyTestSupport() {}

  public static FollowUpPolicy policy(PropertyProjectScopeResolver scopedProjects) {
    return new PropertyFollowUpPolicy(scopedProjects);
  }
}
