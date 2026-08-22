package com.dip3.ontologyagent.ontology.bootstrap;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class OntologyBootstrapControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final OntologyBootstrapService service = mock(OntologyBootstrapService.class);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new OntologyBootstrapController(auth, service))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void requiresAuthentication() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());

        mvc.perform(get("/api/admin/ontology/bootstrap"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    }

    @Test
    void exposesStatusAndBodylessBootstrapWithCorrelation() throws Exception {
        AuthSession actor = actor();
        var ready = new OntologyBootstrapResponses.Status("ready", true, "ontology-v1", "1.0.0",
                Map.of("entities", 1L));
        when(auth.authenticate(any())).thenReturn(Optional.of(actor));
        when(service.status(actor)).thenReturn(ready);
        when(service.bootstrap(actor, "trace-bootstrap"))
                .thenReturn(new OntologyBootstrapResponses.Result(false, ready, "trace-bootstrap"));

        mvc.perform(get("/api/admin/ontology/bootstrap"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.state").value("ready"));
        mvc.perform(post("/api/admin/ontology/bootstrap").requestAttr(
                        com.dip3.ontologyagent.config.TraceFilter.class.getName() + ".traceId", "trace-bootstrap"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.correlationId").value("trace-bootstrap"));
        verify(service).bootstrap(actor, "trace-bootstrap");
    }

    private static AuthSession actor() {
        return new AuthSession("session-1", "admin-1", "管理员",
                new AccessScope("org-1", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
    }
}
