package com.dip3.ontologyagent.followup;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AnalysisFollowUpControllerTest {
    private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
    private final AnalysisFollowUpService service = mock(AnalysisFollowUpService.class);
    private final AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
            new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")), Instant.MAX);
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.standaloneSetup(new AnalysisFollowUpController(auth, service, new JsonCodec()))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test
    void unauthenticatedCreatePreservesLoginRedirect() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.empty());

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups")
                        .contentType("application/x-www-form-urlencoded").param("question", "为什么"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", "/login?next=/workspace/analysis/session-1"));
    }

    @Test
    void createRedirectsToSelectedFollowUp() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(service.create("session-1", owner, "为什么", "")).thenReturn(followUp());

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups")
                        .contentType("application/x-www-form-urlencoded").param("question", "为什么"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location",
                        "/workspace/analysis/session-1?followUpId=follow-1"));
    }

    @Test
    void unsupportedFollowUpCapabilityUsesTheExistingRedirectErrorContract() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(service.create("session-1", owner, "那投诉量呢", ""))
                .thenThrow(new BackendException("FOLLOW_UP_CAPABILITY_UNSUPPORTED", "当前追问不支持切换指标。"));

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups")
                        .contentType("application/x-www-form-urlencoded").param("question", "那投诉量呢"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpError=")));
    }

    @Test
    void invalidNaturalLanguageScopeUsesTheCreateRedirectContract() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(service.create("session-1", owner, "project-999 呢", ""))
                .thenThrow(new BackendException("FOLLOW_UP_SCOPE_INVALID", "追问项目未匹配授权范围。"));

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups")
                        .contentType("application/x-www-form-urlencoded").param("question", "project-999 呢"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpError=")));
    }

    @Test
    void contextConflictRedirectsWithDraftAndMachineReadableConflict() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(service.adjust(anyString(), anyString(), any(), anyMap(), anyBoolean()))
                .thenThrow(new AnalysisFollowUpService.FollowUpConflictException(List.of(Map.of(
                        "type", "field", "key", "timeRange", "label", "时间范围",
                        "previousValue", "2026-01-01/2026-01-31", "nextValue", "2026-02-01/2026-02-28"))));

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups/follow-1/context")
                        .contentType("application/x-www-form-urlencoded")
                        .param("timeRange", "2026-02-01/2026-02-28"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpId=follow-1")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("timeRange=")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpConflict=")));
    }

    @Test
    void replanKnownFailureReturnsExistingRedirectContract() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(service.replan("session-1", "follow-1", owner))
                .thenThrow(new BackendException("FOLLOW_UP_REPLAN_INVALID", "缺少上一轮计划快照，无法重规划。"));

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups/follow-1/replan")
                        .contentType("application/x-www-form-urlencoded"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpId=follow-1")))
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpReplanError=")));
    }

    @Test
    void submittedRoundMutationUsesContextAndReplanRedirectContracts() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        BackendException submitted = new BackendException("FOLLOW_UP_ALREADY_SUBMITTED", "已提交轮次不能修改。");
        when(service.adjust(anyString(), anyString(), any(), anyMap(), anyBoolean())).thenThrow(submitted);
        when(service.replan("session-1", "follow-1", owner)).thenThrow(submitted);

        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups/follow-1/context")
                        .contentType("application/x-www-form-urlencoded").param("factor", "入住率"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location",
                        org.hamcrest.Matchers.containsString("followUpAdjustmentError=")));
        mvc.perform(post("/api/analysis/sessions/session-1/follow-ups/follow-1/replan")
                        .contentType("application/x-www-form-urlencoded"))
                .andExpect(status().isSeeOther())
                .andExpect(header().string("Location", org.hamcrest.Matchers.containsString("followUpReplanError=")));
    }

    @Test
    void collectionReadReturnsCanonicalRows() throws Exception {
        when(auth.authenticate(any())).thenReturn(Optional.of(owner));
        when(service.list("session-1", owner)).thenReturn(List.of(followUp()));

        mvc.perform(get("/api/analysis/sessions/session-1/follow-ups"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("follow-1"))
                .andExpect(jsonPath("$[0].ontologyVersionId").value("ontology-1"))
                .andExpect(jsonPath("$[0].mergedContext.targetMetric.state").value("confirmed"));
    }

    private static AnalysisFollowUp followUp() {
        Map<String, Object> context = Map.of(
                "targetMetric", Map.of("label", "目标指标", "value", "collection-rate", "state", "confirmed"),
                "entity", Map.of("label", "实体对象", "value", "project-1", "state", "confirmed"),
                "timeRange", Map.of("label", "时间范围", "value", "2026-01-01/2026-01-31", "state", "confirmed"),
                "comparison", Map.of("label", "比较方式", "value", "无需比较", "state", "confirmed"),
                "constraints", List.of());
        Instant now = Instant.parse("2026-08-01T00:00:00Z");
        return new AnalysisFollowUp("follow-1", "session-1", "user-1", "为什么", null,
                "execution-root", "结论", "摘要", null, "ontology-1",
                Map.of("ontologyVersionId", "ontology-1", "source", "inherited"), context, context,
                null, null, null, null, now, now);
    }
}
