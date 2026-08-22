package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.TraceFilter;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import static com.dip3.ontologyagent.ontology.governance.GovernanceResponses.*;

@RestController
public class OntologyGovernanceController {
    private final CookieSessionAuthenticator auth;
    private final OntologyGovernanceService governance;

    public OntologyGovernanceController(CookieSessionAuthenticator auth, OntologyGovernanceService governance) {
        this.auth = auth;
        this.governance = governance;
    }

    @GetMapping("/api/admin/ontology/overview")
    public GovernanceOverview overview(HttpServletRequest request) {
        return governance.overview(requireAuth(request));
    }

    @GetMapping("/api/admin/ontology/versions")
    public VersionList versions(@RequestParam(defaultValue = "50") int limit, HttpServletRequest request) {
        return governance.versions(limit, requireAuth(request));
    }

    @GetMapping("/api/admin/ontology/definitions")
    public GovernanceDefinitions definitions(@RequestParam String versionId, HttpServletRequest request) {
        return governance.definitions(versionId, requireAuth(request));
    }

    @GetMapping("/api/admin/ontology/change-requests")
    public ChangeRequestList changeRequests(@RequestParam(required = false) String status,
                                            @RequestParam(defaultValue = "100") int limit,
                                            HttpServletRequest request) {
        return governance.changeRequests(status, limit, requireAuth(request));
    }

    @PostMapping("/api/admin/ontology/change-requests")
    public OntologyChangeRequest create(@RequestBody CreateChangeRequest body, HttpServletRequest request) {
        AuthSession actor = requireAuth(request);
        return governance.create(body, actor, TraceFilter.from(request));
    }

    @GetMapping("/api/admin/ontology/change-requests/{id}")
    public ChangeRequestDetail changeRequest(@PathVariable String id, HttpServletRequest request) {
        return governance.changeRequest(id, requireAuth(request));
    }

    @PostMapping("/api/admin/ontology/change-requests/{id}/submit")
    public OntologyChangeRequest submit(@PathVariable String id, HttpServletRequest request) {
        AuthSession actor = requireAuth(request);
        return governance.submit(id, actor, TraceFilter.from(request));
    }

    @PostMapping("/api/admin/ontology/change-requests/{id}/review")
    public ReviewResult review(@PathVariable String id, @RequestBody ReviewChangeRequest body,
                               HttpServletRequest request) {
        AuthSession actor = requireAuth(request);
        return governance.review(id, body, actor, TraceFilter.from(request));
    }

    @GetMapping("/api/admin/ontology/publishes")
    public PublishHistory publishes(@RequestParam(defaultValue = "50") int limit, HttpServletRequest request) {
        return governance.publishes(limit, requireAuth(request));
    }

    @PostMapping("/api/admin/ontology/versions/{id}/publish")
    public OntologyPublishRecord publish(@PathVariable String id, @RequestBody(required = false) PublishVersion body,
                                         HttpServletRequest request) {
        AuthSession actor = requireAuth(request);
        return governance.publish(id, body, actor, TraceFilter.from(request));
    }

    private AuthSession requireAuth(HttpServletRequest request) {
        return auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    }
}
