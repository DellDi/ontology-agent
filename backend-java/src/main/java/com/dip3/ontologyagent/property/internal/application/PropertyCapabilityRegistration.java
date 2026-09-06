package com.dip3.ontologyagent.property.internal.application;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityRegistration;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.property.internal.domain.AnalysisCapabilityPolicy;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.PropertyInvocationContract;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
final class PropertyCapabilityRegistration implements CapabilityRegistration {
  static final CapabilityId ID = new CapabilityId("property", "collection-rate-analysis");
  private static final int SCOPE_SCHEMA_VERSION = 1;
  private static final Set<String> SCOPE_FIELDS = Set.of("organizationId", "projectIds", "areaIds");
  private static final CapabilityDescriptor DESCRIPTOR =
      new CapabilityDescriptor(
          ID,
          "物业项目收缴率分析",
          Set.of(
              AnalysisRuntimeCapability.ENTITY_KEY,
              AnalysisRuntimeCapability.METRIC_DEFINITION_KEY,
              AnalysisRuntimeCapability.METRIC_VARIANT_KEY,
              AnalysisRuntimeCapability.NUMERATOR_METRIC_VARIANT_KEY,
              AnalysisRuntimeCapability.DENOMINATOR_METRIC_VARIANT_KEY,
              AnalysisRuntimeCapability.TIME_SEMANTIC_KEY,
              AnalysisRuntimeCapability.PAYMENT_TIME_SEMANTIC_KEY),
          PropertyDataProducts.REQUIRED,
          Set.of("erp-staging", "cube", "neo4j"),
          Set.of("collection-rate", "erp-balance", "charge-structure"),
          PropertyInvocationContract.CONTRACT);
  private final MainAgent mainAgent;
  private final FollowUpPolicy followUpPolicy;

  @Autowired
  public PropertyCapabilityRegistration(
      MainAgent mainAgent, PropertyProjectScopeResolver scopedProjects) {
    this.mainAgent = mainAgent;
    this.followUpPolicy = new PropertyFollowUpPolicy(scopedProjects);
  }

  @Override
  public CapabilityDescriptor descriptor() {
    return DESCRIPTOR;
  }

  @Override
  public InitialCapabilityCandidate initialQuestionCandidate(String question) {
    return !AnalysisCapabilityPolicy.unsupportedBusinessScope(question)
                && AnalysisCapabilityPolicy.supportsInitialCollectionRate(question)
            ? InitialCapabilityCandidate.matched(ID)
            : InitialCapabilityCandidate.notMatched(ID);
  }

  @Override
  public void validateInitialQuestion(String question) {
    if (AnalysisCapabilityPolicy.unsupportedBusinessScope(question)) {
      throw new BackendException(
          "UNSUPPORTED_ANALYSIS_SCOPE",
          "当前版本仅支持物业分析场景，暂不支持客服系统、CRM、营销、呼叫中心等业务。请聚焦收费、工单、投诉、满意度等物业数据问题。");
    }
    if (!AnalysisCapabilityPolicy.supportsInitialCollectionRate(question)) {
      throw new BackendException(
          "ANALYSIS_CAPABILITY_UNSUPPORTED", "当前 Java 首次分析仅支持项目收缴率，请明确提出收缴率、收费率或回款率问题。");
    }
  }

  @Override
  public FollowUpPolicy followUpPolicy() {
    return followUpPolicy;
  }

  @Override
  public void validateCatalog(OntologyCatalog ontology) {
    AnalysisWorkflow.validateCatalog(ontology);
  }

  @Override
  public ResolvedScopeSnapshot resolveScope(AuthSession principal) {
    AccessScope scope = principal.scope();
    return new ResolvedScopeSnapshot(
        ID.domainKey(),
        SCOPE_SCHEMA_VERSION,
        Map.of(
            "organizationId", scope.organizationId(),
            "projectIds", scope.projectIds(),
            "areaIds", scope.areaIds()));
  }

  @Override
  public void validateScope(ResolvedScopeSnapshot snapshot, AuthSession principal) {
    AccessScope actual = principal.scope();
    Map<String, Object> values = snapshot.values();
    boolean valid =
        ID.domainKey().equals(snapshot.domainKey())
            && snapshot.schemaVersion() == SCOPE_SCHEMA_VERSION
            && values.keySet().equals(SCOPE_FIELDS)
            && actual.organizationId().equals(values.get("organizationId"))
            && actual.projectIds().equals(stringList(values.get("projectIds")))
            && actual.areaIds().equals(stringList(values.get("areaIds")))
            && (!actual.projectIds().isEmpty() || !actual.areaIds().isEmpty());
    if (!valid) {
      throw new BackendException("CAPABILITY_SCOPE_INVALID", "物业能力绑定的授权范围快照无效。");
    }
  }

  @Override
  public WorkflowResult execute(CapabilityExecutionContext context) {
    return mainAgent.execute(
        context.principal(),
        context.turn(),
        context.executionId(),
        context.ontology(),
        context.datasetVersionSetId(),
        context.traceId(),
        context.leaseOwner());
  }

  private static List<String> stringList(Object value) {
    if (!(value instanceof List<?> items)
        || items.stream().anyMatch(item -> !(item instanceof String text) || text.isBlank())) {
      return List.of();
    }
    return items.stream().map(String.class::cast).toList();
  }
}
