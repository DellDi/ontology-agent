package com.dip3.ontologyagent.auth;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Optional;
import java.util.UUID;

/**
 * 平台本地账号提供者（默认）：对 identity.accounts 做口令校验与锁定。
 *
 * <p>与历史 admin-login 同一安全语义：账号不存在时执行哑哈希比对拉齐耗时，
 * 连续 5 次失败锁定 5 分钟；停用/锁定一律返回 empty。
 */
@Component
@ConditionalOnProperty(prefix = "dip3.auth.providers.local", name = "enabled", havingValue = "true", matchIfMissing = true)
public final class LocalIdentityProvider implements IdentityProvider {

    public static final String KEY = "local";
    private static final String DUMMY_HASH = PasswordHash.hash(UUID.randomUUID().toString());

    private final IdentityAccountService accounts;

    public LocalIdentityProvider(IdentityAccountService accounts) {
        this.accounts = accounts;
    }

    @Override
    public String key() {
        return KEY;
    }

    @Override
    public Optional<ProviderIdentity> authenticatePassword(String account, String password) {
        if (account == null || password == null
                || account.length() > 100 || password.length() > 1024) {
            PasswordHash.matches(String.valueOf(password), DUMMY_HASH);
            return Optional.empty();
        }
        Optional<IdentityAccount> found = accounts.findByAccount(account.trim());
        if (found.isEmpty()) {
            PasswordHash.matches(password, DUMMY_HASH);
            return Optional.empty();
        }
        IdentityAccount row = found.get();
        if (row.disabled() || row.locked() || row.passwordHash() == null) {
            return Optional.empty();
        }
        if (!PasswordHash.matches(password, row.passwordHash())) {
            accounts.recordFailedAttempt(row.id());
            return Optional.empty();
        }
        accounts.clearFailedAttempts(row.id());
        return Optional.of(new ProviderIdentity(row.account(), row.displayName(), row.organizationId()));
    }
}
