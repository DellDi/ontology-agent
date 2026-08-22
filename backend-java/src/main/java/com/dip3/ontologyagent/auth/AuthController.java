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
import java.util.List;

/**
 * 认证入口：登录/退出/回调/桥接均由 Java 承载，Next 侧只做透明代理。
 *
 * <p>成功与失败均以 303 + Location 返回（与历史行为一致），会话通过 Set-Cookie 下发。
 */
@RestController
public final class AuthController {
    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private static final String GENERIC_LOGIN_ERROR = "登录流程出现异常，请稍后重试或联系管理员。";
    private static final String GENERIC_DIRECTORY_ERROR = "登录失败，请稍后重试或联系管理员。";

    private final AuthLoginService auth;
    private final CookieSessionAuthenticator cookieAuth;
    private final BackendProperties properties;

    public AuthController(AuthLoginService auth, CookieSessionAuthenticator cookieAuth,
                          BackendProperties properties) {
        this.auth = auth;
        this.cookieAuth = cookieAuth;
        this.properties = properties;
    }

    /** 开发联调登录（手填 scope）。 */
    @PostMapping("/api/auth/login")
    public ResponseEntity<Void> login(HttpServletRequest request) {
        try {
            AuthLoginService.LoginResult result = auth.devLogin(
                    new AuthLoginService.DevLoginCommand(
                            param(request, "employeeId"),
                            param(request, "displayName"),
                            param(request, "organizationId"),
                            scopeValues(request, "projectIds"),
                            scopeValues(request, "areaIds"),
                            scopeValues(request, "roleCodes")),
                    param(request, "next"));
            return redirect(result.nextPath(), cookieAuth.createSessionCookie(
                    result.session().sessionId(), properties.cookieSecure()));
        } catch (BackendException error) {
            return loginErrorRedirect(request, error.getMessage(), null);
        } catch (Exception error) {
            log.error("auth_dev_login_failed", error);
            return loginErrorRedirect(request, GENERIC_LOGIN_ERROR, null);
        }
    }

    /** 目录账号密码登录。 */
    @PostMapping("/api/auth/directory-login")
    public ResponseEntity<Void> directoryLogin(HttpServletRequest request) {
        String account = param(request, "account");
        try {
            AuthLoginService.LoginResult result = auth.directoryLogin(
                    account, param(request, "password"), param(request, "next"));
            return redirect(result.nextPath(), cookieAuth.createSessionCookie(
                    result.session().sessionId(), properties.cookieSecure()));
        } catch (BackendException error) {
            return loginErrorRedirect(request, error.getMessage(), account);
        } catch (Exception error) {
            log.error("auth_directory_login_failed account={}", account, error);
            return loginErrorRedirect(request, GENERIC_DIRECTORY_ERROR, account);
        }
    }

    /** URL 桥接登录。 */
    @GetMapping("/api/auth/bridge")
    public ResponseEntity<Void> bridge(HttpServletRequest request) {
        String account = param(request, "account");
        if (account == null || account.isBlank()) {
            return loginErrorRedirect(request, "URL 桥接入口缺少 account 参数。", null);
        }
        try {
            AuthLoginService.LoginResult result = auth.urlBridgeLogin(account, param(request, "next"));
            return redirect(result.nextPath(), cookieAuth.createSessionCookie(
                    result.session().sessionId(), properties.cookieSecure()));
        } catch (BackendException error) {
            return loginErrorRedirect(request, error.getMessage(), account);
        } catch (Exception error) {
            log.error("auth_bridge_login_failed account={}", account, error);
            return loginErrorRedirect(request, GENERIC_DIRECTORY_ERROR, account);
        }
    }

    /** 回调登录（开发联调 ticket / query 参数）。 */
    @GetMapping("/api/auth/callback")
    public ResponseEntity<Void> callback(HttpServletRequest request) {
        try {
            AuthLoginService.LoginResult result = auth.callbackLogin(
                    param(request, "ticket"),
                    param(request, "employeeId"),
                    param(request, "displayName"),
                    param(request, "organizationId"),
                    param(request, "projectIds"),
                    param(request, "areaIds"),
                    param(request, "roleCodes"),
                    param(request, "next"));
            return redirect(result.nextPath(), cookieAuth.createSessionCookie(
                    result.session().sessionId(), properties.cookieSecure()));
        } catch (BackendException error) {
            return loginErrorRedirect(request, error.getMessage(), null);
        } catch (Exception error) {
            log.error("auth_callback_login_failed", error);
            return loginErrorRedirect(request, GENERIC_LOGIN_ERROR, null);
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

    /** 登录页状态：目录登录、开发联调登录、URL 桥接是否可用。 */
    @GetMapping("/api/auth/config")
    public AuthConfigResponse config() {
        return new AuthConfigResponse(
                properties.directoryAuthAvailable(),
                properties.devAuthEnabled(),
                properties.urlBridgeEnabled() && properties.directoryAuthAvailable());
    }

    private static String param(HttpServletRequest request, String name) {
        String value = request.getParameter(name);
        return value == null ? null : value.trim();
    }

    private static List<String> scopeValues(HttpServletRequest request, String name) {
        String raw = request.getParameter(name);
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return List.of(raw.split(","));
    }

    private ResponseEntity<Void> redirect(String location, org.springframework.http.ResponseCookie cookie) {
        return ResponseEntity.status(303)
                .header(HttpHeaders.LOCATION, location)
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .build();
    }

    private ResponseEntity<Void> loginErrorRedirect(HttpServletRequest request, String message, String account) {
        String location = "/login?error=" + encode(message);
        String next = request.getParameter("next");
        if (next != null && next.startsWith("/")) {
            location += "&next=" + encode(AuthLoginService.sanitizeNextPath(next));
        }
        if (account != null && !account.isBlank()) {
            location += "&account=" + encode(account.trim());
        }
        return ResponseEntity.status(303).header(HttpHeaders.LOCATION, location).build();
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
