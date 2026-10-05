package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.TraceFilter;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import com.dip3.ontologyagent.easyv.internal.application.EasyVObjectReadService;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVObjectReadController {
  private final CookieSessionAuthenticator auth;
  private final EasyVObjectReadService objects;
  public EasyVObjectReadController(CookieSessionAuthenticator auth, EasyVObjectReadService objects) {
    this.auth = auth;
    this.objects = objects;
  }
  @PostMapping(path = "/api/analysis/sessions/{sessionId}/objects/query", consumes = "application/json")
  public EasyVObjectReadService.Result read(@PathVariable String sessionId,
      @RequestBody EasyVObjectReadService.Request body, HttpServletRequest request) {
    var viewer = auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    return objects.read(sessionId, viewer, body);
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<Map<String, String>> invalidBody(HttpServletRequest request) {
    return ResponseEntity.badRequest().body(Map.of("code", "OBJECT_QUERY_INVALID",
        "error", "对象读取请求的 JSON 字段或类型无效。", "traceId", TraceFilter.from(request)));
  }
}
