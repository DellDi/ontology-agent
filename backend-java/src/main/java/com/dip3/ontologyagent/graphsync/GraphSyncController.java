package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.config.TraceFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public final class GraphSyncController {
    private final CookieSessionAuthenticator auth;
    private final GraphSyncService service;
    private final GraphSyncIncrementalService incremental;

    public GraphSyncController(CookieSessionAuthenticator auth, GraphSyncService service,
                               GraphSyncIncrementalService incremental) {
        this.auth = auth;
        this.service = service;
        this.incremental = incremental;
    }

    @PostMapping("/api/admin/graph-sync/organizations/{organizationId}/rebuild")
    public ResponseEntity<GraphSyncRun> rebuild(@PathVariable String organizationId, HttpServletRequest request) {
        return ResponseEntity.ok(service.rebuild(organizationId, requireAuth(request),
                Map.of("correlationId", TraceFilter.from(request))));
    }

    @GetMapping("/api/admin/graph-sync/organizations/{organizationId}/status")
    public GraphSyncRun status(@PathVariable String organizationId, HttpServletRequest request) {
        return service.status(organizationId, requireAuth(request));
    }

    @PostMapping("/api/admin/graph-sync/consistency-sweep")
    public java.util.List<GraphSyncRun> sweep(HttpServletRequest request) {
        return incremental.sweep(requireAuth(request), TraceFilter.from(request));
    }

    @GetMapping("/api/admin/graph-sync/status")
    public GraphSyncStatus status(HttpServletRequest request) {
        return incremental.status(requireAuth(request));
    }

    private AuthSession requireAuth(HttpServletRequest request) {
        return auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。 "));
    }

}
