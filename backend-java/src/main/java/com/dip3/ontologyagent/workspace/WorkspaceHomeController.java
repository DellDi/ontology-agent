package com.dip3.ontologyagent.workspace;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public final class WorkspaceHomeController {
    private final CookieSessionAuthenticator auth;
    private final WorkspaceHomeService homes;

    public WorkspaceHomeController(CookieSessionAuthenticator auth, WorkspaceHomeService homes) {
        this.auth = auth;
        this.homes = homes;
    }

    @GetMapping("/api/workspace/home")
    public WorkspaceHomeResponse home(HttpServletRequest request) {
        AuthSession viewer = auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
        return homes.load(viewer);
    }
}
