package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionManagementPort;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionManagementService;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class IngestionManagementController {
    private final CookieSessionAuthenticator auth;
    private final IngestionManagementService service;

    public IngestionManagementController(CookieSessionAuthenticator auth, IngestionManagementService service) {
        this.auth = auth;
        this.service = service;
    }

    @GetMapping("/api/admin/ingestion/overview")
    public IngestionManagementPort.Overview overview(HttpServletRequest request) {
        return service.overview(auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。")));
    }
}
