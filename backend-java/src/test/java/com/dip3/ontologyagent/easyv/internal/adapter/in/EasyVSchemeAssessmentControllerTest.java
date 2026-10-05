package com.dip3.ontologyagent.easyv.internal.adapter.in;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSchemeAssessmentService;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class EasyVSchemeAssessmentControllerTest {
  @Test void authenticationAndStrictSelectionProtectAssessmentBoundary() throws Exception {
    var auth=mock(CookieSessionAuthenticator.class);var service=mock(EasyVSchemeAssessmentService.class);
    var mvc=MockMvcBuilders.standaloneSetup(new EasyVSchemeAssessmentController(auth,service)).setControllerAdvice(new ApiExceptionHandler()).build();
    String path="/api/analysis/sessions/session/objects/assess";
    String valid="""
        {"executionId":"execution-old","datasetVersionSetId":"set-old","reference":{"objectKey":"easyv-prototype-block","objectId":"1:b","productVersionId":"blocks-old"}}
        """;
    when(auth.authenticate(any())).thenReturn(Optional.empty());
    mvc.perform(post(path).contentType("application/json").content(valid)).andExpect(status().isUnauthorized());verifyNoInteractions(service);
    var viewer=new AuthSession("cookie","1","用户",new AccessScope("org",List.of(),List.of(),List.of("PLATFORM_ADMIN")),Instant.MAX);
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    mvc.perform(post(path).contentType("application/json").content("{")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("SCHEME_ASSESSMENT_INVALID"));
    mvc.perform(post(path).contentType("application/json").content(valid.replace("\"executionId\":", "\"sql\":\"select *\",\"executionId\":"))).andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("OBJECT_SELECTION_INVALID"));
    verifyNoInteractions(service);
    mvc.perform(post(path).contentType("application/json").content(valid)).andExpect(status().isOk());
    verify(service).assess(eq("session"),eq(viewer),argThat(s -> s.reference().productVersionId().equals("blocks-old")));
  }
}
