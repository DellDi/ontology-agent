package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public final class AnalysisSessionReadController {
    private final CookieSessionAuthenticator auth;
    private final AnalysisSessionReadService sessions;

    public AnalysisSessionReadController(CookieSessionAuthenticator auth, AnalysisSessionReadService sessions) {
        this.auth = auth;
        this.sessions = sessions;
    }

    @GetMapping("/api/analysis/sessions/{sessionId}")
    public AnalysisSessionAggregate session(@PathVariable String sessionId,
                                            @RequestParam(required = false) String executionId,
                                            HttpServletRequest request) {
        AuthSession viewer = auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
        return sessions.load(sessionId, executionId, viewer);
    }
}
