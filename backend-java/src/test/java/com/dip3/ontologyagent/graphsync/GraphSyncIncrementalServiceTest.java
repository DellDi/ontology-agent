package com.dip3.ontologyagent.graphsync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class GraphSyncIncrementalServiceTest {
    private final GraphSyncService rebuilds = mock(GraphSyncService.class);
    private final GraphSyncRunRepository runs = mock(GraphSyncRunRepository.class);
    private final GraphSyncIncrementalService service = new GraphSyncIncrementalService(rebuilds, runs);

    @Test
    void consistencySweepRebuildsOnlyTheAuthenticatedOrganizationFromCanonical() {
        GraphSyncRun completed = run("run-1", "completed");
        when(rebuilds.rebuild("org-1", "admin", "consistency-sweep", "manual",
                Map.of("correlationId", "trace-1"))).thenReturn(completed);

        assertEquals(List.of(completed), service.sweep(admin(), "trace-1"));
    }

    @Test
    void statusNoLongerExposesLegacyErpCursorBacklog() {
        GraphSyncRun completed = run("run-1", "completed");
        when(runs.latest("org-1")).thenReturn(Optional.of(completed));

        GraphSyncStatus status = service.status(admin());

        assertEquals(completed, status.latestRun());
        assertEquals(Map.of(), status.backlog());
        assertEquals(List.of(), status.cursors());
        assertEquals(List.of(), status.recentFailures());
    }

    @Test
    void rejectsNonAdminBeforeReadingOrWritingProjectionState() {
        BackendException error = assertThrows(BackendException.class,
                () -> service.sweep(analyst(), "trace-1"));
        assertEquals("GRAPH_SYNC_FORBIDDEN", error.code());
        verifyNoInteractions(rebuilds, runs);
    }

    private static GraphSyncRun run(String id, String status) {
        Instant now = Instant.now();
        return new GraphSyncRun(id, "consistency-sweep", status, "organization", "org-1",
                "manual", "admin", Map.of("datasetVersionSetId", "property-set-1"),
                1, 0, null, null, now, now, now, now);
    }

    private static AuthSession admin() {
        return new AuthSession("session", "admin", "管理员",
                new AccessScope("org-1", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
    }

    private static AuthSession analyst() {
        return new AuthSession("session", "analyst", "分析员",
                new AccessScope("org-1", List.of(), List.of(), List.of("analyst")), Instant.MAX);
    }
}
