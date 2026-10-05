package com.dip3.ontologyagent.easyv.internal.adapter.in;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.config.ApiExceptionHandler;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.OntologyProperty;
import com.dip3.ontologyagent.support.*;
import java.nio.file.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class EasyVObjectReadControllerTest {
  private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
  private final EasyVObjectReadService objects = mock(EasyVObjectReadService.class);
  private final AuthSession viewer = new AuthSession("cookie", "1", "用户",
      new AccessScope("org", List.of(), List.of(), List.of("PLATFORM_ADMIN")), Instant.MAX);
  private MockMvc mvc;
  private static final String PATH = "/api/analysis/sessions/session/objects/query";
  private static final String BODY = """
      {"executionId":"execution-old","datasetVersionSetId":"set-old",
       "objectKey":"easyv-prototype-layout","objectId":"app-1"}
      """;

  @BeforeEach
  void setup() {
    mvc = MockMvcBuilders.standaloneSetup(new EasyVObjectReadController(auth, objects))
        .setControllerAdvice(new ApiExceptionHandler()).build();
  }

  @Test
  void unauthenticatedReadCannotReachObjects() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.empty());
    mvc.perform(post(PATH).contentType("application/json").content(BODY))
        .andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("AUTH_REQUIRED"));
    verifyNoInteractions(objects);
  }

  @Test
  void javaSerializationMatchesTheSharedDetailFixture() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    Map<String, Object> properties = new LinkedHashMap<>();
    properties.put("appId", "app-1"); properties.put("parseStatus", "ok");
    properties.put("parseErrorCode", null); properties.put("blockCount", 1);
    var row = new ObjectQueryPort.Row(new ObjectQueryPort.Reference("easyv-prototype-layout", "app-1", "layout-old"), properties);
    var layout = Map.<String, Object>of("tag", "Pages", "attributes", Map.of(), "children", List.of(
        Map.of("tag", "Page", "attributes", Map.of("width", "1920", "height", "1080"), "children", List.of())));
    when(objects.read(eq("session"), eq(viewer), any())).thenReturn(new EasyVObjectReadService.Result(
        "execution-old", "set-old", "ontology-old", new ObjectQueryPort.Page("easyv-prototype-layout", List.of(row), 1, 0, false),
        new EasyVObjectReadService.Structure("available", layout),
        new EasyVObjectReadService.ObjectTypeView("easyv-prototype-layout", "原型版式", List.of(
            new EasyVObjectReadService.PropertyView("appId", "应用 ID", OntologyProperty.Type.STRING),
            new EasyVObjectReadService.PropertyView("parseStatus", "解析状态", OntologyProperty.Type.STRING),
            new EasyVObjectReadService.PropertyView("parseErrorCode", "解析错误代码", OntologyProperty.Type.STRING),
            new EasyVObjectReadService.PropertyView("blockCount", "区域数", OntologyProperty.Type.NUMBER)),
            List.of(new EasyVObjectReadService.LinkView("blocks", "easyv-prototype-block", "原型区域")))));
    String body = mvc.perform(post(PATH).contentType("application/json").content(BODY))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    var json = new JsonCodec();
    assertEquals(json.map(Files.readString(Path.of("..", "contracts", "backend", "fixtures", "object-read-detail.json"))), json.map(body));
    verify(objects).read(eq("session"), eq(viewer), argThat(request -> request.executionId().equals("execution-old")
        && request.datasetVersionSetId().equals("set-old") && request.objectId().equals("app-1")));
  }

  @Test
  void invalidJsonUnknownFieldsAndEnumsAreReadable400Errors() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    for (String body : List.of("{", BODY.replace("\"objectId\":\"app-1\"", "\"sql\":\"select * from facts\""),
        BODY.replace("\"objectId\":\"app-1\"", "\"filters\":[{\"member\":\"appId\",\"operator\":\"SQL\",\"values\":[]}]"))) {
      mvc.perform(post(PATH).contentType("application/json").content(body))
          .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("OBJECT_QUERY_INVALID"));
    }
    verifyNoInteractions(objects);
  }

  @Test
  void versionMismatchAndMissingObjectPreserveErrorSemantics() throws Exception {
    when(auth.authenticate(any())).thenReturn(Optional.of(viewer));
    when(objects.read(anyString(), any(), any())).thenThrow(new BackendException("OBJECT_VERSION_MISMATCH", "版本不一致"));
    mvc.perform(post(PATH).contentType("application/json").content(BODY))
        .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("OBJECT_VERSION_MISMATCH"));
    doThrow(new BackendException("OBJECT_NOT_FOUND", "不存在或无权访问")).when(objects).read(anyString(), any(), any());
    mvc.perform(post(PATH).contentType("application/json").content(BODY))
        .andExpect(status().isNotFound()).andExpect(jsonPath("$.traceId").isNotEmpty());
  }
}
