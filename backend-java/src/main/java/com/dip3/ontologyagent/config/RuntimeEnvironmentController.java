package com.dip3.ontologyagent.config;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 说明当前进程属于哪个环境。环境名不敏感；库地址与库名只给 PLATFORM_ADMIN。 */
@RestController
public final class RuntimeEnvironmentController {
  public record Response(String name, String label, String kind, boolean remoteDatabase, RuntimeEnvironment.Database database) {}

  private final CookieSessionAuthenticator auth;
  private final RuntimeEnvironment environment;

  public RuntimeEnvironmentController(CookieSessionAuthenticator auth, RuntimeEnvironment environment) {
    this.auth = auth;
    this.environment = environment;
  }

  @GetMapping("/api/runtime/environment")
  public Response environment(HttpServletRequest request) {
    boolean admin = auth.authenticate(request).map(viewer -> viewer.scope().roleCodes().contains("PLATFORM_ADMIN")).orElse(false);
    return new Response(environment.name(), environment.label(), environment.kind().name().toLowerCase(java.util.Locale.ROOT),
        environment.remoteDatabase(), admin ? environment.database() : null);
  }
}
