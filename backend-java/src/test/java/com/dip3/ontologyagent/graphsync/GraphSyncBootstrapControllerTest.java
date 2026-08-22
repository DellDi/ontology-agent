package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.config.ApiExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.Map;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GraphSyncBootstrapControllerTest {
    private final GraphSyncBootstrapService service = mock(GraphSyncBootstrapService.class);

    @Test
    void secretIsIndependentFromCookieAndRequiredForSystemBootstrap() throws Exception {
        MockMvc missing = mvc(new GraphSyncOpsAuthenticator(""));
        missing.perform(post("/api/system/graph-sync/bootstrap").cookie(
                        new jakarta.servlet.http.Cookie("dip3_session", "valid-looking-cookie")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("GRAPH_SYNC_OPS_SECRET_REQUIRED"));

        MockMvc configured = mvc(new GraphSyncOpsAuthenticator("ops-secret"));
        configured.perform(post("/api/system/graph-sync/bootstrap")
                        .header(GraphSyncBootstrapController.SECRET_HEADER, "wrong"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("GRAPH_SYNC_OPS_FORBIDDEN"));
    }

    @Test
    void validSecretCanTriggerAndReadParentFact() throws Exception {
        GraphSyncRun run = run();
        when(service.run(org.mockito.ArgumentMatchers.anyString())).thenReturn(run);
        when(service.status()).thenReturn(run);
        MockMvc mvc = mvc(new GraphSyncOpsAuthenticator("ops-secret"));

        mvc.perform(post("/api/system/graph-sync/bootstrap")
                        .header(GraphSyncBootstrapController.SECRET_HEADER, "ops-secret"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.mode").value("full-bootstrap"));
        mvc.perform(get("/api/system/graph-sync/bootstrap/status")
                        .header(GraphSyncBootstrapController.SECRET_HEADER, "ops-secret"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.scopeKey").value("all"));
    }

    private MockMvc mvc(GraphSyncOpsAuthenticator auth) {
        return MockMvcBuilders.standaloneSetup(new GraphSyncBootstrapController(auth, service))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    private static GraphSyncRun run() {
        Instant now = Instant.now();
        return new GraphSyncRun("parent", "full-bootstrap", "completed", "all", "all", "system",
                "system-ops", Map.of("fencingToken", 1L), 1, 1, null, null, now, now, now, now);
    }
}
