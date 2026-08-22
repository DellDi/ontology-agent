package com.dip3.ontologyagent.readapi;

import com.dip3.ontologyagent.analysis.AnalysisSessionAggregate;
import com.dip3.ontologyagent.analysis.AnalysisSessionReadController;
import com.dip3.ontologyagent.analysis.AnalysisSessionReadService;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthReadController;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.auth.ViewerResponse;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.workspace.WorkspaceHomeController;
import com.dip3.ontologyagent.workspace.WorkspaceHomeResponse;
import com.dip3.ontologyagent.workspace.WorkspaceHomeService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReadApiControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final WorkspaceHomeService homes = mock(WorkspaceHomeService.class);
    private final AnalysisSessionReadService sessions = mock(AnalysisSessionReadService.class);
    private final Instant now = Instant.parse("2026-08-09T10:00:00Z");
    private final AuthSession viewer = new AuthSession("auth-1", "user-1", "测试用户",
            new AccessScope("org-1", List.of("project-1"), List.of("area-1"), List.of("analyst")),
            now.plusSeconds(3600));
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        reset(auth, homes, sessions);
        mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(
                        new AuthReadController(auth), new WorkspaceHomeController(auth, homes),
                        new AnalysisSessionReadController(auth, sessions))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void allReadEndpointsRequireTheServerVerifiedCookieSession() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());

        mvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
        mvc.perform(get("/api/workspace/home"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
        mvc.perform(get("/api/analysis/sessions/session-1"))
                .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    }

    @Test
    void authMeReturnsViewerScopeWithoutServerSessionCredentials() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(viewer));

        mvc.perform(get("/api/auth/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("user-1"))
                .andExpect(jsonPath("$.displayName").value("测试用户"))
                .andExpect(jsonPath("$.scope.organizationId").value("org-1"))
                .andExpect(jsonPath("$.scope.projectIds[0]").value("project-1"))
                .andExpect(jsonPath("$.scope.areaIds[0]").value("area-1"))
                .andExpect(jsonPath("$.scope.roleCodes[0]").value("analyst"))
                .andExpect(jsonPath("$.workspaceAccess").value(true))
                .andExpect(jsonPath("$.sessionId").doesNotExist())
                .andExpect(jsonPath("$.expiresAt").doesNotExist());
    }

    @Test
    void authMeKeepsAuthenticationSeparateFromWorkspaceAuthorization() throws Exception {
        AuthSession authenticatedWithoutWorkspaceAccess = new AuthSession("auth-2", "user-2", "无范围用户",
                new AccessScope("org-1", List.of(), List.of(), List.of()), now.plusSeconds(3600));
        when(auth.authenticate(any())).thenReturn(Optional.of(authenticatedWithoutWorkspaceAccess));

        mvc.perform(get("/api/auth/me"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value("user-2"))
                .andExpect(jsonPath("$.workspaceAccess").value(false));
    }

    @Test
    void workspaceHomeReturnsOwnedSessionsLatestExecutionAndScopedProjects() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
        WorkspaceHomeResponse response = new WorkspaceHomeResponse(ViewerResponse.from(viewer),
                List.of(new WorkspaceHomeResponse.SessionSummary("session-1", "分析收缴率", "pending",
                        new WorkspaceHomeResponse.SessionScope("org-1", List.of("project-1"), List.of("area-1")),
                        Map.of("state", "missing"), now, now,
                        new WorkspaceHomeResponse.LatestExecutionSummary("execution-1", "queued", "queued",
                                null, null, null, null, null, "trace-1", now, now))),
                List.of(new WorkspaceHomeResponse.ProjectSummary("project-1", "P-1", "项目一", "org-1",
                        "area-1", "区域一")));
        when(homes.load(viewer)).thenReturn(response);

        mvc.perform(get("/api/workspace/home"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewer.userId").value("user-1"))
                .andExpect(jsonPath("$.sessions[0].id").value("session-1"))
                .andExpect(jsonPath("$.sessions[0].latestExecution.executionId").value("execution-1"))
                .andExpect(jsonPath("$.sessions[0].latestExecution.status").value("queued"))
                .andExpect(jsonPath("$.projects[0].id").value("project-1"));
        verify(homes).load(viewer);
    }

    @Test
    void analysisAggregateReturnsOnlyCanonicalExecutionFactsForSsr() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
        AnalysisSessionAggregate aggregate = aggregate();
        when(sessions.load("session-1", "execution-1", viewer)).thenReturn(aggregate);

        mvc.perform(get("/api/analysis/sessions/session-1").param("executionId", "execution-1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session.id").value("session-1"))
                .andExpect(jsonPath("$.job.executionId").value("execution-1"))
                .andExpect(jsonPath("$.events[0].sequence").value(1))
                .andExpect(jsonPath("$.snapshot.executionId").value("execution-1"))
                .andExpect(jsonPath("$.runtime.resolvedExecutionId").value("execution-1"))
                .andExpect(jsonPath("$.runtime.autoExecute").value(false))
                .andExpect(jsonPath("$.runtime.streamEnabled").value(false))
                .andExpect(jsonPath("$.runtime.resumeAfterSequence").value(1))
                .andExpect(jsonPath("$.followUp").doesNotExist());
        verify(sessions).load("session-1", "execution-1", viewer);
    }

    @Test
    void inaccessibleSessionUsesTheStableNotFoundEnvelope() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
        when(sessions.load("session-1", null, viewer))
                .thenThrow(new BackendException("SESSION_NOT_FOUND", "会话不存在或无权访问。"));

        mvc.perform(get("/api/analysis/sessions/session-1"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
    }

    private AnalysisSessionAggregate aggregate() {
        AnalysisSessionAggregate.SessionView session = new AnalysisSessionAggregate.SessionView("session-1",
                "分析收缴率", "pending", new AnalysisSessionAggregate.SessionScope("org-1",
                List.of("project-1"), List.of("area-1")), Map.of("state", "missing"), now, now);
        AnalysisSessionAggregate.JobView job = new AnalysisSessionAggregate.JobView("execution-1", "completed",
                Map.of("workflowInvocations", 1), null, 1, 2, "published", "trace-1", now, now, now, now, null);
        AnalysisSessionAggregate.EventView event = new AnalysisSessionAggregate.EventView("event-1", "session-1",
                "execution-1", 1, "execution-status", now, "completed", "分析执行已完成", List.of(), Map.of(),
                null, "trace-1");
        AnalysisSessionAggregate.SnapshotView snapshot = new AnalysisSessionAggregate.SnapshotView("execution-1",
                "session-1", null, "ontology-1", "grounded-context", "completed", Map.of(), List.of(),
                Map.of("causes", List.of()), List.of(), Map.of(), null, null, "trace-1", now, now);
        AnalysisSessionAggregate.RuntimeFacts runtime = new AnalysisSessionAggregate.RuntimeFacts("execution-1",
                "execution-1", "completed", false, false, true, 1);
        return new AnalysisSessionAggregate(session, job, List.of(event), snapshot, runtime);
    }
}
