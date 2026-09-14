package com.dip3.ontologyagent.auth;

import java.util.Optional;

/**
 * 身份提供者端口：只负责证明"你是谁"。
 *
 * <p>实现按 {@code dip3.auth.providers.<key>} 条件装配（local/bridge/外部 IdP）。
 * 角色与组织归属不在此处决定——认证成功后由平台身份库（identity.*）装配 scope。
 */
public interface IdentityProvider {

    /** 提供者标识，如 local、bridge。 */
    String key();

    /**
     * 账号密码认证。
     *
     * @return 认证通过的外部身份；账号不存在或凭证错误返回 empty（不区分原因，防账号枚举）
     */
    Optional<ProviderIdentity> authenticatePassword(String account, String password);
}
