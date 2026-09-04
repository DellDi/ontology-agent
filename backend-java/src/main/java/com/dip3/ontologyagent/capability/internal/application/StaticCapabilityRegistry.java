package com.dip3.ontologyagent.capability.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityBinding;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityEvidence;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityRegistration;
import com.dip3.ontologyagent.capability.api.CapabilityRegistry;
import com.dip3.ontologyagent.capability.api.CapabilityResult;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Comparator;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
final class StaticCapabilityRegistry implements CapabilityRegistry {
  private final Map<CapabilityId, CapabilityRegistration> registrations;

  StaticCapabilityRegistry(List<CapabilityRegistration> registrations) {
    Map<CapabilityId, CapabilityRegistration> indexed = new LinkedHashMap<>();
    for (CapabilityRegistration registration : registrations) {
      CapabilityId id = registration.descriptor().id();
      if (indexed.putIfAbsent(id, registration) != null) {
        throw new IllegalStateException("Duplicate capability registration: " + id);
      }
    }
    this.registrations = Map.copyOf(indexed);
  }

  @Override
  public CapabilityId selectInitial(String question) {
    List<CapabilityRegistration> matches =
        registrations.values().stream()
            .filter(
                registration -> {
                  InitialCapabilityCandidate candidate =
                      registration.initialQuestionCandidate(question);
                  if (!registration.descriptor().id().equals(candidate.capabilityId())) {
                    throw new IllegalStateException(
                        "Capability candidate does not match its registration: "
                            + registration.descriptor().id());
                  }
                  return candidate.matched();
                })
            .sorted(
                Comparator.comparing(
                        (CapabilityRegistration registration) ->
                            registration.descriptor().id().domainKey())
                    .thenComparing(
                        registration -> registration.descriptor().id().capabilityKey()))
            .toList();
    if (matches.size() == 1) return matches.get(0).descriptor().id();
    if (matches.size() > 1) {
      throw new BackendException(
          "CAPABILITY_SELECTION_AMBIGUOUS",
          "当前问题匹配多个分析能力："
              + matches.stream()
                  .map(registration -> registration.descriptor().id().toString())
                  .collect(Collectors.joining(", "))
              + "。请明确领域或问题范围。");
    }
    if (registrations.size() == 1) {
      // Preserve the sole domain's established, user-facing rejection semantics.
      registrations.values().iterator().next().validateInitialQuestion(question);
    }
    throw new BackendException("ANALYSIS_CAPABILITY_UNSUPPORTED", "当前问题没有可执行的分析能力。");
  }

  @Override
  public CapabilityBinding bind(
      com.dip3.ontologyagent.capability.api.CapabilityId capabilityId,
      OntologyCatalog ontology,
      AuthSession principal) {
    CapabilityRegistration registration = registration(capabilityId);
    registration.validateCatalog(ontology);
    var scope = registration.resolveScope(principal);
    registration.validateScope(scope, principal);
    return new CapabilityBinding(registration.descriptor().id(), ontology.versionId(), scope);
  }

  @Override
  public CapabilityDescriptor require(
      CapabilityBinding binding, OntologyCatalog ontology, AuthSession principal) {
    return requireRegistration(binding, ontology, principal).descriptor();
  }

  @Override
  public FollowUpPolicy requireFollowUpPolicy(
      CapabilityBinding binding, OntologyCatalog ontology, AuthSession principal) {
    CapabilityRegistration registration = requireRegistration(binding, ontology, principal);
    FollowUpPolicy policy = registration.followUpPolicy();
    if (policy == null) {
      throw new BackendException("FOLLOW_UP_POLICY_UNAVAILABLE", "任务绑定的分析能力未提供追问策略。");
    }
    return policy;
  }

  private CapabilityRegistration requireRegistration(
      CapabilityBinding binding, OntologyCatalog ontology, AuthSession principal) {
    if (binding == null) {
      throw new BackendException("CAPABILITY_BINDING_INVALID", "执行任务缺少能力绑定。");
    }
    if (!binding.ontologyVersionId().equals(ontology.versionId())) {
      throw new BackendException("CAPABILITY_ONTOLOGY_MISMATCH", "任务能力绑定的本体版本与执行版本不一致。");
    }
    CapabilityRegistration registration = registration(binding.id());
    registration.validateCatalog(ontology);
    registration.validateScope(binding.resolvedScope(), principal);
    return registration;
  }

  @Override
  public CapabilityResult<WorkflowResult, Evidence> execute(
      CapabilityBinding binding, CapabilityExecutionContext context) {
    CapabilityDescriptor descriptor = require(binding, context.ontology(), context.principal());
    WorkflowResult result = registrations.get(descriptor.id()).execute(context);
    String scopeSnapshotRef = binding.scopeSnapshotRef(context.executionId());
    List<CapabilityEvidence<Evidence>> evidence =
        result.evidence().stream()
            .map(
                item ->
                    new CapabilityEvidence<>(
                        binding, scopeSnapshotRef, item.source(), item.source(), item))
            .toList();
    return new CapabilityResult<>(binding, scopeSnapshotRef, result, evidence);
  }

  @Override
  public void validateCatalog(OntologyCatalog ontology) {
    if (registrations.isEmpty()) {
      throw new BackendException("CAPABILITY_NOT_REGISTERED", "没有已注册能力可验证本体版本。");
    }
    registrations.values().forEach(registration -> registration.validateCatalog(ontology));
  }

  @Override
  public void validateCatalog(OntologyCatalog ontology, CapabilityId capabilityId) {
    registration(capabilityId).validateCatalog(ontology);
  }

  private CapabilityRegistration registration(CapabilityId capabilityId) {
    CapabilityRegistration registration = registrations.get(capabilityId);
    if (registration == null) {
      throw new BackendException("CAPABILITY_NOT_REGISTERED", "任务绑定的分析能力未注册。");
    }
    return registration;
  }
}
