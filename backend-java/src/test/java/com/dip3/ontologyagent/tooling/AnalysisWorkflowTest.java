package com.dip3.ontologyagent.tooling;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.InvocationEventRecorder;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AnalysisWorkflowTest {
    private final OntologyRepository ontologies = mock(OntologyRepository.class);
    private final EvidenceProvider erp = mock(EvidenceProvider.class);
    private final EvidenceProvider cube = mock(EvidenceProvider.class);
    private final EvidenceProvider graph = mock(EvidenceProvider.class);
    private final ConclusionProvider conclusions = mock(ConclusionProvider.class);
    private final ExecutionRepository executions = mock(ExecutionRepository.class);
    private final InvocationEventRecorder recorder = mock(InvocationEventRecorder.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    private final WorkflowRequest request = new WorkflowRequest("execution-1", "session-1", "ontology-1",
            "project", "collection-rate", "project-collection-rate", "receivable-accounting-period",
            List.of("project-1"), LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"), "lease-1");
    private AnalysisWorkflow workflow;

    @BeforeEach
    void setUp() {
        when(ontologies.published("ontology-1")).thenReturn(ontology());
        when(recorder.start(anyString(), anyString(), anyString(), anyString(), anyString(), anyString(),
                any(), anyMap(), anyString(), anyString()))
                .thenReturn("invocation-1", "invocation-2", "invocation-3", "invocation-4");
        workflow = new AnalysisWorkflow(ontologies, erp, cube, graph, conclusions, executions, recorder);
    }

    @Test
    void callsGovernedProvidersInOrderAndConcludesOnlyFromTheirEvidence() {
        Evidence erpEvidence = erpEvidence(800);
        Evidence cubeEvidence = cubeEvidence();
        Evidence graphEvidence = evidence("neo4j");
        when(erp.collect(owner, request)).thenReturn(erpEvidence);
        when(cube.collect(owner, request)).thenReturn(cubeEvidence);
        when(graph.collect(owner, request)).thenReturn(graphEvidence);
        when(conclusions.conclude(request, List.of(erpEvidence, cubeEvidence, graphEvidence)))
                .thenReturn(grounded("真实结论"));

        WorkflowResult result = workflow.execute(owner, request, "trace-1", "parent-1");

        assertEquals(List.of(erpEvidence, cubeEvidence, graphEvidence), result.evidence());
        assertEquals("真实结论", result.conclusion());
        assertEquals(Map.of("erp.read-model", "erp", "cube.semantic-query", "cube",
                "neo4j.graph-query", "neo4j", "llm.structured-analysis", "llm"),
                result.plan().get("_toolBindings"));
        assertEquals(ExecutionRepository.EXECUTION_CONTRACT, result.plan().get("_executionContract"));
        assertEquals("project", ((Map<?, ?>) result.plan().get("_resolvedContext")).get("entityKey"));
        InOrder order = inOrder(cube, erp, graph, conclusions);
        order.verify(cube).collect(owner, request);
        order.verify(erp).collect(owner, request);
        order.verify(graph).collect(owner, request);
        order.verify(conclusions).conclude(request, List.of(erpEvidence, cubeEvidence, graphEvidence));
        verify(recorder, org.mockito.Mockito.times(4)).succeed(anyString(), anyMap(), anyString(), anyString(), any());
    }

    @Test
    void providerFailureStopsTheWorkflowAndNeverFallsBackOrSynthesizes() {
        when(erp.collect(owner, request)).thenReturn(evidence("erp"));
        when(cube.collect(owner, request)).thenThrow(new BackendException("CUBE_PROVIDER_FAILURE", "Cube failed"));

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("CUBE_PROVIDER_FAILURE", error.code());
        verify(graph, never()).collect(any(), any());
        verify(conclusions, never()).conclude(any(), any());
        verify(recorder).fail(anyString(), org.mockito.ArgumentMatchers.eq("CUBE_PROVIDER_FAILURE"), anyString(),
                anyString(), anyString(), any());
    }

    @Test
    void auditFailureReplacesTheBusinessFailureWithAnExplicitDiagnosticCode() {
        when(cube.collect(owner, request)).thenThrow(new BackendException("CUBE_PROVIDER_FAILURE", "Cube failed"));
        doThrow(new BackendException("INVOCATION_STATE_CONFLICT", "invocation already terminal"))
                .when(recorder).fail(anyString(), anyString(), anyString(), anyString(), anyString(), any());

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("INVOCATION_AUDIT_FAILURE", error.code());
        assertEquals(1, error.getSuppressed().length);
    }

    @Test
    void unapprovedGroundingIsRejectedBeforeAnyProviderCall() {
        WorkflowRequest invalid = new WorkflowRequest("execution-1", "session-1", "ontology-1",
                "free-text-project", "collection-rate", "project-collection-rate",
                "receivable-accounting-period", List.of("project-1"),
                LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"), "lease-1");
        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, invalid, "trace-1", "parent-1"));
        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", error.code());
        verify(erp, never()).collect(any(), any());
    }

    @Test
    void emptyRequiredEvidenceStopsBeforeConclusion() {
        when(erp.collect(owner, request)).thenReturn(evidence("erp-staging"));
        when(cube.collect(owner, request)).thenReturn(new Evidence("cube", "cube", List.of()));
        when(graph.collect(owner, request)).thenReturn(evidence("neo4j"));

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("ANALYSIS_EVIDENCE_EMPTY", error.code());
        verify(conclusions, never()).conclude(any(), any());
        verify(graph, never()).collect(any(), any());
        verify(recorder).fail(anyString(), org.mockito.ArgumentMatchers.eq("ANALYSIS_EVIDENCE_EMPTY"),
                anyString(), anyString(), anyString(), any());
    }

    @Test
    void metricThatDoesNotApplyToTheRequestedEntityIsRejected() {
        OntologyCatalog approved = ontology();
        OntologyCatalog invalid = new OntologyCatalog(approved.versionId(), approved.semver(), approved.entities(),
                List.of(new OntologyCatalog.Item("collection-rate", "collection-rate",
                        Map.of("applicableSubjectKeys", List.of("organization")))),
                approved.metricVariants(), approved.factors(), approved.timeSemantics(), approved.planSteps(),
                approved.toolBindings());
        when(ontologies.published("ontology-1")).thenReturn(invalid);

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", error.code());
        verify(erp, never()).collect(any(), any());
    }

    @Test
    void variantOrTimeSemanticDriftIsRejectedBeforeProvidersRun() {
        OntologyCatalog approved = ontology();
        OntologyCatalog driftedParent = new OntologyCatalog(approved.versionId(), approved.semver(),
                approved.entities(), List.of(new OntologyCatalog.Item("collection-rate", "collection-rate",
                Map.of("applicableSubjectKeys", List.of("project"), "defaultAggregation", "sum", "unit", "CNY"))),
                approved.metricVariants(), approved.factors(), approved.timeSemantics(), approved.planSteps(),
                approved.toolBindings());
        when(ontologies.published("ontology-1")).thenReturn(driftedParent);
        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1")).code());

        OntologyCatalog driftedVariant = new OntologyCatalog(approved.versionId(), approved.semver(),
                approved.entities(), approved.metrics(), approved.metricVariants().stream().map(item ->
                "project-collection-rate".equals(item.businessKey()) ? new OntologyCatalog.Item(
                        item.businessKey(), item.displayName(), Map.of(
                        "parentMetricDefinitionKey", "collection-rate",
                        "semanticDiscriminator", "project-scope",
                        "cubeViewMapping", Map.of(
                                "numeratorMetricKey", "project-paid-amount",
                                "denominatorMetricKey", "project-receivable-amount",
                                "formula", "project-paid-amount / project-receivable-amount"))) : item).toList(),
                approved.factors(), approved.timeSemantics(), approved.planSteps(), approved.toolBindings());
        when(ontologies.published("ontology-1")).thenReturn(driftedVariant);
        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1")).code());

        OntologyCatalog driftedTime = new OntologyCatalog(approved.versionId(), approved.semver(),
                approved.entities(), approved.metrics(), approved.metricVariants(), approved.factors(),
                approved.timeSemantics().stream().map(item -> "receivable-accounting-period".equals(item.businessKey())
                        ? new OntologyCatalog.Item(item.businessKey(), item.displayName(), Map.of(
                        "semanticType", "transaction-date",
                        "entityDateFieldMapping", Map.of("payment", "operatorDate"),
                        "cubeTimeDimensionMapping", Map.of("cubeDimension", "FinancePayments.paymentDate"),
                        "defaultGranularity", "month")) : item).toList(), approved.planSteps(),
                approved.toolBindings());
        when(ontologies.published("ontology-1")).thenReturn(driftedTime);
        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1")).code());
        verify(erp, never()).collect(any(), any());
    }

    @Test
    void childMetricAndPaymentDateDriftAreRejectedBeforeProvidersRun() {
        OntologyCatalog approved = ontology();
        List<OntologyCatalog.Item> driftedMetrics = approved.metricVariants().stream().map(item ->
                "project-paid-amount".equals(item.businessKey()) ? metricVariant(
                        "project-paid-amount", Map.of("cubeMeasure", "FinancePayments.amount")) : item).toList();
        when(ontologies.published("ontology-1")).thenReturn(new OntologyCatalog(approved.versionId(),
                approved.semver(), approved.entities(), approved.metrics(), driftedMetrics, approved.factors(),
                approved.timeSemantics(), approved.planSteps(), approved.toolBindings()));
        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1")).code());

        List<OntologyCatalog.Item> driftedTimes = approved.timeSemantics().stream().map(item ->
                "payment-date".equals(item.businessKey()) ? new OntologyCatalog.Item(
                        item.businessKey(), item.displayName(), Map.of(
                        "semanticType", "transaction-date",
                        "entityDateFieldMapping", Map.of("payment", "operatorDate"),
                        "cubeTimeDimensionMapping", Map.of("cubeDimension", "FinancePayments.createdAt"),
                        "defaultGranularity", "month")) : item).toList();
        when(ontologies.published("ontology-1")).thenReturn(new OntologyCatalog(approved.versionId(),
                approved.semver(), approved.entities(), approved.metrics(), approved.metricVariants(),
                approved.factors(), driftedTimes, approved.planSteps(), approved.toolBindings()));
        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1")).code());
        verify(erp, never()).collect(any(), any());
    }

    @Test
    void inactiveBindingIsRejectedBeforeAnyProviderCall() {
        OntologyCatalog approved = ontology();
        List<OntologyCatalog.ToolBinding> inactive = approved.toolBindings().stream()
                .map(binding -> "erp.read-model".equals(binding.toolName())
                        ? new OntologyCatalog.ToolBinding(binding.id(), binding.toolName(), binding.stepTemplateKey(),
                        binding.capabilityTag(), List.of(Map.of("type", "always", "value", false)),
                        binding.priority())
                        : binding)
                .toList();
        when(ontologies.published("ontology-1")).thenReturn(new OntologyCatalog(approved.versionId(),
                approved.semver(), approved.entities(), approved.metrics(), approved.metricVariants(),
                approved.factors(), approved.timeSemantics(), approved.planSteps(), inactive));

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("ONTOLOGY_TOOL_NOT_APPROVED", error.code());
        verify(erp, never()).collect(any(), any());
    }

    @Test
    void bindingMayMatchEitherItsStepOrCapabilitySelector() {
        OntologyCatalog approved = ontology();
        List<OntologyCatalog.ToolBinding> bindings = approved.toolBindings().stream()
                .map(binding -> "erp.read-model".equals(binding.toolName())
                        ? new OntologyCatalog.ToolBinding(binding.id(), binding.toolName(),
                        binding.stepTemplateKey(), "semantic-query", binding.activationConditions(),
                        binding.priority())
                        : binding)
                .toList();
        when(ontologies.published("ontology-1")).thenReturn(new OntologyCatalog(approved.versionId(),
                approved.semver(), approved.entities(), approved.metrics(), approved.metricVariants(),
                approved.factors(), approved.timeSemantics(), approved.planSteps(), bindings));
        Evidence erpEvidence = erpEvidence(800);
        Evidence cubeEvidence = cubeEvidence();
        Evidence graphEvidence = evidence("neo4j");
        when(cube.collect(owner, request)).thenReturn(cubeEvidence);
        when(erp.collect(owner, request)).thenReturn(erpEvidence);
        when(graph.collect(owner, request)).thenReturn(graphEvidence);
        when(conclusions.conclude(request, List.of(erpEvidence, cubeEvidence, graphEvidence)))
                .thenReturn(grounded("结论"));

        assertEquals("结论", workflow.execute(owner, request, "trace-1", "parent-1").conclusion());
    }

    @Test
    void contradictoryErpAndCubeFactsFailBeforeConclusion() {
        when(cube.collect(owner, request)).thenReturn(cubeEvidence());
        when(erp.collect(owner, request)).thenReturn(erpEvidence(100));
        when(graph.collect(owner, request)).thenReturn(evidence("neo4j"));

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("ANALYSIS_EVIDENCE_CONFLICT", error.code());
        verify(conclusions, never()).conclude(any(), any());
    }

    @Test
    void retiredOrIncompatiblePlanStepIsRejectedBeforeProvidersRun() {
        OntologyCatalog approved = ontology();
        OntologyCatalog missingScopeStep = new OntologyCatalog(approved.versionId(), approved.semver(),
                approved.entities(), approved.metrics(), approved.metricVariants(), approved.factors(),
                approved.timeSemantics(), approved.planSteps().stream()
                .filter(step -> !"confirm-analysis-scope".equals(step.businessKey())).toList(),
                approved.toolBindings());
        when(ontologies.published("ontology-1")).thenReturn(missingScopeStep);

        BackendException error = assertThrows(BackendException.class,
                () -> workflow.execute(owner, request, "trace-1", "parent-1"));

        assertEquals("ONTOLOGY_PLAN_NOT_APPROVED", error.code());
        verify(erp, never()).collect(any(), any());
    }

    @Test
    void followUpPlanCarriesContractLineageAndResolvedContext() {
        Map<String, Object> effective = Map.of("timeRange", Map.of("value", "2026年1月"));
        WorkflowRequest followUp = new WorkflowRequest("execution-2", "session-1", "ontology-1", "为什么下降",
                "project", "collection-rate", "project-collection-rate", "receivable-accounting-period",
                List.of("project-1"), LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"),
                "lease-1", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, "follow-up-1", "execution-1",
                Map.of("title", "上一轮结论", "summary", "收缴率下降。"), effective);
        Evidence erpEvidence = erpEvidence(800);
        Evidence cubeEvidence = cubeEvidence();
        Evidence graphEvidence = evidence("neo4j");
        when(erp.collect(owner, followUp)).thenReturn(erpEvidence);
        when(cube.collect(owner, followUp)).thenReturn(cubeEvidence);
        when(graph.collect(owner, followUp)).thenReturn(graphEvidence);
        when(conclusions.conclude(followUp, List.of(erpEvidence, cubeEvidence, graphEvidence)))
                .thenReturn(grounded("追问结论"));

        Map<String, Object> plan = workflow.execute(owner, followUp, "trace-2", "parent-2").plan();

        assertEquals(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, plan.get("_executionContract"));
        assertEquals("follow-up-1", plan.get("_followUpId"));
        assertEquals("execution-1", plan.get("_referencedExecutionId"));
        assertEquals("2026-01-01", ((Map<?, ?>) plan.get("_resolvedContext")).get("from"));
        assertEquals(effective.get("timeRange"), ((Map<?, ?>) plan.get("_resolvedContext")).get("timeRange"));
        @SuppressWarnings("rawtypes")
        org.mockito.ArgumentCaptor<Map> audit = org.mockito.ArgumentCaptor.forClass(Map.class);
        verify(recorder, org.mockito.Mockito.times(4)).start(anyString(), anyString(), anyString(), anyString(),
                anyString(), anyString(), any(), audit.capture(), anyString(), anyString());
        Map<?, ?> conclusionAudit = audit.getAllValues().getLast();
        assertEquals("为什么下降", conclusionAudit.get("questionText"));
        assertEquals("上一轮结论",
                ((Map<?, ?>) conclusionAudit.get("referencedConclusion")).get("title"));
    }

    private static Evidence evidence(String source) {
        return new Evidence(source, source, List.of(Map.of("value", 1)));
    }

    private static Evidence erpEvidence(int paid) {
        return new Evidence("erp-staging", "ERP", List.of(Map.of(
                "projectId", "project-1", "projectName", "项目一", "receivableAmount", 1000,
                "paidAmount", paid, "arrearsAmount", 1000 - paid)));
    }

    private static Evidence cubeEvidence() {
        return new Evidence("cube", "Cube", List.of(Map.of(
                "value", 80, "numerator", 800, "denominator", 1000)));
    }

    private static GroundedConclusion grounded(String text) {
        return new GroundedConclusion(List.of(new GroundedConclusion.Claim(text,
                List.of(new GroundedConclusion.EvidenceReference("cube", 0, "value", 1)))));
    }

    private static OntologyCatalog ontology() {
        return new OntologyCatalog("ontology-1", "1.0.0",
                List.of(item("project")), List.of(new OntologyCatalog.Item("collection-rate", "collection-rate",
                        collectionRateMetadata(List.of("project")))),
                List.of(projectCollectionRate(),
                        metricVariant("project-paid-amount", Map.of("cubeMeasure", "FinancePayments.paidAmount")),
                        metricVariant("project-receivable-amount",
                                Map.of("cubeMeasure", "FinanceReceivables.receivableAmount"))),
                List.of(), List.of(receivableAccountingPeriod(), paymentDate()), planSteps(), List.of(
                binding("erp", "erp.read-model", "validate-candidate-factors", "erp-read"),
                binding("cube", "cube.semantic-query", "inspect-metric-change", "semantic-query"),
                binding("neo4j", "neo4j.graph-query", "validate-candidate-factors", "graph-query"),
                binding("llm", "llm.structured-analysis", "synthesize-attribution", "llm-analysis")));
    }

    private static OntologyCatalog.ToolBinding binding(String id, String toolName, String step, String capability) {
        return new OntologyCatalog.ToolBinding(id, toolName, step, capability,
                List.of(Map.of("type", "always", "value", true)), 10);
    }

    private static OntologyCatalog.Item item(String key) {
        return new OntologyCatalog.Item(key, key, Map.of());
    }

    private static OntologyCatalog.Item projectCollectionRate() {
        return metricVariant("project-collection-rate", Map.of(
                "numeratorMetricKey", "project-paid-amount",
                "denominatorMetricKey", "project-receivable-amount",
                "formula", "project-paid-amount / project-receivable-amount * 100"));
    }

    private static OntologyCatalog.Item metricVariant(String key, Map<String, Object> cubeViewMapping) {
        return new OntologyCatalog.Item(key, key, Map.of(
                "parentMetricDefinitionKey", "collection-rate", "semanticDiscriminator", "project-scope",
                "cubeViewMapping", cubeViewMapping));
    }

    private static Map<String, Object> collectionRateMetadata(List<String> subjects) {
        return Map.of("applicableSubjectKeys", subjects, "defaultAggregation", "ratio", "unit", "%");
    }

    private static OntologyCatalog.Item receivableAccountingPeriod() {
        return new OntologyCatalog.Item("receivable-accounting-period", "receivable-accounting-period", Map.of(
                "semanticType", "accounting-period",
                "entityDateFieldMapping", Map.of("receivable", "shouldAccountBook"),
                "cubeTimeDimensionMapping", Map.of("cubeDimension", "FinanceReceivables.receivableAccountingPeriod"),
                "defaultGranularity", "year"));
    }

    private static OntologyCatalog.Item paymentDate() {
        return new OntologyCatalog.Item("payment-date", "payment-date", Map.of(
                "semanticType", "transaction-date",
                "entityDateFieldMapping", Map.of("payment", "operatorDate"),
                "cubeTimeDimensionMapping", Map.of("cubeDimension", "FinancePayments.paymentDate"),
                "defaultGranularity", "month"));
    }

    private static List<OntologyCatalog.Item> planSteps() {
        return List.of(
                planStep("confirm-analysis-scope", 1, List.of("capability-status")),
                planStep("inspect-metric-change", 2, List.of("semantic-query")),
                planStep("validate-candidate-factors", 3, List.of("semantic-query", "graph-query", "erp-read")),
                planStep("synthesize-attribution", 4, List.of("semantic-query", "structured-analysis")));
    }

    private static OntologyCatalog.Item planStep(String key, int order, List<String> capabilities) {
        return new OntologyCatalog.Item(key, key, Map.of("intentTypes", List.of("fee-analysis"),
                "requiredCapabilities", capabilities, "sortOrder", order));
    }
}
