package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * EasyV 授权：PLATFORM_ADMIN 或 EASYV_ANALYST 可发起分析；userId 为执行者审计归属。
 * 语义查询数据范围：PLATFORM_ADMIN 为全部数据，其余账号限定为其绑定的 EasyV user_id。
 */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVScopeResolver {
  public static final int SCHEMA_VERSION = 1;
  public static final String ACCESS_MODE = "all";
  public static final String REQUIRED_ROLE = "EASYV_ANALYST";
  public static final String BINDING_SOURCE = "easyv";
  public static final String BINDING_SUBJECT = "userId";

  private final IdentityAccountService accounts;

  public EasyVScopeResolver(IdentityAccountService accounts) {
    this.accounts = accounts;
  }

  public ResolvedScopeSnapshot resolveScope(AuthSession principal) {
    String userId = validUserId(principal);
    requireRole(principal);
    return new ResolvedScopeSnapshot(
        EasyVGenerationOntology.DOMAIN_KEY,
        SCHEMA_VERSION,
        Map.of("userId", userId, "accessMode", ACCESS_MODE));
  }

  public void validateScope(ResolvedScopeSnapshot snapshot, AuthSession principal) {
    String userId = validUserId(principal);
    if (snapshot == null
        || !EasyVGenerationOntology.DOMAIN_KEY.equals(snapshot.domainKey())
        || snapshot.schemaVersion() != SCHEMA_VERSION
        || !snapshot.values().keySet().equals(java.util.Set.of("userId", "accessMode"))
        || !userId.equals(snapshot.values().get("userId"))
        || !ACCESS_MODE.equals(snapshot.values().get("accessMode"))) {
      throw new BackendException("EASYV_SCOPE_INVALID", "EasyV 授权范围快照无效。");
    }
  }

  /** 发起者可访问的 EasyV 数据范围；非管理员未绑定 EasyV user_id 时拒绝。 */
  public Scope dataScope(AuthSession principal) {
    String userId = validUserId(principal);
    requireRole(principal);
    if (principal.scope().roleCodes().contains(IdentityAccountService.PLATFORM_ADMIN)) {
      return Scope.everything();
    }
    String easyvUserId = accounts.subjectValue(Long.parseLong(userId), BINDING_SOURCE, BINDING_SUBJECT)
        .orElseThrow(() -> new BackendException("EASYV_USER_BINDING_REQUIRED",
            "当前账号未绑定 EasyV 用户，请联系管理员绑定后再分析。"));
    if (!easyvUserId.matches("[1-9][0-9]*")) {
      throw new BackendException("EASYV_USER_BINDING_INVALID", "当前账号绑定的 EasyV 用户 ID 无效：" + easyvUserId);
    }
    return Scope.restricted(Map.of(BINDING_SUBJECT, List.of(easyvUserId)));
  }

  private static String validUserId(AuthSession principal) {
    if (principal == null || principal.userId() == null || !principal.userId().matches("[1-9][0-9]*")) {
      throw new BackendException("EASYV_SCOPE_INVALID", "EasyV 仅支持可解析为正数的可信用户 ID。");
    }
    return principal.userId();
  }

  private static void requireRole(AuthSession principal) {
    if (principal.scope() == null || (!principal.scope().roleCodes().contains(REQUIRED_ROLE)
        && !principal.scope().roleCodes().contains(IdentityAccountService.PLATFORM_ADMIN))) {
      throw new BackendException("EASYV_SCOPE_FORBIDDEN", "当前账号没有 EASYV_ANALYST 或 PLATFORM_ADMIN 权限。");
    }
  }
}
