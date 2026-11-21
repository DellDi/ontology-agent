package com.dip3.ontologyagent.easyv.internal.adapter.in;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractPort;
import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractService;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ChartMappingCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ContractStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.ItemStatus;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.RedisCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.Report;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.SampleCheck;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract.SchemaCheck;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class EasyVWritebackContractControllerTest {
  private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
  private final EasyVWritebackContractPort port = mock(EasyVWritebackContractPort.class);
  private MockMvc mvc;

  @BeforeEach
  void setup() {
    mvc = MockMvcBuilders.standaloneSetup(
            new EasyVWritebackContractController(auth, new EasyVWritebackContractService(port)))
        .setControllerAdvice(new ApiExceptionHandler())
        .build();
  }

  @Test
  void rejectsAnonymousWith401WithoutCallingProbe() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.empty());
    mvc.perform(get("/api/admin/easyv/writeback/contract-check"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    verifyNoInteractions(port);
  }

  @Test
  void rejectsNonAdminWith403WithoutCallingProbe() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.of(actor("EASYV_ANALYST")));
    mvc.perform(get("/api/admin/easyv/writeback/contract-check"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("EASYV_WRITEBACK_CONTRACT_FORBIDDEN"));
    verifyNoInteractions(port);
  }

  @Test
  void allowsPlatformAdminAndSerializesStructuredReport() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.of(actor("PLATFORM_ADMIN")));
    var schemaCheck = new SchemaCheck(ItemStatus.PASSED, List.of(), "6 张源表校验通过");
    var sampleCheck = new SampleCheck(ItemStatus.PASSED, 3, 2,
        EasyVWritebackContract.REQUIRED_JSON_PATHS, List.of(), "抽样 2 个应用全部通过");
    var chartCheck = new ChartMappingCheck(ItemStatus.PASSED, 5L, 4L, "存在 4 条启用规则");
    var redisCheck = new RedisCheck(ItemStatus.PASSED,
        EasyVWritebackContract.REDIS_INVALIDATION_KEY_PATTERN, "PONG", 1L, "PING 成功");
    var report = new Report(
        ContractStatus.PASSED,
        true,
        "easyv_saas",
        Instant.parse("2026-11-21T06:00:00Z"),
        "全部契约项通过",
        null,
        schemaCheck,
        sampleCheck,
        chartCheck,
        redisCheck,
        EasyVWritebackContract.buildChecklist(schemaCheck, sampleCheck, chartCheck, redisCheck),
        List.of());
    when(port.check()).thenReturn(report);

    mvc.perform(get("/api/admin/easyv/writeback/contract-check"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.status").value("PASSED"))
        .andExpect(jsonPath("$.actionEnabled").value(true))
        .andExpect(jsonPath("$.schema").value("easyv_saas"))
        .andExpect(jsonPath("$.schemaCheck.status").value("PASSED"))
        .andExpect(jsonPath("$.sampleCheck.sampledAppCount").value(2))
        .andExpect(jsonPath("$.chartMappingCheck.enabledCount").value(4))
        .andExpect(jsonPath("$.redisCheck.pingResponse").value("PONG"))
        .andExpect(jsonPath("$.redisCheck.expectedInvalidationKeyPattern")
            .value("ai:screen:regen:<generationTaskId>"))
        .andExpect(jsonPath("$.contractChecklist").isArray());
    verify(port).check();
  }

  private static AuthSession actor(String role) {
    return new AuthSession("session-1", "1", "管理员",
        new AccessScope("platform", List.of(), List.of(), List.of(role)), Instant.MAX);
  }
}
