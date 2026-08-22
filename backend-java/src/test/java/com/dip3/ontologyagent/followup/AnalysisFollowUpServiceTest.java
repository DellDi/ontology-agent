package com.dip3.ontologyagent.followup;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionSnapshotEntity;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSubmission;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.integration.erp.ScopedProjectTarget;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

class AnalysisFollowUpServiceTest {
    private final AnalysisService analyses = mock(AnalysisService.class);
    private final AnalysisFollowUpRepository repository = mock(AnalysisFollowUpRepository.class);
    private final OntologyRepository ontologies = mock(OntologyRepository.class);
    private final ScopedProjectResolver scopedProjects = mock(ScopedProjectResolver.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1", "project-2"), List.of(), List.of("analyst")), Instant.MAX);
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1", owner.scope(),
            "分析收缴率", Map.of(), "completed", Instant.parse("2026-08-01T00:00:00Z"),
            Instant.parse("2026-08-01T00:00:00Z"));
    private AnalysisFollowUpService service;

    @BeforeEach
    void setUp() {
        service = new AnalysisFollowUpService(analyses, repository, ontologies, scopedProjects);
        when(analyses.ownedSession("session-1", owner)).thenReturn(session);
        when(ontologies.published("ontology-1")).thenReturn(ontology());
        when(scopedProjects.resolve(owner)).thenReturn(owner.scope().projectIds());
        when(scopedProjects.targets(owner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "项目一"),
                new ScopedProjectTarget("project-2", "项目二")));
        when(repository.create(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(repository.replace(any(), any())).thenAnswer(invocation -> invocation.getArgument(1));
    }

    @Test
    void createInheritsOnlyCompletedSnapshotFactsAndMapsCanonicalContext() {
        when(repository.latestCompletedRootSnapshot("session-1", "user-1")).thenReturn(Optional.of(snapshot()));

        AnalysisFollowUp result = service.create("session-1", owner, "  为什么下降？ ", "");

        assertEquals("为什么下降?", result.questionText());
        assertEquals("execution-root", result.referencedExecutionId());
        assertEquals("综合证据结论", result.referencedConclusionTitle());
        assertEquals("收缴率下降。", result.referencedConclusionSummary());
        assertEquals("ontology-1", result.ontologyVersionId());
        assertEquals("inherited", result.ontologyVersionBinding().get("source"));
        assertEquals("collection-rate", fieldValue(result.inheritedContext(), "targetMetric"));
        assertEquals("project-1", fieldValue(result.inheritedContext(), "entity"));
        assertEquals("2026-01-01/2026-01-31", fieldValue(result.inheritedContext(), "timeRange"));
        assertEquals(result.inheritedContext(), result.mergedContext());
    }

    @Test
    void createFailsLoudWhenResolvedContextIsMissing() {
        ExecutionSnapshotEntity snapshot = snapshot();
        snapshot.planSnapshot = Map.of("steps", List.of());
        when(repository.latestCompletedRootSnapshot("session-1", "user-1")).thenReturn(Optional.of(snapshot));

        BackendException error = assertThrows(BackendException.class,
                () -> service.create("session-1", owner, "为什么？", ""));

        assertEquals("FOLLOW_UP_CONTEXT_MISSING", error.code());
    }

    @Test
    void createRejectsExplicitCapabilitySwitchesAndAppliesNaturalLanguageScope() {
        when(repository.latestCompletedRootSnapshot("session-1", "user-1")).thenReturn(Optional.of(snapshot()));
        for (String question : List.of("那投诉量呢", "尾欠收缴率呢", "按实收日期呢")) {
            BackendException error = assertThrows(BackendException.class,
                    () -> service.create("session-1", owner, question, ""));
            assertEquals("FOLLOW_UP_CAPABILITY_UNSUPPORTED", error.code());
        }
        AnalysisFollowUp unchanged = service.create("session-1", owner, "为什么下降", "");
        assertEquals(unchanged.inheritedContext(), unchanged.mergedContext());
        AnalysisFollowUp month = service.create("session-1", owner, "二月呢", "");
        assertEquals("2026-02-01/2026-02-28", fieldValue(month.mergedContext(), "timeRange"));
        AnalysisFollowUp explicitMonth = service.create("session-1", owner, "改看2026年2月", "");
        assertEquals("2026-02-01/2026-02-28", fieldValue(explicitMonth.mergedContext(), "timeRange"));
        AnalysisFollowUp project = service.create("session-1", owner, "项目二呢", "");
        assertEquals("project-2", fieldValue(project.mergedContext(), "entity"));
        assertEquals(List.of("project-2"), projectIds(project.mergedContext()));
        AnalysisFollowUp allProjects = service.create("session-1", owner, "所有项目呢", "");
        assertEquals(List.of("project-1", "project-2"), projectIds(allProjects.mergedContext()));

        BackendException mixedScope = assertThrows(BackendException.class,
                () -> service.create("session-1", owner, "所有项目和项目一呢", ""));
        assertEquals("FOLLOW_UP_SCOPE_INVALID", mixedScope.code());
    }

    @Test
    void createRejectsUnknownOrAmbiguousProjectReferences() {
        when(repository.latestCompletedRootSnapshot("session-1", "user-1")).thenReturn(Optional.of(snapshot()));

        BackendException unknown = assertThrows(BackendException.class,
                () -> service.create("session-1", owner, "project-999 呢", ""));
        assertEquals("FOLLOW_UP_SCOPE_INVALID", unknown.code());

        when(scopedProjects.targets(owner)).thenReturn(List.of(
                new ScopedProjectTarget("project-1", "阳光花园"),
                new ScopedProjectTarget("project-2", "阳光花园")));
        BackendException duplicate = assertThrows(BackendException.class,
                () -> service.create("session-1", owner, "阳光花园呢", ""));
        assertEquals("FOLLOW_UP_SCOPE_INVALID", duplicate.code());

        when(scopedProjects.targets(owner)).thenReturn(List.of(new ScopedProjectTarget("project-1", "花园")));
        BackendException substring = assertThrows(BackendException.class,
                () -> service.create("session-1", owner, "五月花园呢", ""));
        assertEquals("FOLLOW_UP_SCOPE_INVALID", substring.code());
    }

    @Test
    void parentMustBelongToSameOwnedSessionAndHaveItsOwnCompletedSnapshot() {
        AnalysisFollowUp foreign = followUp("follow-1", "other-session", null, null, context(), null, null);
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(foreign));

        BackendException error = assertThrows(BackendException.class,
                () -> service.create("session-1", owner, "继续", "follow-1"));

        assertEquals("FOLLOW_UP_NOT_FOUND", error.code());
    }

