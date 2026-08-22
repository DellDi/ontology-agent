package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;
import java.util.Optional;

@Component
public final class CookieSessionAuthenticator {
    public static final String COOKIE_NAME = "dip3_session";
    private final AuthSessionRepository sessions;
    private final byte[] secret;

    public CookieSessionAuthenticator(AuthSessionRepository sessions, BackendProperties properties) {
        this.sessions = sessions;
        this.secret = properties.sessionSecret().getBytes(StandardCharsets.UTF_8);
    }

    public Optional<AuthSession> authenticate(HttpServletRequest request) {
        String value = Arrays.stream(request.getCookies() == null ? new Cookie[0] : request.getCookies())
                .filter(cookie -> COOKIE_NAME.equals(cookie.getName())).map(Cookie::getValue).findFirst().orElse(null);
        String sessionId = verify(value);
        return sessionId == null ? Optional.empty() : sessions.findValid(sessionId);
    }

    private String verify(String cookieValue) {
        if (cookieValue == null) return null;
        String[] parts = cookieValue.split("\\.", -1);
        if (parts.length != 2 || parts[0].isBlank() || parts[1].isBlank()) return null;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            byte[] expected = mac.doFinal(parts[0].getBytes(StandardCharsets.UTF_8));
            byte[] actual = Base64.getUrlDecoder().decode(parts[1]);
            if (!MessageDigest.isEqual(expected, actual)) return null;
            String sessionId = new String(Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8);
            return sessionId.isBlank() ? null : sessionId;
        } catch (Exception ignored) {
            return null;
        }
    }
}
