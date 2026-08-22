package com.dip3.ontologyagent.graphsync;

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
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GraphSyncControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final GraphSyncService service = mock(GraphSyncService.class);
    private final GraphSyncIncrementalService incremental = mock(GraphSyncIncrementalService.class);
    private final AuthSession admin = new AuthSession("session", "admin", "平台管理员",
            new AccessScope("org-1", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new GraphSyncController(auth, service, incremental))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void rebuildRequiresAuthentication() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());
        mvc.perform(post("/api/admin/graph-sync/organizations/org-1/rebuild"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    }

    @Test
    void rebuildReturnsPersistedTerminalRun() throws Exception {
        GraphSyncRun run = run("completed");
        when(auth.authenticate(any())).thenReturn(Optional.of(admin));
        when(service.rebuild(org.mockito.ArgumentMatchers.eq("org-1"), org.mockito.ArgumentMatchers.eq(admin),
                org.mockito.ArgumentMatchers.anyMap())).thenReturn(run);
        mvc.perform(post("/api/admin/graph-sync/organizations/org-1/rebuild"))
                .andExpect(request -> org.mockito.Mockito.verify(service).rebuild(
                        org.mockito.ArgumentMatchers.eq("org-1"), org.mockito.ArgumentMatchers.eq(admin),
                        org.mockito.ArgumentMatchers.argThat(metadata -> metadata.containsKey("correlationId"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("completed"));
    }

    @Test
    void statusReturnsCanonicalRun() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(admin));
        when(service.status("org-1", admin)).thenReturn(run("running"));
        mvc.perform(get("/api/admin/graph-sync/organizations/org-1/status"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.scopeKey").value("org-1"));
    }

    @Test
    void accessDenialReturnsForbidden() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(admin));
        when(service.status("org-1", admin)).thenThrow(
                new com.dip3.ontologyagent.support.BackendException("GRAPH_SYNC_FORBIDDEN", "禁止访问"));
        mvc.perform(get("/api/admin/graph-sync/organizations/org-1/status"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("GRAPH_SYNC_FORBIDDEN"))
                .andExpect(jsonPath("$.traceId").isNotEmpty());
    }

    private static GraphSyncRun run(String status) {
        Instant now = Instant.now();
        return new GraphSyncRun("run-1", "org-rebuild", status, "organization", "org-1", "manual",
                "admin", Map.of(), 1, 1, null, null, now, now, now, now);
    }
}
