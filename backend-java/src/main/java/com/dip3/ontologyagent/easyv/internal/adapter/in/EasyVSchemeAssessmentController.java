package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.config.TraceFilter;
import com.dip3.ontologyagent.easyv.internal.application.EasyVSchemeAssessmentService;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(prefix="dip3.easyv", name="enabled", havingValue="true")
public final class EasyVSchemeAssessmentController {
  private final CookieSessionAuthenticator auth;
  private final EasyVSchemeAssessmentService assessments;
  public EasyVSchemeAssessmentController(CookieSessionAuthenticator auth,EasyVSchemeAssessmentService assessments) { this.auth=auth;this.assessments=assessments; }
  @PostMapping(path="/api/analysis/sessions/{sessionId}/objects/assess",consumes="application/json")
  public EasyVSchemeAssessmentService.Result assess(@PathVariable String sessionId,@RequestBody Map<String,Object> body,HttpServletRequest request) {
    var viewer=auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED","未登录。"));
    return assessments.assess(sessionId,viewer,ObjectSelection.read(body));
  }
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<Map<String,String>> invalidBody(HttpServletRequest request) {
    return ResponseEntity.badRequest().body(Map.of("code","SCHEME_ASSESSMENT_INVALID","error","方案评估请求必须是完整的冻结区域对象引用。","traceId",TraceFilter.from(request)));
  }
}
