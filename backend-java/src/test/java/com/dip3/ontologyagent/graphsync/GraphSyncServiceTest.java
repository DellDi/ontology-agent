package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class GraphSyncServiceTest {
    private final GraphSyncRunRepository runs = mock(GraphSyncRunRepository.class);
    private final GraphBatchBuilder batches = mock(GraphBatchBuilder.class);
    private final GraphWriter graph = mock(GraphWriter.class);
    private final GraphSyncLease leases = mock(GraphSyncLease.class);
    private final GraphSyncLease.Guard guard = mock(GraphSyncLease.Guard.class);
    private final GraphSyncService service;

    GraphSyncServiceTest() {
        when(leases.start(anyString())).thenReturn(guard);
        service = new GraphSyncService(runs, batches, graph, leases);
    }

    @Test
    void rejectsNonAdminAndCrossOrganization() {
        AuthSession analyst = owner("org-1", "analyst");
        BackendException forbidden = assertThrows(BackendException.class,
                () -> service.rebuild("org-1", analyst));
        assertEquals("GRAPH_SYNC_FORBIDDEN", forbidden.code());
        BackendException crossed = assertThrows(BackendException.class,
                () -> service.rebuild("org-2", owner("org-1", "PLATFORM_ADMIN")));
        assertEquals("GRAPH_SYNC_SCOPE_FORBIDDEN", crossed.code());
        verifyNoInteractions(runs, batches, graph);
    }

    @Test
    void completesOnlyAfterGraphWriteAndCleanupResult() {
        AuthSession admin = owner("org-1", "PLATFORM_ADMIN");
        GraphSyncRun pending = run("run-1", "pending");
        GraphSyncRun completed = run("run-1", "completed");
        GraphBatch batch = new GraphBatch(List.of(), List.of());
        GraphWriter.WriteResult write = new GraphWriter.WriteResult(3, 2, 1, 1);
        when(runs.createLocked(anyString(), anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(pending);
        when(batches.build("org-1", "run-1")).thenReturn(batch);
        when(graph.replaceOrganization("org-1", "run-1", 10L, batch)).thenReturn(write);
        when(runs.latest("org-1")).thenReturn(Optional.of(completed));

        assertEquals("completed", service.rebuild("org-1", admin).status());
        var order = inOrder(runs, batches, graph);
        order.verify(runs).running("run-1");
        order.verify(batches).build("org-1", "run-1");
        order.verify(runs).heartbeat("run-1");
        order.verify(graph).replaceOrganization("org-1", "run-1", 10L, batch);
        order.verify(runs).heartbeat("run-1");
        order.verify(runs).completed("run-1", write);
    }

    @Test
    void persistsPartialAndNeverCompletesWhenNeo4jFails() {
        AuthSession admin = owner("org-1", "PLATFORM_ADMIN");
        GraphSyncRun pending = run("run-1", "pending");
        GraphBatch batch = new GraphBatch(List.of(), List.of());
        when(runs.createLocked(anyString(), anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(pending);
        when(batches.build("org-1", "run-1")).thenReturn(batch);
        when(graph.replaceOrganization("org-1", "run-1", 10L, batch)).thenThrow(
                new GraphSyncException("NEO4J_GRAPH_SYNC_FAILED", "write failed", true));

        BackendException error = assertThrows(BackendException.class, () -> service.rebuild("org-1", admin));
        assertEquals("NEO4J_GRAPH_SYNC_FAILED", error.code());
        verify(runs).failed("run-1", true, "NEO4J_GRAPH_SYNC_FAILED", "write failed");
        verify(runs, org.mockito.Mockito.never()).completed(anyString(), any());
    }

    @Test
    void incrementalConfirmedOrganizationDeletionPurgesOnlyThatScope() {
        GraphSyncRun pending = run("run-delete", "pending");
        GraphSyncRun completed = run("run-delete", "completed");
        when(runs.createLocked(anyString(), anyString(), anyString(), anyString(), anyString(), any()))
                .thenReturn(pending);
        when(batches.build("org-1", "run-delete")).thenThrow(new GraphSyncException(
                "GRAPH_SYNC_ORGANIZATION_NOT_FOUND", "missing", false));
        when(graph.replaceOrganization("org-1", "run-delete", 10L, new GraphBatch(List.of(), List.of())))
                .thenReturn(new GraphWriter.WriteResult(0, 0, 2, 1));
        when(runs.latest("org-1")).thenReturn(Optional.of(completed));

        GraphSyncRun result = service.rebuild("org-1", "scheduler", "incremental-rebuild", "scheduler",
                Map.of("organizationDeleted", true));

        assertEquals("completed", result.status());
        verify(graph).replaceOrganization("org-1", "run-delete", 10L, new GraphBatch(List.of(), List.of()));
    }

    private static GraphSyncRun run(String id, String status) {
        Instant now = Instant.now();
        return new GraphSyncRun(id, "org-rebuild", status, "organization", "org-1", "manual", "user",
                Map.of("fencingToken", 10L), 0, 0, null, null, null, null, now, now);
    }

    private static AuthSession owner(String organizationId, String role) {
        return new AuthSession("session", "user", "用户",
                new AccessScope(organizationId, List.of(), List.of(), List.of(role)), Instant.MAX);
    }
}
