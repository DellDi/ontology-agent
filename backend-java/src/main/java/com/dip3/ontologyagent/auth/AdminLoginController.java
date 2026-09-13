package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

@RestController
public class AdminLoginController {
    private final AdminAccountService accounts;
    private final CookieSessionAuthenticator cookies;
    private final BackendProperties properties;
    public AdminLoginController(AdminAccountService accounts, CookieSessionAuthenticator cookies, BackendProperties properties) {
        this.accounts = accounts; this.cookies = cookies; this.properties = properties;
    }
    @PostMapping(value="/api/auth/admin-login", consumes="application/x-www-form-urlencoded")
    public ResponseEntity<Void> login(HttpServletRequest request) {
        var session = accounts.login(request.getParameter("account"), request.getParameter("password"));
        if (session.isEmpty()) return ResponseEntity.status(303).header(HttpHeaders.LOCATION,
                "/login?error=" + URLEncoder.encode("管理员账号或密码错误，或账号暂时锁定。", StandardCharsets.UTF_8)).build();
        return ResponseEntity.status(303).header(HttpHeaders.LOCATION, "/admin/ingestion")
                .header(HttpHeaders.SET_COOKIE, cookies.createSessionCookie(session.get().sessionId(), properties.cookieSecure()).toString()).build();
    }
}
