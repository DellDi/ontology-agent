package com.dip3.ontologyagent.easyv.internal.adapter.in;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.CookieSessionAuthenticator;
import com.dip3.ontologyagent.easyv.internal.application.EasyVWritebackContractService;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;
import com.dip3.ontologyagent.support.BackendException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** EasyV 写回上游契约只读探针管理入口；仅向已登录平台管理员开放。 */
@RestController
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVWritebackContractController {
  private final CookieSessionAuthenticator auth;
  private final EasyVWritebackContractService service;

  public EasyVWritebackContractController(
      CookieSessionAuthenticator auth,
      EasyVWritebackContractService service) {
    this.auth = auth;
    this.service = service;
  }

  @GetMapping("/api/admin/easyv/writeback/contract-check")
  public EasyVWritebackContract.Report check(HttpServletRequest request) {
    AuthSession actor = auth.authenticate(request)
        .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "未登录。"));
    return service.check(actor);
  }
}
