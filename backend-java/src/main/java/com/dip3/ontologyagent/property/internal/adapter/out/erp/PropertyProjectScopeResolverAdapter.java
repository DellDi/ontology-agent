package com.dip3.ontologyagent.property.internal.adapter.out.erp;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.property.internal.application.PropertyProjectScopeResolver;
import java.util.List;
import org.springframework.stereotype.Component;

/** Adapts the shared ERP resolver to the property capability's application port. */
@Component
public final class PropertyProjectScopeResolverAdapter implements PropertyProjectScopeResolver {
  private final ScopedProjectResolver delegate;

  public PropertyProjectScopeResolverAdapter(ScopedProjectResolver delegate) {
    this.delegate = delegate;
  }

  @Override
  public List<String> resolve(AuthSession principal) {
    return delegate.resolve(principal);
  }

  @Override
  public List<ProjectTarget> targets(AuthSession principal) {
    return delegate.targets(principal).stream()
        .map(target -> new ProjectTarget(target.id(), target.name()))
        .toList();
  }
}
