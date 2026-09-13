package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionAccessService;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/admin/ingestion/access")
public class IngestionAccessController {
    private final CookieSessionAuthenticator auth;
    private final IngestionAccessService service;
    public IngestionAccessController(CookieSessionAuthenticator auth, IngestionAccessService service) {
        this.auth = auth; this.service = service;
    }
    public record GrantCommand(String sourceKey, String organizationId, Boolean enabled) {}
    @GetMapping
    public IngestionAccessService.Access access(HttpServletRequest request) {
        return service.access(auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。")));
    }
    @PutMapping(consumes = "application/json")
    public IngestionAccessService.Access grant(@RequestBody GrantCommand command, HttpServletRequest request) {
        return service.setGrant(command.sourceKey(), command.organizationId(), command.enabled(),
                auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。")));
    }
}
