package com.dip3.ontologyagent.property.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.property.internal.adapter.out.llm.SpringAiMainAgent;
import com.dip3.ontologyagent.property.internal.adapter.out.llm.WorkflowToolInput;
import com.dip3.ontologyagent.property.internal.domain.PropertyInvocationContract;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.annotation.Tool;

class PropertyCapabilityRegistrationTest {
  private final MainAgent mainAgent = mock(MainAgent.class);
  private final PropertyProjectScopeResolver scopedProjects =
      mock(PropertyProjectScopeResolver.class);
  private final PropertyCapabilityRegistration registration =
      new PropertyCapabilityRegistration(mainAgent, scopedProjects);
  private final AuthSession owner =
      new AuthSession(
          "auth-1",
          "user-1",
          "用户",
          new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")),
          Instant.MAX);

  @Test
  void descriptorFreezesThePropertyCapabilityBoundary() {
    assertEquals(PropertyCapabilityRegistration.ID, registration.descriptor().id());
    assertEquals(
        List.of("cube", "erp-staging", "neo4j"),
        registration.descriptor().requiredEvidenceTypes().stream().sorted().toList());
    assertEquals(
        List.of("charge-structure", "collection-rate", "erp-balance"),
        registration.descriptor().allowedClaimKinds().stream().sorted().toList());
    assertEquals("workflow-tool", registration.descriptor().invocationContract().invocationType());
    assertEquals("analysis_workflow", registration.descriptor().invocationContract().toolName());
    assertEquals(1, registration.descriptor().invocationContract().exactCount());
    assertEquals(
        "workflowInvocations",
        registration.descriptor().invocationContract().completionMetricKey());
  }

  @Test
  void descriptorAndSpringAiToolUseTheSamePropertyInvocationContract()
      throws NoSuchMethodException {
    Method toolMethod =
        SpringAiMainAgent.BoundWorkflowTool.class.getDeclaredMethod("run", WorkflowToolInput.class);
    Tool tool = toolMethod.getAnnotation(Tool.class);

    assertEquals(
        PropertyInvocationContract.CONTRACT, registration.descriptor().invocationContract());
    assertEquals(PropertyInvocationContract.CONTRACT.toolName(), tool.name());
  }

  @Test
  void scopeSnapshotMustMatchTheTrustedPrincipal() {
    ResolvedScopeSnapshot resolved = registration.resolveScope(owner);
    registration.validateScope(resolved, owner);
    ResolvedScopeSnapshot tampered =
        new ResolvedScopeSnapshot(
            "property",
            1,
            Map.of(
                "organizationId",
                "org-1",
                "projectIds",
                List.of("project-2"),
                "areaIds",
                List.of()));

    BackendException error =
        assertThrows(BackendException.class, () -> registration.validateScope(tampered, owner));

    assertEquals("CAPABILITY_SCOPE_INVALID", error.code());
  }

  @Test
  void catalogValidationDelegatesToTheExistingPropertyWorkflowContract() {
    OntologyCatalog invalid =
        new OntologyCatalog(
            "ontology-1",
            "1.0.0",
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of());

    BackendException error =
        assertThrows(BackendException.class, () -> registration.validateCatalog(invalid));

    assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", error.code());
  }

  @Test
  void questionEligibilityPreservesThePropertyCapabilityErrors() {
    assertEquals(
        InitialCapabilityCandidate.notMatched(PropertyCapabilityRegistration.ID),
        registration.initialQuestionCandidate("分析 CRM 客服转化率"));
    assertEquals(
        InitialCapabilityCandidate.matched(PropertyCapabilityRegistration.ID),
        registration.initialQuestionCandidate("分析项目收缴率"));
    assertEquals(
        "UNSUPPORTED_ANALYSIS_SCOPE",
        assertThrows(
                BackendException.class, () -> registration.validateInitialQuestion("分析 CRM 客服转化率"))
            .code());
    assertEquals(
        "ANALYSIS_CAPABILITY_UNSUPPORTED",
        assertThrows(BackendException.class, () -> registration.validateInitialQuestion("分析投诉量"))
            .code());
    assertEquals(
        "FOLLOW_UP_CAPABILITY_UNSUPPORTED",
        assertThrows(
                BackendException.class,
                () -> registration.followUpPolicy().validateQuestion("那尾欠收缴率呢"))
            .code());

    registration.validateInitialQuestion("分析项目收缴率");
    registration.followUpPolicy().validateQuestion("为什么下降");
  }

  @Test
  void executionDelegatesToTheExistingMainAgentWithoutRewritingPropertyBehavior() {
    OntologyCatalog ontology =
        new OntologyCatalog(
            "ontology-1",
            "1.0.0",
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of());
    AgentTurn turn =
        new AgentTurn(
            "java-initial-v1",
            "session-1",
            "分析项目收缴率",
            null,
            null,
            Map.of(),
            Map.of(),
            Instant.now());
    WorkflowResult expected =
        new WorkflowResult(Map.of(), List.of(), "result", List.of(), List.of());
    when(mainAgent.execute(owner, turn, "execution-1", ontology, "trace-1", "worker-1"))
        .thenReturn(expected);
    CapabilityExecutionContext context =
        new CapabilityExecutionContext(owner, turn, "execution-1", ontology, "trace-1", "worker-1");

    assertEquals(expected, registration.execute(context));
    verify(mainAgent).execute(owner, turn, "execution-1", ontology, "trace-1", "worker-1");
  }
}
