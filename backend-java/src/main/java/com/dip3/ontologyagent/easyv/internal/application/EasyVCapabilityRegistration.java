package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityRegistration;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVCapabilityPolicy;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.util.Set;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** EasyV registration is intentionally not a Spring bean until its source adapter is wired. */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVCapabilityRegistration implements CapabilityRegistration {
  public static final CapabilityId ID =
      new CapabilityId(EasyVGenerationOntology.DOMAIN_KEY, EasyVGenerationOntology.CAPABILITY_KEY);
  private static final CapabilityDescriptor DESCRIPTOR =
      new CapabilityDescriptor(
          ID,
          "AI 大屏生成质量分析",
          Set.of(
              EasyVGenerationOntology.ENTITY_KEY,
              EasyVGenerationOntology.METRIC_KEY,
              EasyVGenerationOntology.TIME_KEY),
          Set.of(
              "easyv-ai-application",
              "easyv-pipeline-node",
              "easyv-forge-task",
              "easyv-generation-feedback"),
          Set.of(
              "generation-quality",
              "stage-bottleneck",
              "failure-concentration",
              "feedback-association",
              "business-success-settlement-distinct"),
          EasyVInvocationContract.CONTRACT);
  private final EasyVMainAgent mainAgent;
  private final EasyVScopeResolver scopes;
  private final FollowUpPolicy followUpPolicy;

  public EasyVCapabilityRegistration(EasyVMainAgent mainAgent, EasyVScopeResolver scopes) {
    this.mainAgent = mainAgent;
    this.scopes = scopes;
    this.followUpPolicy = new EasyVFollowUpPolicy();
  }

  @Override
  public CapabilityDescriptor descriptor() {
    return DESCRIPTOR;
  }

  @Override
  public InitialCapabilityCandidate initialQuestionCandidate(String question) {
    return EasyVCapabilityPolicy.supportsInitial(question)
        ? InitialCapabilityCandidate.matched(ID)
        : InitialCapabilityCandidate.notMatched(ID);
  }

  @Override
  public void validateInitialQuestion(String question) {
    if (!EasyVCapabilityPolicy.supportsInitial(question)) {
      throw new BackendException("ANALYSIS_CAPABILITY_UNSUPPORTED", "当前问题不是可执行的 EasyV 大屏生成质量分析问题。");
    }
  }

  @Override
  public FollowUpPolicy followUpPolicy() {
    return followUpPolicy;
  }

  @Override
  public void validateCatalog(OntologyCatalog ontology) {
    EasyVGenerationOntology.validate(
        EasyVGenerationOntology.ENTITY_KEY,
        EasyVGenerationOntology.METRIC_KEY,
        EasyVGenerationOntology.TIME_KEY,
        ontology);
  }

  @Override
  public ResolvedScopeSnapshot resolveScope(AuthSession principal) {
    return scopes.resolveScope(principal);
  }

  @Override
  public void validateScope(ResolvedScopeSnapshot scope, AuthSession principal) {
    scopes.validateScope(scope, principal);
  }

  @Override
  public WorkflowResult execute(CapabilityExecutionContext context) {
    return mainAgent.execute(
        context.principal(),
        context.turn(),
        context.executionId(),
        context.ontology(),
        context.traceId(),
        context.leaseOwner());
  }
}
