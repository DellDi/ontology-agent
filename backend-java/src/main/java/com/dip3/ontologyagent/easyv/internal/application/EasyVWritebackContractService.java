package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVWritebackContract;
import com.dip3.ontologyagent.support.BackendException;
import java.util.Objects;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/** EasyV 写回上游契约检查服务；严格要求平台管理员权限并保持只读语义。 */
@Service
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public class EasyVWritebackContractService {
  private final EasyVWritebackContractPort probe;

  public EasyVWritebackContractService(EasyVWritebackContractPort probe) {
    this.probe = Objects.requireNonNull(probe, "probe must not be null");
  }

  public EasyVWritebackContract.Report check(AuthSession actor) {
    requireAdmin(actor);
    return probe.check();
  }

  private static void requireAdmin(AuthSession actor) {
    if (actor == null) {
      throw new BackendException("AUTH_REQUIRED", "未登录。");
    }
    if (actor.scope() == null
        || actor.scope().roleCodes() == null
        || !actor.scope().roleCodes().contains(IdentityAccountService.PLATFORM_ADMIN)) {
      throw new BackendException("EASYV_WRITEBACK_CONTRACT_FORBIDDEN",
          "仅平台管理员可执行 EasyV 写回上游契约检查。");
    }
  }
}
