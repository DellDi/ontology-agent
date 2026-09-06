package com.dip3.ontologyagent.graphsync;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class GraphSyncBootstrapServiceTest {
    private static final GraphProjection PROJECTION = new GraphProjection(
            "property-set-1", Map.of("property-project", "project-version-1"));
    private final GraphSyncRunRepository runs = mock(GraphSyncRunRepository.class);
    private final GraphBatchBuilder batches = mock(GraphBatchBuilder.class);
    private final GraphSyncService rebuilds = mock(GraphSyncService.class);
    private final GraphSyncLease leases = mock(GraphSyncLease.class);
    private final GraphSyncLease.Guard guard = mock(GraphSyncLease.Guard.class);
    private final GraphSyncBootstrapService service = new GraphSyncBootstrapService(
            runs, batches, rebuilds, leases);

    GraphSyncBootstrapServiceTest() {
        when(leases.start(anyString())).thenReturn(guard);
        when(batches.latestProjection()).thenReturn(PROJECTION);
    }

    @Test
    void fullBootstrapPersistsCanonicalBindingAndCompletesAfterAllOrganizations() {
        GraphSyncRun parent = run("parent", "full-bootstrap", "pending", "all", "all", 0, 0);
        GraphSyncRun org1 = run("child-1", "org-rebuild", "completed", "organization", "org-1", 3, 2);
        GraphSyncRun org2 = run("child-2", "org-rebuild", "completed", "organization", "org-2", 4, 1);
        GraphSyncRun completed = run("parent", "full-bootstrap", "completed", "all", "all", 7, 3);
        when(runs.createBootstrapLocked(anyString(), anyString(), any())).thenReturn(parent);
        when(batches.activeOrganizationIds(PROJECTION)).thenReturn(List.of("org-1", "org-2"));
        when(rebuilds.rebuild(eq("org-1"), eq("system-ops"), eq("org-rebuild"), eq("system"),
                any(), eq(PROJECTION))).thenReturn(org1);
        when(rebuilds.rebuild(eq("org-2"), eq("system-ops"), eq("org-rebuild"), eq("system"),
                any(), eq(PROJECTION))).thenReturn(org2);
        when(runs.latestBootstrap()).thenReturn(Optional.of(completed));

        assertEquals(completed, service.run("trace-1"));

        var order = inOrder(runs, rebuilds);
        order.verify(runs).running("parent");
        order.verify(rebuilds).rebuild(eq("org-1"), eq("system-ops"), eq("org-rebuild"),
                eq("system"), any(), eq(PROJECTION));
        order.verify(rebuilds).rebuild(eq("org-2"), eq("system-ops"), eq("org-rebuild"),
                eq("system"), any(), eq(PROJECTION));
        order.verify(runs).completed("parent", new GraphWriter.WriteResult(7, 3, 0, 0));
    }

    @Test
    void childFailureFailsParentAndPreservesPartialFlag() {
        when(runs.createBootstrapLocked(anyString(), anyString(), any())).thenReturn(
                run("parent", "full-bootstrap", "pending", "all", "all", 0, 0));
        when(batches.activeOrganizationIds(PROJECTION)).thenReturn(List.of("org-1", "org-2"));
        when(rebuilds.rebuild(eq("org-1"), anyString(), anyString(), anyString(), any(), eq(PROJECTION)))
                .thenReturn(run("child-1", "org-rebuild", "completed", "organization", "org-1", 3, 2));
        when(rebuilds.rebuild(eq("org-2"), anyString(), anyString(), anyString(), any(), eq(PROJECTION)))
                .thenThrow(new BackendException("NEO4J_GRAPH_SYNC_FAILED", "neo4j failed"));

        BackendException error = assertThrows(BackendException.class, () -> service.run("trace-1"));

        assertEquals("NEO4J_GRAPH_SYNC_FAILED", error.code());
        verify(runs).failed("parent", true, "NEO4J_GRAPH_SYNC_FAILED", "neo4j failed");
    }

    @Test
    void schedulerSkipsAlreadyCompletedDatasetVersionSet() {
        GraphSyncRun completed = new GraphSyncRun("parent", "full-bootstrap", "completed", "all", "all",
                "system", "system-ops", Map.of("datasetVersionSetId", "property-set-1"),
                7, 3, null, null, Instant.now(), Instant.now(), Instant.now(), Instant.now());
        when(runs.latestBootstrap()).thenReturn(Optional.of(completed));

        assertEquals(Optional.empty(), service.runIfOutdated("trace-1"));
    }

    @Test
    void statusReturnsLatestParentFact() {
        GraphSyncRun parent = run("parent", "full-bootstrap", "failed", "all", "all", 0, 0);
        when(runs.latestBootstrap()).thenReturn(Optional.of(parent));
        assertEquals(parent, service.status());
    }

    private static GraphSyncRun run(String id, String mode, String status, String scopeType, String scopeKey,
                                    int nodes, int edges) {
        Instant now = Instant.now();
        return new GraphSyncRun(id, mode, status, scopeType, scopeKey, "system", "system-ops",
                Map.of("fencingToken", 10L), nodes, edges, null, null, now, now, now, now);
    }
}
