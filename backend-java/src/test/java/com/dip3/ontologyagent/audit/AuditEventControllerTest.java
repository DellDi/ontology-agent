package com.dip3.ontologyagent.audit;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AuditEventControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final AuditEventMapper events = mock(AuditEventMapper.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new AuditEventController(auth, events))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void requiresAuthentication() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());
        mvc.perform(get("/api/admin/audit/events"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    }

    @Test
    void rejectsNonAdmin() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(actor("WORKSPACE_USER")));
        mvc.perform(get("/api/admin/audit/events"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("AUDIT_FORBIDDEN"));
    }

    @Test
    void scopesReadToAuthenticatedOrganization() throws Exception {
        AuthSession admin = actor("PLATFORM_ADMIN");
        Instant now = Instant.now();
        AuditEvent event = new AuditEvent("event-1", admin.userId(), "org-1", admin.sessionId(),
                "ontology.version.published", "succeeded", "application", "trace-1",
                Map.of("ontologyVersionId", "ontology-v2"), now, now.plusSeconds(3600));
        when(auth.authenticate(any())).thenReturn(Optional.of(admin));
        when(events.recent("org-1", 5)).thenReturn(List.of(event));

        mvc.perform(get("/api/admin/audit/events?limit=5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].organizationId").value("org-1"))
                .andExpect(jsonPath("$.items[0].correlationId").value("trace-1"));
        verify(events).recent("org-1", 5);
    }

    @Test
    void rejectsInvalidLimitInsteadOfSilentlyClamping() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(actor("PLATFORM_ADMIN")));
        mvc.perform(get("/api/admin/audit/events?limit=101"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("AUDIT_LIMIT_INVALID"));
    }

    private static AuthSession actor(String role) {
        return new AuthSession("session-1", "user-1", "用户",
                new AccessScope("org-1", List.of(), List.of(), List.of(role)), Instant.MAX);
    }
}
