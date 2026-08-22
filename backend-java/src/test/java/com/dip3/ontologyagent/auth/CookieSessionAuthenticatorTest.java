package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CookieSessionAuthenticatorTest {
    private static final String SECRET = "contract-session-secret";

    @Test
    void acceptsTheExistingDip3CookieAndLoadsIdentityFromTheServerStore() throws Exception {
        AuthSessionRepository sessions = mock(AuthSessionRepository.class);
        AuthSession expected = new AuthSession("session-1", "user-1", "用户",
                new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(60));
        when(sessions.findValid("session-1")).thenReturn(java.util.Optional.of(expected));
        CookieSessionAuthenticator authenticator = new CookieSessionAuthenticator(sessions, properties());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(CookieSessionAuthenticator.COOKIE_NAME, signed("session-1")));

        assertEquals(expected, authenticator.authenticate(request).orElseThrow());
        verify(sessions).findValid("session-1");
    }

    @Test
    void rejectsTamperedCookiesBeforeAnySessionLookup() {
        AuthSessionRepository sessions = mock(AuthSessionRepository.class);
        CookieSessionAuthenticator authenticator = new CookieSessionAuthenticator(sessions, properties());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(CookieSessionAuthenticator.COOKIE_NAME, "c2Vzc2lvbi0x.invalid"));

        assertTrue(authenticator.authenticate(request).isEmpty());
        verify(sessions, never()).findValid(org.mockito.ArgumentMatchers.anyString());
    }

    private static BackendProperties properties() {
        return new BackendProperties(SECRET, "test",
                new BackendProperties.Cube("http://cube", "secret", Duration.ofSeconds(1)),
                new BackendProperties.Neo4j("bolt://neo4j", "neo4j", "secret", "neo4j"),
                new BackendProperties.Worker(false, Duration.ofSeconds(1)),
                new BackendProperties.Stream(Duration.ofMillis(10), Duration.ofSeconds(1)),
                "", "", false, false, false);
    }

    private static String signed(String sessionId) throws Exception {
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(sessionId.getBytes(StandardCharsets.UTF_8));
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return payload + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
    }
}
