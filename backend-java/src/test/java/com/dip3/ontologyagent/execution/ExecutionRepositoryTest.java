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
