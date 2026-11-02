package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.easyv.internal.application.EasyVScreenReviewService;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class EasyVScreenReviewControllerTest {
  @Test
  void authenticationAndStrictInputAreEnforcedBeforeStartingReview() throws Exception {
    var auth = mock(CookieSessionAuthenticator.class);
    var reviews = mock(EasyVScreenReviewService.class);
    var mvc = MockMvcBuilders.standaloneSetup(new EasyVScreenReviewController(auth, reviews))
        .setControllerAdvice(new ApiExceptionHandler()).build();
    var request = post("/api/easyv/workspace/prototypes/review").contentType("application/json");
    when(auth.authenticate(any())).thenReturn(Optional.empty());
    mvc.perform(request.content("{}" )).andExpect(status().isUnauthorized());
    var viewer = new AuthSession("auth", "1", "用户", new AccessScope("org", List.of(), List.of(), List.of()), Instant.MAX);
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    for (var body : List.of("{", "[]", "{}", "{\"purpose\":\"复盘\",\"selection\":{},\"permissions\":{}}")) {
      mvc.perform(post("/api/easyv/workspace/prototypes/review").contentType("application/json").content(body))
          .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("OBJECT_SELECTION_INVALID"));
    }
    verifyNoInteractions(reviews);
    when(reviews.start(eq(viewer), eq("运营复盘"), any())).thenReturn("12345678-1234-4234-9234-123456789abc");
    mvc.perform(post("/api/easyv/workspace/prototypes/review").contentType("application/json").content("""
        {"purpose":"运营复盘","selection":{"datasetVersionSetId":"set-old","references":[{"objectKey":"easyv-prototype-layout","objectId":"a","productVersionId":"layouts-old"}]}}
        """))
        .andExpect(status().isOk()).andExpect(jsonPath("$.sessionId").value("12345678-1234-4234-9234-123456789abc"));
  }
}
