package com.dip3.ontologyagent.ingestion.internal.adapter.in;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionManagementPort;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionManagementService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class IngestionManagementControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final IngestionManagementPort port = mock(IngestionManagementPort.class);
    private MockMvc mvc;

    @BeforeEach
    void setup() {
        mvc = MockMvcBuilders.standaloneSetup(new IngestionManagementController(auth,
                new IngestionManagementService(port, new com.dip3.ontologyagent.ingestion.internal.application.IngestionAccessService(org.mockito.Mockito.mock(com.dip3.ontologyagent.ingestion.internal.application.IngestionAccessPort.class))))).setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void rejectsAnonymousBeforeReadingCatalog() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());
        mvc.perform(get("/api/admin/ingestion/overview")).andExpect(status().isUnauthorized());
        verifyNoInteractions(port);
    }

    @Test
    void rejectsDomainAndOntologyRolesAcrossOrganizations() throws Exception {
        for (String organization : List.of("org-a", "org-b")) {
            for (String role : List.of("PROPERTY_ANALYST", "EASYV_ANALYST", "ONTOLOGY_PUBLISHER", "ONTOLOGY_VIEWER")) {
                actor(organization, role);
                mvc.perform(get("/api/admin/ingestion/overview")).andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.code").value("INGESTION_MANAGEMENT_FORBIDDEN"));
            }
        }
        verifyNoInteractions(port);
    }

    @Test
    void platformAdminReadsAnExplicitlyPlatformScopedSnapshot() throws Exception {
        actor("org-a", "PLATFORM_ADMIN");
        when(port.overview()).thenReturn(new IngestionManagementPort.Overview("platform", 50, 20,
                List.of(), List.of(), List.of(), List.of(), List.of()));
        mvc.perform(get("/api/admin/ingestion/overview")).andExpect(status().isOk())
                .andExpect(jsonPath("$.scope").value("platform"))
                .andExpect(jsonPath("$.runs").isArray());
        verify(port).overview();
    }

    @Test
    void databaseFailureDoesNotBecomeAnEmptySuccessfulCatalog() throws Exception {
        actor("org-a", "PLATFORM_ADMIN");
        when(port.overview()).thenThrow(new IllegalStateException("database offline"));
        mvc.perform(get("/api/admin/ingestion/overview")).andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
    }

    private void actor(String organization, String role) {
        when(auth.authenticate(any())).thenReturn(Optional.of(new AuthSession("session", "operator", "Operator",
                new AccessScope(organization, List.of(), List.of(), List.of(role)), Instant.now().plusSeconds(60))));
    }
}
