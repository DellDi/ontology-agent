package com.dip3.ontologyagent.easyv.internal.adapter.in;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionService;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.*;
@RestController
@ConditionalOnProperty(prefix="dip3.easyv",name="enabled",havingValue="true")
@RequestMapping("/api/analysis/sessions/{sessionId}/block-improvements")
public class EasyVBlockActionController {
  private final CookieSessionAuthenticator auth;private final EasyVBlockActionService actions;
  public EasyVBlockActionController(CookieSessionAuthenticator auth,EasyVBlockActionService actions){this.auth=auth;this.actions=actions;}
  @GetMapping("/{executionId}/{invocationId}")
  public EasyVBlockActionService.View get(@PathVariable String sessionId,@PathVariable String executionId,@PathVariable String invocationId,HttpServletRequest request){return actions.get(sessionId,executionId,invocationId,viewer(request));}
  @PostMapping("/{executionId}/{invocationId}/prepare")
  public EasyVBlockActionService.View prepare(@PathVariable String sessionId,@PathVariable String executionId,@PathVariable String invocationId,HttpServletRequest request){return actions.prepare(sessionId,executionId,invocationId,viewer(request));}
  @PostMapping("/actions/{actionId}/confirm")
  public EasyVBlockActionService.View confirm(@PathVariable String sessionId,@PathVariable String actionId,HttpServletRequest request){return actions.confirm(sessionId,actionId,viewer(request));}
  private AuthSession viewer(HttpServletRequest request){return auth.authenticate(request).orElseThrow(()->new BackendException("AUTH_REQUIRED","未登录。"));}
}
