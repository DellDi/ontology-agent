package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GraphSyncBootstrapServiceTest {
    private final GraphSyncRunRepository runs = mock(GraphSyncRunRepository.class);
    private final GraphSyncBootstrapRepository repository = mock(GraphSyncBootstrapRepository.class);
    private final GraphSyncService rebuilds = mock(GraphSyncService.class);
    private final GraphSyncLease leases = mock(GraphSyncLease.class);
    private final GraphSyncLease.Guard guard = mock(GraphSyncLease.Guard.class);
    private final GraphSyncBootstrapService service = new GraphSyncBootstrapService(runs, repository, rebuilds,
            leases);

    GraphSyncBootstrapServiceTest() {
        when(leases.start(anyString())).thenReturn(guard);
    }

    @Test
    void fullBootstrapPersistsParentChildrenAndInitializesAllCursorsOnlyAtTheEnd() {
        List<GraphSyncWatermark> watermarks = watermarks(0);
        GraphSyncRun parent = run("parent", "full-bootstrap", "pending", "all", "all", 0, 0);
        GraphSyncRun org1 = run("child-1", "org-rebuild", "completed", "organization", "org-1", 3, 2);
        GraphSyncRun org2 = run("child-2", "org-rebuild", "completed", "organization", "org-2", 4, 1);
        GraphSyncRun completed = run("parent", "full-bootstrap", "completed", "all", "all", 7, 3);
        when(repository.captureWatermarks()).thenReturn(watermarks);
        when(runs.createBootstrapLocked(anyString(), anyString(), any())).thenReturn(parent);
        when(repository.activeOrganizationIds()).thenReturn(List.of("org-1", "org-2"));
        when(repository.deletedOrganizationIds()).thenReturn(List.of());
        when(rebuilds.rebuild("org-1", "system-ops", "org-rebuild", "system",
                Map.of("parentRunId", "parent", "correlationId", "trace-1"))).thenReturn(org1);
        when(rebuilds.rebuild("org-2", "system-ops", "org-rebuild", "system",
                Map.of("parentRunId", "parent", "correlationId", "trace-1"))).thenReturn(org2);
        when(repository.complete("parent", watermarks, 2, 7, 3)).thenReturn(completed);

        assertEquals(completed, service.run("trace-1"));

        var order = inOrder(runs, rebuilds, repository);
        order.verify(runs).running("parent");
        order.verify(rebuilds).rebuild("org-1", "system-ops", "org-rebuild", "system",
                Map.of("parentRunId", "parent", "correlationId", "trace-1"));
        order.verify(rebuilds).rebuild("org-2", "system-ops", "org-rebuild", "system",
                Map.of("parentRunId", "parent", "correlationId", "trace-1"));
        order.verify(repository).complete("parent", watermarks, 2, 7, 3);
    }

    @Test
    void childFailureFailsParentWithoutErasingCompletedChildFactsOrAdvancingCursors() {
        List<GraphSyncWatermark> watermarks = watermarks(0);
        GraphSyncRun parent = run("parent", "full-bootstrap", "pending", "all", "all", 0, 0);
        when(repository.captureWatermarks()).thenReturn(watermarks);
        when(runs.createBootstrapLocked(anyString(), anyString(), any())).thenReturn(parent);
        when(repository.activeOrganizationIds()).thenReturn(List.of("org-1", "org-2"));
        when(repository.deletedOrganizationIds()).thenReturn(List.of());
        when(rebuilds.rebuild(eq("org-1"), eq("system-ops"), eq("org-rebuild"), eq("system"), any()))
                .thenReturn(run("child-1", "org-rebuild", "completed", "organization", "org-1", 3, 2));
        when(rebuilds.rebuild(eq("org-2"), eq("system-ops"), eq("org-rebuild"), eq("system"), any()))
                .thenThrow(new BackendException("NEO4J_GRAPH_SYNC_FAILED", "neo4j failed"));

        BackendException error = assertThrows(BackendException.class, () -> service.run("trace-1"));

        assertEquals("NEO4J_GRAPH_SYNC_FAILED", error.code());
        verify(runs).failed("parent", false, "NEO4J_GRAPH_SYNC_FAILED", "neo4j failed");
        verify(repository, never()).complete(anyString(), any(), anyInt(), anyInt(), anyInt());
        verify(rebuilds).rebuild(eq("org-1"), eq("system-ops"), eq("org-rebuild"), eq("system"), any());
    }

    @Test
    void invalidWatermarkFailsParentBeforeAnyOrganizationWrite() {
        List<GraphSyncWatermark> watermarks = watermarks(0);
        watermarks.set(0, new GraphSyncWatermark(watermarks.getFirst().sourceName(), null, null, 1));
        when(repository.captureWatermarks()).thenReturn(watermarks);
        when(runs.createBootstrapLocked(anyString(), anyString(), any())).thenReturn(
                run("parent", "full-bootstrap", "pending", "all", "all", 0, 0));

        BackendException error = assertThrows(BackendException.class, () -> service.run("trace-1"));

        assertEquals("GRAPH_SYNC_BOOTSTRAP_SOURCE_INVALID", error.code());
        verify(runs).failed("parent", false, error.code(), error.getMessage());
        verify(repository, never()).activeOrganizationIds();
        verify(rebuilds, never()).rebuild(anyString(), anyString(), anyString(), anyString(), any());
    }

    @Test
    void statusReturnsLatestParentFact() {
        GraphSyncRun parent = run("parent", "full-bootstrap", "failed", "all", "all", 0, 0);
        when(runs.latestBootstrap()).thenReturn(Optional.of(parent));
        assertEquals(parent, service.status());
    }

    private static List<GraphSyncWatermark> watermarks(int invalidRows) {
        Instant at = Instant.parse("2026-08-22T00:00:00Z");
        return new java.util.ArrayList<>(Arrays.stream(GraphSyncSource.values())
                .map(source -> new GraphSyncWatermark(source.sourceName(), at, "pk", invalidRows)).toList());
    }

    private static GraphSyncRun run(String id, String mode, String status, String scopeType, String scopeKey,
                                    int nodes, int edges) {
        Instant now = Instant.now();
        return new GraphSyncRun(id, mode, status, scopeType, scopeKey, "system", "system-ops",
                Map.of("fencingToken", 10L), nodes, edges, null, null, now, now, now, now);
    }
}
