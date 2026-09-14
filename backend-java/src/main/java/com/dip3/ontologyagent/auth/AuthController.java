package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * 认证入口：账号密码登录、URL 桥接、退出均由 Java 承载，Next 侧只做透明代理。
 *
 * <p>成功与失败均以 303 + Location 返回（与历史行为一致），会话通过 Set-Cookie 下发。
 */
@RestController
public final class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private static final String GENERIC_LOGIN_ERROR = "登录流程出现异常，请稍后重试或联系管理员。";

    private final AuthLoginService auth;
    private final CookieSessionAuthenticator cookieAuth;
    private final BackendProperties properties;

    public AuthController(AuthLoginService auth, CookieSessionAuthenticator cookieAuth,
                          BackendProperties properties) {
        this.auth = auth;
        this.cookieAuth = cookieAuth;
        this.properties = properties;
    }

    /** 统一账号密码登录（Provider 分发）。 */
    @PostMapping("/api/auth/login")
    public ResponseEntity<Void> login(HttpServletRequest request) {
        String account = param(request, "account");
        try {
            AuthLoginService.LoginResult result = auth.login(
                    account, param(request, "password"), param(request, "next"));
            return redirect(result.nextPath(), cookieAuth.createSessionCookie(
                    result.session().sessionId(), properties.cookieSecure()));
        } catch (BackendException error) {
            return loginErrorRedirect(request, error.getMessage(), account);
        } catch (Exception error) {
            log.error("auth_login_failed account={}", account, error);
            return loginErrorRedirect(request, GENERIC_LOGIN_ERROR, account);
        }
    }

    /** URL 桥接登录（可信上游平台携带已验证账号）。 */
    @GetMapping("/api/auth/bridge")
    public ResponseEntity<Void> bridge(HttpServletRequest request) {
        String account = param(request, "account");
        if (account == null || account.isBlank()) {
            return loginErrorRedirect(request, "URL 桥接入口缺少 account 参数。", null);
        }
        try {
            AuthLoginService.LoginResult result = auth.bridgeLogin(account, param(request, "next"));
            return redirect(result.nextPath(), cookieAuth.createSessionCookie(
                    result.session().sessionId(), properties.cookieSecure()));
        } catch (BackendException error) {
            return loginErrorRedirect(request, error.getMessage(), account);
        } catch (Exception error) {
            log.error("auth_bridge_login_failed account={}", account, error);
            return loginErrorRedirect(request, GENERIC_LOGIN_ERROR, account);
        }
    }

    /** 退出：删除会话并清除 Cookie。 */
    @PostMapping("/api/auth/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request) {
        cookieAuth.verifiedSessionId(request).ifPresent(auth::logout);
        return ResponseEntity.status(303)
                .header(HttpHeaders.LOCATION, "/login?loggedOut=1")
                .header(HttpHeaders.SET_COOKIE,
                        cookieAuth.clearSessionCookie(properties.cookieSecure()).toString())
                .build();
    }

    /** 登录页状态：账号密码登录与 URL 桥接是否可用。 */
    @GetMapping("/api/auth/config")
    public AuthConfigResponse config() {
        return new AuthConfigResponse(
                properties.auth().providers().local().enabled(),
                properties.auth().providers().bridge().enabled());
    }

    private ResponseEntity<Void> redirect(String location, org.springframework.http.ResponseCookie cookie) {
        return ResponseEntity.status(303)
                .header(HttpHeaders.LOCATION, location)
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .build();
    }

    private ResponseEntity<Void> loginErrorRedirect(HttpServletRequest request, String message,
                                                    String account) {
        StringBuilder location = new StringBuilder("/login?error=")
                .append(URLEncoder.encode(message, StandardCharsets.UTF_8));
        String next = param(request, "next");
        if (next != null && !next.isBlank()) {
            location.append("&next=").append(URLEncoder.encode(
                    AuthLoginService.sanitizeNextPath(next), StandardCharsets.UTF_8));
        }
        if (account != null && !account.isBlank()) {
            location.append("&account=").append(URLEncoder.encode(account, StandardCharsets.UTF_8));
        }
        return ResponseEntity.status(303)
                .header(HttpHeaders.LOCATION, location.toString())
                .build();
    }

    private static String param(HttpServletRequest request, String name) {
        String value = request.getParameter(name);
        return value == null ? null : value.trim();
    }
}
