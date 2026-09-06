package com.dip3.ontologyagent.capability.internal.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.agent.AgentTurn;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityDescriptor;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.CapabilityId;
import com.dip3.ontologyagent.capability.api.CapabilityInvocationContract;
import com.dip3.ontologyagent.capability.api.CapabilityRegistration;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.capability.api.InitialCapabilityCandidate;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.WorkflowResult;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class StaticCapabilityRegistryTest {
  private static final OntologyCatalog ONTOLOGY =
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
  private static final AuthSession OWNER =
      new AuthSession(
          "auth-1",
          "user-1",
          "用户",
          new AccessScope("org-1", List.of("project-1"), List.of(), List.of()),
          Instant.MAX);

  @Test
  void selectsAndBindsTheMatchedCapability() {
    FakeRegistration registration = new FakeRegistration("property", "collection-rate-analysis");
    StaticCapabilityRegistry registry = new StaticCapabilityRegistry(List.of(registration));

    assertEquals(registration.descriptor().id(), registry.selectInitial("supported"));
    var binding = registry.bind(registration.descriptor().id(), ONTOLOGY, OWNER);

    assertEquals(registration.descriptor(), registry.require(binding, ONTOLOGY, OWNER));
    assertEquals("ontology-1", binding.ontologyVersionId());
    assertEquals("org-1", binding.resolvedScope().values().get("organizationId"));
  }

  @Test
  void zeroOrMultipleCandidatesNeverSelectAHiddenDefault() {
    BackendException empty =
        assertThrows(
            BackendException.class,
            () -> new StaticCapabilityRegistry(List.of()).selectInitial("supported"));
    BackendException ambiguous =
        assertThrows(
            BackendException.class,
            () ->
                new StaticCapabilityRegistry(
                        List.of(
                            new FakeRegistration("property", "collection-rate-analysis", true),
                            new FakeRegistration("test", "second", true)))
                    .selectInitial("supported"));

    assertEquals("ANALYSIS_CAPABILITY_UNSUPPORTED", empty.code());
    assertEquals("CAPABILITY_SELECTION_AMBIGUOUS", ambiguous.code());
  }

  @Test
  void unmatchedCandidatesReturnUnsupportedWithoutUsingValidationExceptionsToMatch() {
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(
            List.of(
                new FakeRegistration("property", "collection-rate-analysis", false),
                new FakeRegistration("test", "second", false)));

    BackendException error =
        assertThrows(BackendException.class, () -> registry.selectInitial("unsupported"));

    assertEquals("ANALYSIS_CAPABILITY_UNSUPPORTED", error.code());
  }

  @Test
  void selectedCapabilityIsStableWhenRegistrationOrderChanges() {
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(
            List.of(
                new FakeRegistration("test", "second", false),
                new FakeRegistration("property", "collection-rate-analysis", true)));

    assertEquals(
        new CapabilityId("property", "collection-rate-analysis"),
        registry.selectInitial("supported"));
  }

  @Test
  void duplicateRegistrationFailsApplicationStartup() {
    FakeRegistration first = new FakeRegistration("property", "collection-rate-analysis");
    FakeRegistration duplicate = new FakeRegistration("property", "collection-rate-analysis");

    assertThrows(
        IllegalStateException.class, () -> new StaticCapabilityRegistry(List.of(first, duplicate)));
  }

  @Test
  void missingCapabilityAndOntologyDriftFailLoud() {
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(
            List.of(new FakeRegistration("property", "collection-rate-analysis")));
    var binding = registry.bind(registrationId("property", "collection-rate-analysis"), ONTOLOGY, OWNER);
    var unknown =
        new com.dip3.ontologyagent.capability.api.CapabilityBinding(
            new CapabilityId("unknown", "unknown"),
            "ontology-1",
            new ResolvedScopeSnapshot("unknown", 1, Map.of("organizationId", "org-1")));
    var drifted =
        new OntologyCatalog(
            "ontology-2",
            "1.0.1",
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of(),
            List.of());

    BackendException missing =
        assertThrows(BackendException.class, () -> registry.require(unknown, ONTOLOGY, OWNER));
    BackendException mismatch =
        assertThrows(BackendException.class, () -> registry.require(binding, drifted, OWNER));

    assertEquals("CAPABILITY_NOT_REGISTERED", missing.code());
    assertEquals("CAPABILITY_ONTOLOGY_MISMATCH", mismatch.code());
  }

  @Test
  void executionIsDispatchedByTheImmutableBindingAndCarriesItsScopeReference() {
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(
            List.of(new FakeRegistration("property", "collection-rate-analysis")));
    var binding = registry.bind(registrationId("property", "collection-rate-analysis"), ONTOLOGY, OWNER);
    AgentTurn turn =
        new AgentTurn(
            ExecutionRepository.EXECUTION_CONTRACT,
            "session-1",
            "分析项目收缴率",
            null,
            null,
            Map.of(),
            Map.of(),
            Instant.now());

    var result =
        registry.execute(
            binding,
            new CapabilityExecutionContext(
                OWNER, turn, "execution-1", ONTOLOGY, "trace-1", "worker-1"));

    assertEquals(binding, result.binding());
    assertEquals(binding.scopeSnapshotRef("execution-1"), result.scopeSnapshotRef());
    assertEquals("result", result.result().conclusion());
  }

  @Test
  void nullBindingFailsBeforeCapabilityExecution() {
    StaticCapabilityRegistry registry =
        new StaticCapabilityRegistry(
            List.of(new FakeRegistration("property", "collection-rate-analysis")));
    CapabilityExecutionContext context =
        new CapabilityExecutionContext(
            OWNER,
            new AgentTurn(
                ExecutionRepository.EXECUTION_CONTRACT,
                "session-1",
                "分析项目收缴率",
                null,
                null,
                Map.of(),
                Map.of(),
                Instant.now()),
            "execution-1",
            ONTOLOGY,
            "trace-1",
            "worker-1");

    BackendException error =
        assertThrows(BackendException.class, () -> registry.execute(null, context));

    assertEquals("CAPABILITY_BINDING_INVALID", error.code());
  }

  private static CapabilityId registrationId(String domainKey, String capabilityKey) {
    return new CapabilityId(domainKey, capabilityKey);
  }

  private static final class FakeRegistration implements CapabilityRegistration {
    private final CapabilityDescriptor descriptor;
    private final boolean matched;

    private FakeRegistration(String domainKey, String capabilityKey) {
      this(domainKey, capabilityKey, true);
    }

    private FakeRegistration(String domainKey, String capabilityKey, boolean matched) {
      descriptor =
          new CapabilityDescriptor(
              new CapabilityId(domainKey, capabilityKey),
              capabilityKey,
              Set.of("definition"),
              Set.of(),
              Set.of("evidence"),
              Set.of("claim"),
              new CapabilityInvocationContract(
                  "test-invocation", "test-tool", 1, "Test Agent", "Test Tool", "testInvocations"));
      this.matched = matched;
    }

    @Override
    public CapabilityDescriptor descriptor() {
      return descriptor;
    }

    @Override
    public InitialCapabilityCandidate initialQuestionCandidate(String question) {
      return new InitialCapabilityCandidate(descriptor.id(), matched);
    }

    @Override
    public void validateInitialQuestion(String question) {}

    @Override
    public FollowUpPolicy followUpPolicy() {
      return FollowUpPolicy.unsupported();
    }

    @Override
    public void validateCatalog(OntologyCatalog ontology) {
      if (ontology == null) throw new IllegalArgumentException("ontology");
    }

    @Override
    public ResolvedScopeSnapshot resolveScope(AuthSession principal) {
      return new ResolvedScopeSnapshot(
          descriptor.id().domainKey(),
          1,
          Map.of("organizationId", principal.scope().organizationId()));
    }

    @Override
    public void validateScope(ResolvedScopeSnapshot scope, AuthSession principal) {
      if (!principal.scope().organizationId().equals(scope.values().get("organizationId"))) {
        throw new BackendException("CAPABILITY_SCOPE_INVALID", "scope mismatch");
      }
    }

    @Override
    public WorkflowResult execute(CapabilityExecutionContext context) {
      return new WorkflowResult(Map.of(), List.of(), "result", List.of(), List.of());
    }
  }
}
