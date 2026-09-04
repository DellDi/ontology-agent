package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import java.util.List;

/** Port used by the property follow-up policy to resolve authorized projects. */
public interface PropertyProjectScopeResolver {
  List<String> resolve(AuthSession principal);

  List<ProjectTarget> targets(AuthSession principal);

  record ProjectTarget(String id, String name) {}
}
