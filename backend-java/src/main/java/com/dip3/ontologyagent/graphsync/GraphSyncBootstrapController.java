package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.config.TraceFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestParam;

@RestController
public final class GraphSyncBootstrapController {
    static final String SECRET_HEADER = "X-Graph-Sync-Ops-Secret";
    private final GraphSyncOpsAuthenticator auth;
    private final GraphSyncBootstrapService service;

    public GraphSyncBootstrapController(GraphSyncOpsAuthenticator auth, GraphSyncBootstrapService service) {
        this.auth = auth;
        this.service = service;
    }

    @PostMapping("/api/system/graph-sync/bootstrap")
    public ResponseEntity<GraphSyncRun> bootstrap(
            @RequestHeader(value = SECRET_HEADER, required = false) String secret,
            @RequestParam(required = false) String datasetVersionSetId,
            HttpServletRequest request) {
        auth.authenticate(secret);
        return ResponseEntity.ok(service.run(TraceFilter.from(request), datasetVersionSetId));
    }

    @GetMapping("/api/system/graph-sync/bootstrap/status")
    public GraphSyncRun status(@RequestHeader(value = SECRET_HEADER, required = false) String secret) {
        auth.authenticate(secret);
        return service.status();
    }
}
