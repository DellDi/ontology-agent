package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ExecutionProgress;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryCompiler;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVInvocationContract;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

class EasyVCapabilityRegistrationTest {
  private final EasyVMainAgent mainAgent = mock(EasyVMainAgent.class);
  private final IdentityAccountService accounts = mock(IdentityAccountService.class);
  private final EasyVScopeResolver scopes = new EasyVScopeResolver(accounts);
  private final SemanticModel semantic = SemanticModel.discover();
  private final EasyVCapabilityRegistration registration =
      new EasyVCapabilityRegistration(mainAgent, scopes, semantic, new SemanticQueryCompiler(semantic), org.mockito.Mockito.mock(EasyVObjectSelectionService.class));
  private final AuthSession owner =
      new AuthSession(
          "auth-1",
          "123",
          "用户",
          new AccessScope("org-1", List.of(), List.of(), List.of(EasyVScopeResolver.REQUIRED_ROLE)),
          Instant.MAX);

  @Test
  void descriptorFreezesTheEasyVReadOnlyContract() {
    assertEquals(EasyVCapabilityRegistration.ID, registration.descriptor().id());
    assertEquals(
        List.of("easyv-ai-application", "easyv-generation-quality", "easyv-generation-time"),
        registration.descriptor().supportedOntologyDefinitionKeys().stream().sorted().toList());
    assertEquals(Set.of("easyv-data-scope"), registration.descriptor().requiredEvidenceTypes());
    assertEquals(Set.of("direct-answer"), registration.descriptor().allowedClaimKinds());
    assertEquals(EasyVInvocationContract.CONTRACT, registration.descriptor().invocationContract());
    assertEquals(EasyVInvocationContract.TOOL_NAME, registration.descriptor().invocationContract().toolName());
    assertEquals(1, registration.descriptor().invocationContract().exactCount());
    assertSame(registration.followUpPolicy(), registration.followUpPolicy());
  }

  @Test
  void initialQuestionUsesTheEasyVPolicyAndExcludesPropertyQuestions() {
    assertEquals(
        InitialCapabilityCandidate.matched(EasyVCapabilityRegistration.ID),
        registration.initialQuestionCandidate("分析 EasyV 大屏生成质量"));
    assertEquals(
        InitialCapabilityCandidate.notMatched(EasyVCapabilityRegistration.ID),
        registration.initialQuestionCandidate("分析项目收缴率"));
    registration.validateInitialQuestion("分析 EasyV 大屏生成质量");
    assertEquals(
        "ANALYSIS_CAPABILITY_UNSUPPORTED",
        assertThrows(
                BackendException.class,
                () -> registration.validateInitialQuestion("分析项目收缴率"))
            .code());
  }

  @Test
  void scopeAndCatalogValidationUseTheTypedEasyVBoundaries() {
    when(accounts.subjectValue(123L, "easyv", "userId")).thenReturn(Optional.of("16"));
    ResolvedScopeSnapshot resolved = registration.resolveScope(owner);
    assertEquals(Map.of("userId", "123", "accessMode", "scoped", "easyvUserId", "16"), resolved.values());
    registration.validateScope(resolved, owner);
    registration.validateCatalog(ontology());

    assertEquals(
        "EASYV_SCOPE_FORBIDDEN",
        assertThrows(
                BackendException.class,
                () -> registration.resolveScope(principalWithoutEasyVRole()))
            .code());
    assertEquals(
        "EASYV_ONTOLOGY_SEMANTICS_UNSUPPORTED",
        assertThrows(
                BackendException.class,
                () -> registration.validateCatalog(new OntologyCatalog("v2", "2.0.0", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of())))
            .code());
  }

  @Test
  void executeDelegatesWithoutRewritingTheEasyVMainAgentContract() {
    OntologyCatalog ontology = ontology();
    AgentTurn turn =
        new AgentTurn(
            "java-initial-v1", "session-1", "分析 EasyV 大屏生成质量", null, null, Map.of(), Map.of(), Instant.now());
    WorkflowResult expected = new WorkflowResult(Map.of(), List.of(), "result", List.of(), List.of());
    ResolvedScopeSnapshot scope = new ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "123", "accessMode", "all"));
    when(mainAgent.execute(owner, turn, "execution-1", ontology, "easyv-set-1", scope, "trace-1", "worker-1",
        ExecutionProgress.NOOP)).thenReturn(expected);

    WorkflowResult actual =
        registration.execute(new CapabilityExecutionContext(owner, turn, "execution-1", ontology,
            "easyv-set-1", "trace-1", "worker-1"), scope);

    assertSame(expected, actual);
    verify(mainAgent).execute(owner, turn, "execution-1", ontology, "easyv-set-1", scope, "trace-1", "worker-1",
        ExecutionProgress.NOOP);
  }

  private static OntologyCatalog ontology() {
    return new OntologyCatalog(
        "easyv-v2",
        "2.0.0",
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.ENTITY_KEY, "AI 应用", Map.of())),
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.METRIC_KEY, "生成质量", Map.of())),
        List.of(),
        List.of(),
        List.of(new OntologyCatalog.Item(EasyVGenerationOntology.TIME_KEY, "源事件时间", Map.of())),
        List.of(),
        List.of());
  }

  private static AuthSession principalWithoutEasyVRole() {
    return new AuthSession(
        "auth-2", "123", "用户", new AccessScope("org-1", List.of(), List.of(), List.of()), Instant.MAX);
  }
}
