package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.support.BackendException;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/** V1 deliberately limits EasyV analysis to the authenticated creator. */
@Component
@ConditionalOnProperty(prefix = "dip3.easyv", name = "enabled", havingValue = "true")
public final class EasyVScopeResolver {
  public static final int SCHEMA_VERSION = 1;
  public static final String ACCESS_MODE = "creator-owned";
  public static final String REQUIRED_ROLE = "EASYV_ANALYST";

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
      throw new BackendException("EASYV_SCOPE_INVALID", "EasyV creator-owned 授权范围快照无效。");
    }
  }

  private static String validUserId(AuthSession principal) {
    if (principal == null || principal.userId() == null || !principal.userId().matches("[1-9][0-9]*")) {
      throw new BackendException("EASYV_SCOPE_INVALID", "EasyV 仅支持可解析为正数的可信用户 ID。");
    }
    return principal.userId();
  }

  private static void requireRole(AuthSession principal) {
    if (principal.scope() == null || !principal.scope().roleCodes().contains(REQUIRED_ROLE)) {
      throw new BackendException("EASYV_SCOPE_FORBIDDEN", "当前账号没有 EASYV_ANALYST 权限。");
    }
  }
}
