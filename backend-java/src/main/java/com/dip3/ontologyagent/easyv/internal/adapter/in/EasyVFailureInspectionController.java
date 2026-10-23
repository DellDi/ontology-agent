package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.easyv.internal.application.EasyVFailureInspectionService;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;

@RestController
@ConditionalOnProperty(prefix="dip3.easyv",name="enabled",havingValue="true")
public final class EasyVFailureInspectionController {
  private final CookieSessionAuthenticator auth;
  private final EasyVFailureInspectionService inspections;
  public EasyVFailureInspectionController(CookieSessionAuthenticator auth,EasyVFailureInspectionService inspections) {
    this.auth=auth;this.inspections=inspections;
  }
  @GetMapping("/api/easyv/inspection")
  public EasyVFailureInspectionService.Report inspect(HttpServletRequest request,
      @RequestParam(required=false) String setId,@RequestParam(defaultValue="0") String offset) {
    var viewer=auth.authenticate(request).orElseThrow(() -> new BackendException("AUTH_REQUIRED","未登录。"));
    int position;
    try { position=Integer.parseInt(offset); }
    catch (NumberFormatException error) { throw new BackendException("OBJECT_QUERY_INVALID","巡检分页位置必须是整数。"); }
    return inspections.inspect(viewer,setId,position);
  }
}
