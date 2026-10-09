package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.RuntimeEnvironment;
import java.util.List;

/**
 * 本地开发账号：与 easyv-dev 验收账号同形（角色、组织、EasyV 用户绑定相同），口令由调用方给定。
 * 只允许在 local-dev 且连接本机库时运行；平台口令长度策略对其他路径不变。幂等，不重置既有口令。
 */
public final class LocalDevAccountSeed {
  record Spec(String account, String displayName, String organizationId, List<String> roles, String easyvUserId) {}

  static final List<Spec> ACCOUNTS = List.of(
      new Spec("platform-admin", "平台管理员", IdentityAccountService.PLATFORM_ORGANIZATION, List.of(IdentityAccountService.PLATFORM_ADMIN), null),
      new Spec("acceptance-admin", "平台管理员", IdentityAccountService.PLATFORM_ORGANIZATION, List.of(IdentityAccountService.PLATFORM_ADMIN), null),
      new Spec("18668184122", "业务验收账号", "easyv-dev", List.of("EASYV_ANALYST"), "3"),
      new Spec("acceptance-scoped", "acceptance-scoped", null, List.of("EASYV_ANALYST"), "8"),
      new Spec("acceptance-unbound", "acceptance-unbound", null, List.of("EASYV_ANALYST"), null));

  private LocalDevAccountSeed() {}

  public static int seed(IdentityAccountService accounts, RuntimeEnvironment environment, String password) {
    if (environment.kind() != RuntimeEnvironment.Kind.LOCAL || environment.remoteDatabase()) {
      throw new IllegalStateException("本地开发账号只能在 DIP3_ENVIRONMENT=local-dev 且连接本机数据库时创建，当前环境："
          + environment.name() + (environment.remoteDatabase() ? "（已允许远程库）" : "") + "。");
    }
    if (password == null || password.isBlank()) {
      throw new IllegalArgumentException("LOCAL_ACCOUNTS_PASSWORD 不能为空。");
    }
    for (Spec spec : ACCOUNTS) {
      var account = accounts.provisionWithoutPasswordPolicy(spec.account(), spec.displayName(), password,
          spec.organizationId(), "local", spec.roles(), "local-accounts");
      spec.roles().forEach(role -> accounts.grantRole(account.id(), role, "local-accounts"));
      if (spec.easyvUserId() != null) {
        accounts.bindSubject(account.id(), "easyv", "userId", spec.easyvUserId(), "local-accounts");
      }
    }
    return ACCOUNTS.size();
  }
}
