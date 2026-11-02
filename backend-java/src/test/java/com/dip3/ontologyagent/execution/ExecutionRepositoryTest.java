package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

class ExecutionRepositoryTest {
    private final ExecutionRepository repository = new ExecutionRepository(
            mock(JobMapper.class), mock(ExecutionEventMapper.class), mock(ExecutionSnapshotMapper.class));
    private final AnalysisSession session = new AnalysisSession("session-1", "user-1",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of()), "分析收缴率",
            Map.of(), "pending", Instant.now(), Instant.now());

    @Test
    void rootObjectScopeSurvivesSubmissionAndWorkerClaimWithoutChangingOrdinaryJobs() {
        var jobs = mock(JobMapper.class);
        var repository = new ExecutionRepository(jobs, mock(ExecutionEventMapper.class), mock(ExecutionSnapshotMapper.class));
        var scope = new com.dip3.ontologyagent.semantic.api.InitialObjectSelection("chosen-set", List.of(
            new com.dip3.ontologyagent.semantic.api.ObjectQueryPort.Reference("easyv-prototype-layout", "a", "layouts-old"))).snapshot();
        var selected = new AnalysisSession(session.id(), session.ownerUserId(), session.scope(), session.questionText(),
            Map.of("initialObjectSelection", scope), session.status(), session.createdAt(), session.updatedAt());
        var owner = new com.dip3.ontologyagent.auth.AuthSession("auth", "user-1", "用户", session.scope(), Instant.MAX);
        var binding = com.dip3.ontologyagent.support.CapabilityTestFixtures.easyvBinding(owner, "ontology-1");
        var captured = org.mockito.ArgumentCaptor.forClass(JobEntity.class);
        org.mockito.Mockito.when(jobs.insertIfAbsent(captured.capture())).thenReturn(1);
        var submitted = repository.submit(selected, "key", "trace", binding, "chosen-set");
        var row = captured.getValue(); row.attemptCount = 1;
        org.mockito.Mockito.when(jobs.claim(org.mockito.ArgumentMatchers.eq("worker"), org.mockito.ArgumentMatchers.any())).thenReturn(row);
        var claimed = repository.claim("worker", java.time.Duration.ofSeconds(30)).orElseThrow();
        assertEquals(submitted.executionId(), claimed.executionId());
        assertEquals("chosen-set", claimed.datasetVersionSetId());
        assertEquals(Map.of("initialObjectSelection", scope), claimed.effectiveContext());
        repository.submit(session, "ordinary", "trace", binding, "latest");
        org.junit.jupiter.api.Assertions.assertFalse(captured.getValue().payload.containsKey("effectiveContext"));
    }

    @Test
    void initialAndFollowUpSubmissionRejectMissingCapabilityBindingWithTheSameError() {
        BackendException initial = assertThrows(BackendException.class,
                () -> repository.submit(session, "key-1", "trace-1", null));
        BackendException followUp = assertThrows(BackendException.class,
                () -> repository.submitFollowUp(session, "follow-up-1", "execution-1", "为什么下降",
                        Map.of("title", "结论", "summary", "收缴率下降。"), Map.of(), "key-2", "trace-2", null));

        assertEquals("CAPABILITY_BINDING_INVALID", initial.code());
        assertEquals(initial.code(), followUp.code());
    }
}
