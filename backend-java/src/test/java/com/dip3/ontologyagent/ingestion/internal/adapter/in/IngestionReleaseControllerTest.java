package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleaseService;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleasePort;
import com.dip3.ontologyagent.support.BackendException;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class IngestionReleaseControllerTest {
    @Test
    void submitsOnlyAuthenticatedJsonAndReturnsDurablePendingTask() throws Exception {
        var auth = mock(CookieSessionAuthenticator.class);
        var service = mock(IngestionReleaseService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new IngestionReleaseController(auth, service))
                .setControllerAdvice(new ApiExceptionHandler()).build();
        var actor = new AuthSession("session", "admin", "Admin", new AccessScope("org", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
        String body = "{\"sourceKey\":\"property\",\"productKeys\":[\"payment\"],\"mode\":\"full\"}";
        when(auth.authenticate(any())).thenReturn(Optional.empty());
        mvc.perform(post("/api/admin/ingestion/release-tasks").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(service);
        when(auth.authenticate(any())).thenReturn(Optional.of(actor));
        when(service.submit(eq("request-id"), any(), eq(actor), any())).thenReturn(new IngestionReleasePort.Task(
                "request-id", "property", List.of("payment"), "full", "pending", null, "admin", "trace", null,
                Instant.parse("2026-09-12T00:00:00Z"), null, null));
        mvc.perform(post("/api/admin/ingestion/release-tasks").contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", "request-id").content(body)).andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("pending")).andExpect(jsonPath("$.sessionId").doesNotExist())
                .andExpect(jsonPath("$.createdAt").isString());
        when(service.retry(any(), any(), any(), any())).thenThrow(new BackendException("INGESTION_RELEASE_CONFLICT", "only failed"));
        mvc.perform(post("/api/admin/ingestion/release-tasks/request-id/retry").contentType(MediaType.APPLICATION_JSON)
                .header("Idempotency-Key", "retry-id").content("{}"))
                .andExpect(status().isConflict());
    }
}
