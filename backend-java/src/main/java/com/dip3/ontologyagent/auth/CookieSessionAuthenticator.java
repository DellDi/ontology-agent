package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;
import java.util.Optional;

/**
 * dip3_session Cookie 的签名/校验与 Session 读取。
 *
 * <p>与历史 Node 实现保持字节级兼容：payload = base64url(sessionId)，
 * signature = base64url(HmacSHA256(secret, payload))，格式 {@code payload.signature}。
 */
@Component
public final class CookieSessionAuthenticator {
    public static final String COOKIE_NAME = "dip3_session";
    private static final Duration SESSION_TTL = Duration.ofHours(8);

    private final AuthSessionRepository sessions;
    private final byte[] secret;

    public CookieSessionAuthenticator(AuthSessionRepository sessions, BackendProperties properties) {
        this.sessions = sessions;
        this.secret = properties.sessionSecret().getBytes(StandardCharsets.UTF_8);
    }

    public Optional<AuthSession> authenticate(HttpServletRequest request) {
        String sessionId = verifiedSessionId(request).orElse(null);
        return sessionId == null ? Optional.empty() : sessions.findValid(sessionId);
    }

    /** 校验 Cookie 签名后返回 sessionId（不校验会话是否仍有效，用于登出清理）。 */
    public Optional<String> verifiedSessionId(HttpServletRequest request) {
        String value = Arrays.stream(request.getCookies() == null ? new Cookie[0] : request.getCookies())
                .filter(cookie -> COOKIE_NAME.equals(cookie.getName()))
                .map(Cookie::getValue)
                .findFirst()
                .orElse(null);
        return Optional.ofNullable(verify(value));
    }

    public String createCookieValue(String sessionId) {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(sessionId.getBytes(StandardCharsets.UTF_8));
        return payload + "." + sign(payload);
    }

    public ResponseCookie createSessionCookie(String sessionId, boolean secure) {
        return ResponseCookie.from(COOKIE_NAME, createCookieValue(sessionId))
                .httpOnly(true)
                .sameSite("Lax")
                .path("/")
                .maxAge(SESSION_TTL)
                .secure(secure)
                .build();
    }

    public ResponseCookie clearSessionCookie(boolean secure) {
        return ResponseCookie.from(COOKIE_NAME, "")
                .httpOnly(true)
                .sameSite("Lax")
                .path("/")
                .maxAge(Duration.ZERO)
                .secure(secure)
                .build();
    }

    private String verify(String cookieValue) {
        if (cookieValue == null) return null;
        String[] parts = cookieValue.split("\\.", -1);
        if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) return null;
        try {
            byte[] expected = hmac(parts[0]);
            byte[] actual = Base64.getUrlDecoder().decode(parts[1]);
            if (!MessageDigest.isEqual(expected, actual)) return null;
            String sessionId = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            return sessionId.isBlank() ? null : sessionId;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String sign(String payload) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(hmac(payload));
    }

    private byte[] hmac(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return mac.doFinal(payload.getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            throw new IllegalStateException("会话签名初始化失败。", error);
        }
    }
}
