package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public final class AuthReadController {
    private final CookieSessionAuthenticator auth;

    public AuthReadController(CookieSessionAuthenticator auth) {
        this.auth = auth;
    }

    @GetMapping("/api/auth/me")
    public ViewerResponse me(HttpServletRequest request) {
        AuthSession viewer = auth.authenticate(request)
                .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
        return ViewerResponse.from(viewer);
    }
}
