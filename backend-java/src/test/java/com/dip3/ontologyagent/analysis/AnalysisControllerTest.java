package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.execution.ExecutionEvent;
import com.dip3.ontologyagent.followup.AnalysisFollowUpService;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.asyncDispatch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AnalysisControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final AnalysisService analyses = mock(AnalysisService.class);
    private final AnalysisFollowUpService followUps = mock(AnalysisFollowUpService.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        BackendProperties properties = new BackendProperties("secret", "test",
                new BackendProperties.Cube("http://cube", "secret", Duration.ofSeconds(1)),
                new BackendProperties.Neo4j("bolt://neo4j", "neo4j", "secret", "neo4j"),
                new BackendProperties.Worker(false, Duration.ofSeconds(1)),
                new BackendProperties.Stream(Duration.ofMillis(1), Duration.ofSeconds(1)),
                "", "", false, false, false);
        mvc = MockMvcBuilders.standaloneSetup(
                        new AnalysisController(auth, analyses, new JsonCodec(), properties, followUps))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void unauthenticatedCreatePreservesTheExisting303LoginContract() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());
        mvc.perform(post("/api/analysis/sessions").contentType("application/x-www-form-urlencoded")
                        .param("question", "分析收缴率"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", "/login?next=/workspace"));
    }

    @Test
    void unsupportedQuestionPreservesTheExisting303ValidationContract() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(analyses.createSession(owner, "分析 CRM 转化率"))
                .thenThrow(new BackendException("UNSUPPORTED_ANALYSIS_SCOPE", "当前版本仅支持物业分析场景。"));

        mvc.perform(post("/api/analysis/sessions").contentType("application/x-www-form-urlencoded")
                        .param("question", "分析 CRM 转化率"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/workspace?error=")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("errorCode=UNSUPPORTED_ANALYSIS_SCOPE")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("traceId=")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("draft=")));
    }

    @Test
    void unsupportedCapabilityReturnsToTheWorkspaceWithTheDraftQuestion() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(analyses.createSession(owner, "分析项目投诉量"))
                .thenThrow(new BackendException("ANALYSIS_CAPABILITY_UNSUPPORTED",
                        "当前 Java 首次分析仅支持项目收缴率。"));

        mvc.perform(post("/api/analysis/sessions").contentType("application/x-www-form-urlencoded")
                        .param("question", "分析项目投诉量"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.startsWith("/workspace?error=")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("errorCode=ANALYSIS_CAPABILITY_UNSUPPORTED")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("traceId=")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("draft=")));
    }

    @Test
    void executeForwardsIdempotencyAndReturnsTheExisting303Location() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(analyses.submit(anyString(), any(), anyString(), anyString())).thenReturn("execution-1");
        mvc.perform(post("/api/analysis/sessions/session-1/execute")
                        .contentType("application/x-www-form-urlencoded")
                        .header("Idempotency-Key", "idem-1"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", "/workspace/analysis/session-1?executionId=execution-1"));
        verify(analyses).submit(org.mockito.ArgumentMatchers.eq("session-1"),
                org.mockito.ArgumentMatchers.eq(owner), org.mockito.ArgumentMatchers.eq("idem-1"), anyString());
    }

    @Test
    void followUpExecutionValidationReturnsToTheSelectedRound() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(followUps.submit(org.mockito.ArgumentMatchers.eq("session-1"),
                org.mockito.ArgumentMatchers.eq("follow-1"), org.mockito.ArgumentMatchers.eq(owner),
                isNull(), anyString()))
                .thenThrow(new BackendException("FOLLOW_UP_REPLAN_REQUIRED", "请先重规划。"));

        mvc.perform(post("/api/analysis/sessions/session-1/execute")
                        .contentType("application/x-www-form-urlencoded")
                        .param("followUpId", "follow-1"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location",
                        org.hamcrest.Matchers.containsString("followUpId=follow-1")))
                .andExpect(header().string("Location",
                        org.hamcrest.Matchers.containsString("followUpExecutionError=")));
    }

    @Test
    void invalidResumeCursorReturnsTheStableErrorEnvelope() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        mvc.perform(get("/api/analysis/sessions/session-1/stream")
                        .param("executionId", "execution-1").param("afterSequence", "01"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("AFTER_SEQUENCE_INVALID"))
                .andExpect(jsonPath("$.traceId").isNotEmpty());
    }

    @Test
    void sseFramesRemainByteCompatibleAndCloseOnTerminalEvent() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        ExecutionEvent terminal = new ExecutionEvent("event-2", "session-1", "execution-1", 2,
                "execution-status", Instant.parse("2026-08-09T10:00:02Z"), "completed", "分析执行已完成",
                List.of(Map.of("type", "status", "title", "执行状态", "value", "已完成", "tone", "success")),
                Map.of(), null, "trace-1");
        when(analyses.events(anyString(), anyString(), any(), anyLong()))
                .thenReturn(List.of(), List.of(terminal));

        MvcResult result = mvc.perform(get("/api/analysis/sessions/session-1/stream")
                        .param("executionId", "execution-1").param("afterSequence", "1"))
                .andExpect(request().asyncStarted())
                .andReturn();

        mvc.perform(asyncDispatch(result))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "text/event-stream;charset=utf-8"))
                .andExpect(header().string("Cache-Control", "no-cache, no-transform"))
                .andExpect(header().string("X-Accel-Buffering", "no"))
                .andExpect(content().string(org.hamcrest.Matchers.startsWith("data: {\"id\":\"event-2\"")))
                .andExpect(content().string(org.hamcrest.Matchers.endsWith("\n\n")));
    }
}
