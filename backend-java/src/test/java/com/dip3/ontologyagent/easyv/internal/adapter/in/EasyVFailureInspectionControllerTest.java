package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.easyv.internal.application.EasyVFailureInspectionService;
import com.dip3.ontologyagent.easyv.internal.domain.FailureChange;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.support.JsonCodec;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class EasyVFailureInspectionControllerTest {
  private final CookieSessionAuthenticator auth=mock(CookieSessionAuthenticator.class);
  private final EasyVFailureInspectionService inspections=mock(EasyVFailureInspectionService.class);
  private final AuthSession viewer=new AuthSession("cookie","7","Admin",new AccessScope("org",List.of(),List.of(),List.of("PLATFORM_ADMIN")),Instant.MAX);
  private final org.springframework.test.web.servlet.MockMvc mvc=MockMvcBuilders.standaloneSetup(new EasyVFailureInspectionController(auth,inspections)).setControllerAdvice(new ApiExceptionHandler()).build();
  @Test void anonymousCannotReachBusinessReadsAndInvalidOffsetIs400() throws Exception {
    mvc.perform(get("/api/easyv/inspection")).andExpect(status().isUnauthorized());
    verifyNoInteractions(inspections);
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    mvc.perform(get("/api/easyv/inspection?offset=not-a-number")).andExpect(status().isBadRequest());
    verifyNoInteractions(inspections);
  }
  @Test void serializesTheSharedFixtureAndPreservesServerSelectedVersionPagination() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    var report=new EasyVFailureInspectionService.Report(
        new EasyVFailureInspectionService.Version("set-current",Instant.parse("2026-10-11T15:18:51Z")),
        new EasyVFailureInspectionService.Version("set-previous",Instant.parse("2026-10-10T07:50:48Z")),"全部数据",
        new EasyVFailureInspectionService.Summary(1,0,0,1,0,0),List.of(),List.of(new EasyVFailureInspectionService.Failure(
            new ObjectQueryPort.Reference("easyv-forge-task","task-a","forge-current"),
            new ObjectQueryPort.Reference("easyv-ai-application","app-a","apps-current"),
            "源任务记录生成失败；需要继续核对。","2026-10-09T01:00:00Z",null,"failed",FailureChange.FAILED_IN_BOTH)),0,50,false);
    when(inspections.inspect(viewer,"set-current",0)).thenReturn(report);
    String body=mvc.perform(get("/api/easyv/inspection?setId=set-current&offset=0")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    var json=new JsonCodec();
    assertEquals(json.map(Files.readString(Path.of("..","contracts","backend","fixtures","failure-inspection.json"))),json.map(body));
    verify(inspections).inspect(viewer,"set-current",0);
  }
}