    @Test
    void adjustmentRequiresExplicitConflictConfirmationAndInvalidatesCurrentPlan() {
        Map<String, Object> plan = plan(resolved());
        AnalysisFollowUp current = followUp("follow-1", "session-1", null, null, context(), 2, plan);
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(current));

        AnalysisFollowUpService.FollowUpConflictException conflict = assertThrows(
                AnalysisFollowUpService.FollowUpConflictException.class,
                () -> service.adjust("session-1", "follow-1", owner,
                        Map.of("timeRange", "2026-02-01/2026-02-28"), false));
        assertEquals("timeRange", conflict.conflicts().getFirst().get("key"));

        AnalysisFollowUpService.AdjustmentResult result = service.adjust("session-1", "follow-1", owner,
                Map.of("timeRange", "2026-02-01/2026-02-28"), true);
        assertEquals("2026-02-01/2026-02-28", fieldValue(result.followUp().mergedContext(), "timeRange"));
        assertNull(result.followUp().planVersion());
        assertNull(result.followUp().currentPlanSnapshot());
        assertNull(result.followUp().previousPlanSnapshot());
        assertNull(result.followUp().currentPlanDiff());
        assertEquals(1, ((List<?>) result.diff().get("overridden")).size());
    }

    @Test
    void adjustmentRejectsOversizedFieldsAndSubmittedRounds() {
        AnalysisFollowUp current = followUp("follow-1", "session-1", null, null, context(), null, null);
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(current));
        BackendException oversized = assertThrows(BackendException.class,
                () -> service.adjust("session-1", "follow-1", owner, Map.of("factor", "x".repeat(201)), false));
        assertEquals("INVALID_FOLLOW_UP_ADJUSTMENT", oversized.code());

        AnalysisFollowUp submitted = followUp("follow-1", "session-1", null, "execution-follow",
                context(), 2, plan(resolved()));
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(submitted));
        BackendException adjust = assertThrows(BackendException.class,
                () -> service.adjust("session-1", "follow-1", owner, Map.of("factor", "入住率"), false));
        assertEquals("FOLLOW_UP_ALREADY_SUBMITTED", adjust.code());
        BackendException replan = assertThrows(BackendException.class,
                () -> service.replan("session-1", "follow-1", owner));
        assertEquals("FOLLOW_UP_ALREADY_SUBMITTED", replan.code());
        verify(repository, never()).replace(any(), any());
    }

    @Test
    void replanUpdatesStructuredResolvedContextAndBuildsVersionedDiff() {
        Map<String, Object> inherited = context();
        Map<String, Object> merged = new java.util.LinkedHashMap<>(inherited);
        merged.put("timeRange", Map.of("label", "时间范围", "value", "2026-02-01/2026-02-28",
                "state", "confirmed"));
        AnalysisFollowUp current = followUp("follow-1", "session-1", null, null, Map.copyOf(merged), null, null);
        current = new AnalysisFollowUp(current.id(), current.sessionId(), current.ownerUserId(), current.questionText(),
                current.parentFollowUpId(), current.referencedExecutionId(), current.referencedConclusionTitle(),
                current.referencedConclusionSummary(), current.resultExecutionId(), current.ontologyVersionId(),
                current.ontologyVersionBinding(), inherited, current.mergedContext(), null, null, null, null,
                current.createdAt(), current.updatedAt());
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(current));
        ExecutionSnapshotEntity source = snapshot();
        when(repository.completedSourceSnapshot(current)).thenReturn(Optional.of(source));

        AnalysisFollowUp result = service.replan("session-1", "follow-1", owner);

        assertEquals(2, result.planVersion());
        Map<?, ?> nextResolved = (Map<?, ?>) result.currentPlanSnapshot().get("_resolvedContext");
        assertEquals("2026-02-01", nextResolved.get("from"));
        assertEquals("2026-02-28", nextResolved.get("to"));
        assertEquals("java-follow-up-v1", result.currentPlanSnapshot().get("_executionContract"));
        assertEquals("follow-1", result.currentPlanSnapshot().get("_followUpId"));
        assertEquals("execution-root", result.currentPlanSnapshot().get("_referencedExecutionId"));
        assertEquals(source.planSnapshot, result.previousPlanSnapshot());
        assertEquals(1, ((List<?>) result.currentPlanDiff().get("invalidatedSteps")).size());
    }

    @Test
    void executionAttachmentIsIdempotentButRejectsOntologyOrExecutionMismatch() {
        AnalysisFollowUp current = followUp("follow-1", "session-1", null, null, context(), 2,
                plan(resolved()));
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(current));

        AnalysisFollowUp attached = service.attachResultExecution("session-1", "follow-1", owner,
                "execution-follow", "ontology-1");
        assertEquals("execution-follow", attached.resultExecutionId());

        BackendException ontologyMismatch = assertThrows(BackendException.class,
                () -> service.attachResultExecution("session-1", "follow-1", owner,
                        "execution-follow", "ontology-other"));
        assertEquals("FOLLOW_UP_ONTOLOGY_MISMATCH", ontologyMismatch.code());

        AnalysisFollowUp alreadyAttached = new AnalysisFollowUp(attached.id(), attached.sessionId(),
                attached.ownerUserId(), attached.questionText(), attached.parentFollowUpId(),
                attached.referencedExecutionId(), attached.referencedConclusionTitle(),
                attached.referencedConclusionSummary(), attached.resultExecutionId(), attached.ontologyVersionId(),
                attached.ontologyVersionBinding(), attached.inheritedContext(), attached.mergedContext(),
                attached.planVersion(), attached.currentPlanSnapshot(), attached.previousPlanSnapshot(),
                attached.currentPlanDiff(), attached.createdAt(), attached.updatedAt());
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(alreadyAttached));
        assertEquals("execution-follow", service.attachResultExecution("session-1", "follow-1", owner,
                "execution-follow", "ontology-1").resultExecutionId());
        BackendException executionConflict = assertThrows(BackendException.class,
                () -> service.attachResultExecution("session-1", "follow-1", owner,
                        "execution-other", "ontology-1"));
        assertEquals("FOLLOW_UP_EXECUTION_CONFLICT", executionConflict.code());
    }

    @Test
    void replanRejectsMetricEntityAndComparisonOutsideTheCurrentCapability() {
        Map<String, Object> inherited = context();
        for (Map.Entry<String, String> unsupported : Map.of(
                "targetMetric", "another-metric", "entity", "unknown-project", "comparison", "同比").entrySet()) {
            Map<String, Object> merged = new java.util.LinkedHashMap<>(inherited);
            Map<?, ?> original = (Map<?, ?>) inherited.get(unsupported.getKey());
            merged.put(unsupported.getKey(), Map.of("label", original.get("label"),
                    "value", unsupported.getValue(), "state", "confirmed"));
            AnalysisFollowUp current = followUp("follow-1", "session-1", null, null,
                    Map.copyOf(merged), null, null);
            current = new AnalysisFollowUp(current.id(), current.sessionId(), current.ownerUserId(),
                    current.questionText(), current.parentFollowUpId(), current.referencedExecutionId(),
                    current.referencedConclusionTitle(), current.referencedConclusionSummary(),
                    current.resultExecutionId(), current.ontologyVersionId(), current.ontologyVersionBinding(),
                    inherited, current.mergedContext(), null, null, null, null,
                    current.createdAt(), current.updatedAt());
            when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(current));
            when(repository.completedSourceSnapshot(current)).thenReturn(Optional.of(snapshot()));

            BackendException error = assertThrows(BackendException.class,
                    () -> service.replan("session-1", "follow-1", owner));
            assertEquals("FOLLOW_UP_REPLAN_UNSUPPORTED", error.code());
        }
    }

    @Test
    void submitUsesFiveDependencyConstructorAndRequiresARealTransaction() {
        ExecutionRepository executions = mock(ExecutionRepository.class);
        WakeupPublisher wakeups = mock(WakeupPublisher.class);
        service = new AnalysisFollowUpService(analyses, repository, ontologies, executions, wakeups);
        AnalysisFollowUp current = followUp("follow-1", "session-1", null, null, context(), 2, plan(resolved()));
        when(repository.lockOwned("follow-1", "session-1", "user-1")).thenReturn(Optional.of(current));
        when(repository.findOwned("follow-1", "user-1")).thenReturn(Optional.of(current));
        when(executions.submitFollowUp(any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(new ExecutionSubmission("execution-follow", true));

        BackendException error = assertThrows(BackendException.class,
                () -> service.submit("session-1", "follow-1", owner, "idem", "trace-1"));

        assertEquals("FOLLOW_UP_TRANSACTION_REQUIRED", error.code());
        verify(wakeups, never()).publish(any());
    }

    private static ExecutionSnapshotEntity snapshot() {
        ExecutionSnapshotEntity row = new ExecutionSnapshotEntity();
        row.executionId = "execution-root";
        row.sessionId = "session-1";
        row.ownerUserId = "user-1";
        row.status = "completed";
        row.ontologyVersionId = "ontology-1";
        row.planSnapshot = plan(resolved());
        row.conclusionState = Map.of("causes", List.of(Map.of("title", "综合证据结论",
                "summary", "收缴率下降。")));
        return row;
    }

    private static Map<String, Object> resolved() {
        return Map.of("entityKey", "property-project", "metricDefinitionKey", "collection-rate-definition",
                "metricVariantKey", "collection-rate", "timeSemanticKey", "receivable-period",
                "projectIds", List.of("project-1"), "from", "2026-01-01", "to", "2026-01-31");
    }

    private static Map<String, Object> plan(Map<String, Object> resolved) {
        return Map.of("mode", "multi-step", "summary", "计划", "_resolvedContext", resolved,
                "steps", List.of(Map.of("id", "step-1", "order", 1, "title", "确认口径",
                        "objective", "确认", "dependencyIds", List.of())));
    }

    private static Map<String, Object> context() {
        return Map.of("targetMetric", Map.of("label", "目标指标", "value", "collection-rate", "state", "confirmed"),
                "entity", Map.of("label", "实体对象", "value", "project-1", "state", "confirmed"),
                "timeRange", Map.of("label", "时间范围", "value", "2026-01-01/2026-01-31", "state", "confirmed"),
                "comparison", Map.of("label", "比较方式", "value", "无需比较", "state", "confirmed"),
                "constraints", List.of());
    }

    private static AnalysisFollowUp followUp(String id, String sessionId, String parentId, String resultExecutionId,
                                             Map<String, Object> merged, Integer planVersion,
                                             Map<String, Object> plan) {
        Instant now = Instant.parse("2026-08-01T00:00:00Z");
        return new AnalysisFollowUp(id, sessionId, "user-1", "为什么", parentId, "execution-root",
                "结论", "摘要", resultExecutionId, "ontology-1",
                Map.of("ontologyVersionId", "ontology-1", "source", "inherited"), context(), merged,
                planVersion, plan, null, null, now, now);
    }

    private static OntologyCatalog ontology() {
        return new OntologyCatalog("ontology-1", "1.0.0",
                List.of(new OntologyCatalog.Item("property-project", "物业项目", Map.of())), List.of(),
                List.of(new OntologyCatalog.Item("collection-rate", "收缴率", Map.of())), List.of(),
                List.of(), List.of(), List.of());
    }

    private static Object fieldValue(Map<String, Object> context, String key) {
        return ((Map<?, ?>) context.get(key)).get("value");
    }

    private static List<String> projectIds(Map<String, Object> context) {
        return ((List<?>) context.get("constraints")).stream().map(Map.class::cast)
                .filter(item -> "项目 ID".equals(item.get("label")))
                .map(item -> item.get("value").toString()).toList();
    }
}
