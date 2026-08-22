package com.dip3.ontologyagent.ontology.bootstrap;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.TraceFilter;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapResponses.Result;
import static com.dip3.ontologyagent.ontology.bootstrap.OntologyBootstrapResponses.Status;

@RestController
public class OntologyBootstrapController {
    private final CookieSessionAuthenticator auth;
    private final OntologyBootstrapService bootstrap;

    public OntologyBootstrapController(CookieSessionAuthenticator auth, OntologyBootstrapService bootstrap) {
        this.auth = auth;
        this.bootstrap = bootstrap;
    }

    @GetMapping("/api/admin/ontology/bootstrap")
    public Status status(HttpServletRequest request) {
        return bootstrap.status(requireAuth(request));
    }

    @PostMapping("/api/admin/ontology/bootstrap")
    public Result bootstrap(HttpServletRequest request) {
        return bootstrap.bootstrap(requireAuth(request), TraceFilter.from(request));
    }

    private AuthSession requireAuth(HttpServletRequest request) {
        return auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    }
}
