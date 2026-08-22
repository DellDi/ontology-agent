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
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class GraphSyncIncrementalServiceTest {
    private final GraphSyncSourceMapper sources = mock(GraphSyncSourceMapper.class);
    private final GraphSyncIncrementalRepository state = mock(GraphSyncIncrementalRepository.class);
    private final GraphSyncService rebuilds = mock(GraphSyncService.class);
    private final GraphSyncRunRepository runs = mock(GraphSyncRunRepository.class);
    private final GraphSyncLease leases = mock(GraphSyncLease.class);
    private final GraphSyncLease.Guard guard = mock(GraphSyncLease.Guard.class);
    private final GraphSyncIncrementalService service;

    GraphSyncIncrementalServiceTest() {
        when(leases.start(anyString())).thenReturn(guard);
        service = new GraphSyncIncrementalService(sources, state, rebuilds, runs, leases);
    }

    @Test
    void advancesCursorOnlyAfterEveryDirtyScopeCompletes() {
        Instant at = Instant.parse("2026-08-14T00:00:00Z");
        GraphSyncRun sourceRun = run("source-run", "incremental-scan", "running", "all", "erp.payments");
        GraphSyncDirtyScope first = scope("dirty-1", "org-1", at, "1");
        GraphSyncDirtyScope second = scope("dirty-2", "org-2", at.plusSeconds(1), "2");
        when(runs.createSourceLocked(anyString(), anyString(), anyString())).thenReturn(sourceRun);
        when(sources.scanPayments(null, null, GraphSyncIncrementalService.SCAN_LIMIT)).thenReturn(List.of(
                new GraphSyncChange("1", "org-1", at),
                new GraphSyncChange("2", "org-2", at.plusSeconds(1))));
        when(state.pending("erp.payments")).thenReturn(List.of(first, second));
        when(rebuilds.rebuild(anyString(), anyString(), anyString(), anyString(), any())).thenAnswer(invocation ->
                run("run-" + invocation.getArgument(0), "incremental-rebuild", "completed", "organization",
                        invocation.getArgument(0)));

        GraphSyncIncrementalResult result = service.runScheduled("erp.payments");

        assertEquals(List.of("org-1", "org-2"), result.rebuiltOrganizations());
        verify(state).claim("dirty-1", "source-run");
        verify(state).claim("dirty-2", "source-run");
        verify(state).advance(anyString(), any(GraphSyncChange.class), anyString());
        verify(runs).completed("source-run", new GraphWriter.WriteResult(0, 0, 0, 0));
    }

    @Test
    void failureKeepsCursorAndPersistsDirtyAndRunFailure() {
        Instant at = Instant.parse("2026-08-14T00:00:00Z");
        GraphSyncRun sourceRun = run("source-run", "incremental-scan", "running", "all", "erp.payments");
        GraphSyncDirtyScope scope = scope("dirty-1", "org-1", at, "1");
        when(runs.createSourceLocked(anyString(), anyString(), anyString())).thenReturn(sourceRun);
        when(sources.scanPayments(null, null, GraphSyncIncrementalService.SCAN_LIMIT)).thenReturn(List.of(
                new GraphSyncChange("1", "org-1", at)));
        when(state.pending("erp.payments")).thenReturn(List.of(scope));
        when(rebuilds.rebuild(anyString(), anyString(), anyString(), anyString(), any()))
                .thenThrow(new BackendException("NEO4J_GRAPH_SYNC_FAILED", "neo4j failed"));

        BackendException error = assertThrows(BackendException.class,
                () -> service.runScheduled("erp.payments"));

        assertEquals("GRAPH_SYNC_DIRTY_SCOPE_FAILED", error.code());
        verify(state).failed("dirty-1", "source-run", "neo4j failed");
        verify(state, never()).advance(anyString(), any(), anyString());
        verify(runs).failed("source-run", false, "GRAPH_SYNC_DIRTY_SCOPE_FAILED",
                "组织 org-1 重建失败，source cursor 未推进。 ");
    }

    @Test
    void missingOrganizationStopsBeforeDispatchAndCursor() {
        Instant at = Instant.parse("2026-08-14T00:00:00Z");
        when(runs.createSourceLocked(anyString(), anyString(), anyString())).thenReturn(
                run("source-run", "incremental-scan", "running", "all", "erp.charge_items"));
        when(sources.scanChargeItems(null, null, GraphSyncIncrementalService.SCAN_LIMIT)).thenReturn(List.of(
                new GraphSyncChange("charge-1", null, at)));

        BackendException error = assertThrows(BackendException.class,
                () -> service.runScheduled("erp.charge_items"));

        assertEquals("GRAPH_SYNC_SCOPE_MISSING", error.code());
        verify(state, never()).record(any(), any());
        verify(state, never()).advance(anyString(), any(), anyString());
        verify(rebuilds, never()).rebuild(anyString(), anyString(), anyString(), anyString(), any());
        verify(runs).failed("source-run", false, "GRAPH_SYNC_SCOPE_MISSING", error.getMessage());
    }

    @Test
    void missingCursorTimeFailsSourceWithoutDirtyScopeOrAdvance() {
        when(runs.createSourceLocked(anyString(), anyString(), anyString())).thenReturn(
                run("source-run", "incremental-scan", "running", "all", "erp.projects"));
        when(sources.scanProjects(null, null, GraphSyncIncrementalService.SCAN_LIMIT)).thenReturn(List.of(
                new GraphSyncChange("deleted-project", "org-1", null)));

        BackendException error = assertThrows(BackendException.class,
                () -> service.runScheduled("erp.projects"));

        assertEquals("GRAPH_SYNC_CURSOR_MISSING", error.code());
        verify(state, never()).record(any(), any());
        verify(state, never()).advance(anyString(), any(), anyString());
        verify(runs).failed("source-run", false, "GRAPH_SYNC_CURSOR_MISSING", error.getMessage());
    }

    @Test
    void schedulerUsesSystemTriggerWithoutForgingAuthSession() {
        Instant at = Instant.parse("2026-08-14T00:00:00Z");
        when(runs.createSourceLocked(anyString(), anyString(), anyString())).thenReturn(
                run("source-run", "incremental-scan", "running", "all", "erp.payments"));
        when(sources.scanPayments(null, null, GraphSyncIncrementalService.SCAN_LIMIT)).thenReturn(List.of(
                new GraphSyncChange("1", "org-1", at)));
        when(state.pending("erp.payments")).thenReturn(List.of(scope("dirty-1", "org-1", at, "1")));
        when(rebuilds.rebuild(anyString(), anyString(), anyString(), anyString(), any())).thenReturn(
                run("org-run", "incremental-rebuild", "completed", "organization", "org-1"));

        service.runScheduled("erp.payments");

        verify(rebuilds).rebuild("org-1", "graph-sync-scheduler", "incremental-rebuild", "scheduler",
                Map.of("erp.payments", Map.of("cursorTime", at.toString(), "cursorPk", "1")));
    }

    @Test
    void manualGlobalScanAndCrossOrganizationSweepAreForbidden() {
        BackendException scan = assertThrows(BackendException.class,
                () -> service.run("erp.payments", admin()));
        assertEquals("GRAPH_SYNC_GLOBAL_OPERATION_FORBIDDEN", scan.code());
        verifyNoInteractions(sources, state, rebuilds, runs);
    }

    private static AuthSession admin() {
        return new AuthSession("session", "admin", "管理员",
                new AccessScope("org-1", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
    }

    private static GraphSyncDirtyScope scope(String id, String org, Instant at, String pk) {
        return new GraphSyncDirtyScope(id, "organization", org, "payments-changed", "erp.payments", pk,
                Map.of("erp.payments", Map.of("cursorTime", at.toString(), "cursorPk", pk)), at, at,
                "pending", 0, null, null);
    }

    private static GraphSyncRun run(String id, String mode, String status, String type, String key) {
        Instant now = Instant.now();
        return new GraphSyncRun(id, mode, status, type, key, "scheduler", "admin", Map.of(), 0, 0,
                null, null, null, null, now, now);
    }
}
