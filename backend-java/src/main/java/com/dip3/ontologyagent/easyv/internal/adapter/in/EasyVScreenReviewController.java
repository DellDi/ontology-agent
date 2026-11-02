package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.TraceFilter;
import com.dip3.ontologyagent.easyv.internal.application.EasyVScreenReviewService;
import com.dip3.ontologyagent.semantic.api.InitialObjectSelection;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.Set;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVScreenReviewController {
  private final CookieSessionAuthenticator auth;
  private final EasyVScreenReviewService reviews;
  public EasyVScreenReviewController(CookieSessionAuthenticator auth, EasyVScreenReviewService reviews) {
    this.auth = auth; this.reviews = reviews;
  }

  @PostMapping(path = "/api/easyv/workspace/prototypes/review", consumes = "application/json")
  public Map<String, String> start(@RequestBody Map<String, Object> body, HttpServletRequest request) {
    var viewer = auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    if (!body.keySet().equals(Set.of("purpose", "selection")) || !(body.get("purpose") instanceof String purpose))
      throw new BackendException("OBJECT_SELECTION_INVALID", "检查请求必须包含用途和正式对象范围。");
    return Map.of("sessionId", reviews.start(viewer, purpose, InitialObjectSelection.read(body.get("selection"))));
  }

  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<Map<String, String>> invalidBody(HttpServletRequest request) {
    return ResponseEntity.badRequest().body(Map.of("code", "OBJECT_SELECTION_INVALID",
        "error", "检查请求的 JSON 字段或类型无效。", "traceId", TraceFilter.from(request)));
  }
}
