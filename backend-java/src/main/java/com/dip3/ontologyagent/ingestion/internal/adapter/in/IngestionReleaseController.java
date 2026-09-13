package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.TraceFilter;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleasePort;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleaseService;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/ingestion/release-tasks")
public class IngestionReleaseController {
    private final CookieSessionAuthenticator auth;
    private final IngestionReleaseService service;

    public IngestionReleaseController(CookieSessionAuthenticator auth, IngestionReleaseService service) {
        this.auth = auth;
        this.service = service;
    }

    @GetMapping
    public IngestionReleaseService.TaskList recent(HttpServletRequest request) {
        return service.recent(actor(request));
    }

    @GetMapping("/{id}")
    public IngestionReleasePort.Task task(@PathVariable String id, HttpServletRequest request) {
        return service.find(id, actor(request));
    }

    @PostMapping(consumes = "application/json")
    public ResponseEntity<IngestionReleasePort.Task> submit(
            @RequestHeader(value = "Idempotency-Key", required = false) String id,
            @RequestBody IngestionReleaseService.Command body, HttpServletRequest request) {
        return ResponseEntity.accepted().body(service.submit(id, body, actor(request), TraceFilter.from(request)));
    }

    @PostMapping(value = "/{previousId}/retry", consumes = "application/json")
    public ResponseEntity<IngestionReleasePort.Task> retry(@PathVariable String previousId,
            @RequestHeader(value = "Idempotency-Key", required = false) String id, HttpServletRequest request) {
        return ResponseEntity.accepted().body(service.retry(previousId, id, actor(request), TraceFilter.from(request)));
    }

    private AuthSession actor(HttpServletRequest request) {
        return auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    }
}
