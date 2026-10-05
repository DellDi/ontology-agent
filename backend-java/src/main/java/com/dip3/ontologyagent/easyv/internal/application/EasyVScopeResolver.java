package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.auth.IdentityAccountService;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort.Scope;
import com.dip3.ontologyagent.support.BackendException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * EasyV 授权：PLATFORM_ADMIN 或 EASYV_ANALYST 可发起分析；userId 为执行者审计归属。
 * 数据范围在提交时冻结进能力快照：PLATFORM_ADMIN 为全部数据（all），其余账号限定为其绑定的
 * EasyV user_id（scoped）；运行时工具重新核验当前权限，最多收窄冻结范围。
 */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVScopeResolver {
  public static final int SCHEMA_VERSION = 2;
  public static final String ACCESS_ALL = "all";
  public static final String ACCESS_SCOPED = "scoped";
  public static final String REQUIRED_ROLE = "EASYV_ANALYST";
  public static final String BINDING_SOURCE = "easyv";
  public static final String BINDING_SUBJECT = "userId";
  private static final String POSITIVE_ID = "[1-9][0-9]*";

  private final IdentityAccountService accounts;

  public EasyVScopeResolver(IdentityAccountService accounts) {
    this.accounts = accounts;
  }

  /** Worker 不携带登录角色；运行时工具从平台身份库核验当前账号，再收窄冻结范围。 */
  public AuthSession executionPrincipal(AuthSession principal) {
    String id = validUserId(principal);
    var account = accounts.findById(Long.parseLong(id))
        .orElseThrow(() -> new BackendException("AUTH_REQUIRED", "执行账号不存在。"));
    if (account.disabled()) throw new BackendException("ACCOUNT_DISABLED", "执行账号已停用。");
    var current = new AuthSession(principal.sessionId(), id, account.displayName(), accounts.scope(account), principal.expiresAt());
    if (!principal.scope().organizationId().equals(current.scope().organizationId())) {
      throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "执行期间账号组织已变化，请重新发起分析。");
    }
    requireRole(current);
    return current;
  }

  public ResolvedScopeSnapshot resolveScope(AuthSession principal) {
    String userId = validUserId(principal);
    requireRole(principal);
    if (principal.scope().roleCodes().contains(IdentityAccountService.PLATFORM_ADMIN)) {
      return new ResolvedScopeSnapshot(EasyVGenerationOntology.DOMAIN_KEY, SCHEMA_VERSION,
          Map.of("userId", userId, "accessMode", ACCESS_ALL));
    }
    String easyvUserId = accounts.subjectValue(Long.parseLong(userId), BINDING_SOURCE, BINDING_SUBJECT)
        .orElseThrow(() -> new BackendException("EASYV_USER_BINDING_REQUIRED",
            "当前账号未绑定 EasyV 用户，请联系管理员绑定后再分析。"));
    if (!easyvUserId.matches(POSITIVE_ID)) {
      throw new BackendException("EASYV_USER_BINDING_INVALID", "当前账号绑定的 EasyV 用户 ID 无效：" + easyvUserId);
    }
    return new ResolvedScopeSnapshot(EasyVGenerationOntology.DOMAIN_KEY, SCHEMA_VERSION,
        Map.of("userId", userId, "accessMode", ACCESS_SCOPED, "easyvUserId", easyvUserId));
  }

  public void validateScope(ResolvedScopeSnapshot snapshot, AuthSession principal) {
    String userId = validUserId(principal);
    if (snapshot == null
        || !EasyVGenerationOntology.DOMAIN_KEY.equals(snapshot.domainKey())
        || snapshot.schemaVersion() != SCHEMA_VERSION
        || !userId.equals(snapshot.values().get("userId"))
        || !validValues(snapshot.values())) {
      throw new BackendException("EASYV_SCOPE_INVALID", "EasyV 授权范围快照无效或来自旧版分析链路。");
    }
  }

  /** 冻结快照对应的语义查询数据范围。 */
  public static Scope dataScope(ResolvedScopeSnapshot snapshot) {
    if (snapshot == null || snapshot.schemaVersion() != SCHEMA_VERSION || !validValues(snapshot.values())) {
      throw new BackendException("EASYV_SCOPE_INVALID", "EasyV 授权范围快照无效或来自旧版分析链路。");
    }
    return ACCESS_ALL.equals(snapshot.values().get("accessMode"))
        ? Scope.everything()
        : Scope.restricted(Map.of(BINDING_SUBJECT, List.of((String) snapshot.values().get("easyvUserId"))));
  }

  /** 当前权限只能收窄冻结范围；EasyV 当前只有一个用户绑定维度。 */
  public static ResolvedScopeSnapshot narrowScope(ResolvedScopeSnapshot frozen, ResolvedScopeSnapshot current) {
    Scope oldScope = dataScope(frozen); Scope nowScope = dataScope(current);
    if (nowScope.all()) return frozen;
    if (oldScope.all()) return current;
    if (!oldScope.values().equals(nowScope.values())) {
      throw new BackendException("OBJECT_SCOPE_FORBIDDEN", "当前账号绑定已变化，无法读取原执行的数据范围。");
    }
    return frozen;
  }

  /** 面向用户的数据范围描述。 */
  public static String dataScopeLabel(ResolvedScopeSnapshot snapshot) {
    return ACCESS_ALL.equals(snapshot.values().get("accessMode"))
        ? "全部数据"
        : "EasyV 用户 " + snapshot.values().get("easyvUserId") + " 的数据";
  }

  private static boolean validValues(Map<String, Object> values) {
    Object accessMode = values.get("accessMode");
    if (!(values.get("userId") instanceof String userId) || !userId.matches(POSITIVE_ID)) return false;
    if (ACCESS_ALL.equals(accessMode)) {
      return values.keySet().equals(Set.of("userId", "accessMode"));
    }
    return ACCESS_SCOPED.equals(accessMode)
        && values.keySet().equals(Set.of("userId", "accessMode", "easyvUserId"))
        && values.get("easyvUserId") instanceof String easyvUserId && easyvUserId.matches(POSITIVE_ID);
  }

  private static String validUserId(AuthSession principal) {
    if (principal == null || principal.userId() == null || !principal.userId().matches(POSITIVE_ID)) {
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
