package com.dip3.ontologyagent.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.support.JsonCodec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class RuntimeEnvironmentControllerTest {
  private static final String PATH = "/api/runtime/environment";
  private final CookieSessionAuthenticator auth = mock(CookieSessionAuthenticator.class);
  private final JsonCodec json = new JsonCodec();
  private MockMvc mvc;

  @BeforeEach
  void setup() {
    var environment = RuntimeEnvironment.resolve("local-dev", "", "jdbc:postgresql://127.0.0.1:55432/ontology_agent_local", false);
    mvc = MockMvcBuilders.standaloneSetup(new RuntimeEnvironmentController(auth, environment)).build();
  }

  private static AuthSession viewer(String role) {
    return new AuthSession("cookie", "1", "用户", new AccessScope("org", List.of(), List.of(), List.of(role)), Instant.MAX);
  }

  private Map<String, Object> read() throws Exception {
    return json.map(mvc.perform(get(PATH)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
  }

  @Test
  void platformAdminSeesTheDatabaseCoordinatesExactlyAsTheSharedContractFixture() throws Exception {
    when(auth.authenticate(org.mockito.ArgumentMatchers.any())).thenReturn(Optional.of(viewer("PLATFORM_ADMIN")));
    var fixture = json.map(Files.readString(Path.of("..", "contracts", "backend", "fixtures", "runtime-environment.json")));
    assertEquals(fixture, read());
  }

  @Test
  @SuppressWarnings("unchecked")
  void otherUsersAndAnonymousVisitorsOnlySeeWhichEnvironmentThisIs() throws Exception {
    for (var session : List.of(Optional.of(viewer("EASYV_ANALYST")), Optional.<AuthSession>empty())) {
      when(auth.authenticate(org.mockito.ArgumentMatchers.any())).thenReturn(session);
      var body = read();
      assertEquals("local-dev", body.get("name"));
      assertEquals("本地开发", body.get("label"));
      assertEquals("local", body.get("kind"));
      assertEquals(false, body.get("remoteDatabase"));
      assertTrue(body.containsKey("database") && body.get("database") == null, "非管理员不返回库地址与库名：" + body);
    }
  }
}
