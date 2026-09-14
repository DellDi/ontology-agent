package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Optional;

/**
 * 登录用例：Provider 账号密码登录、URL 桥接登录、登出。
 *
 * <p>Provider 只证明身份；登录后的 AccessScope 由平台身份库
 * （identity.accounts + identity.role_grants）装配，不存在账号名特判。
 */
@Service
public final class AuthLoginService {
    public static final String INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
    public static final String BRIDGE_DISABLED = "BRIDGE_DISABLED";

    private static final List<String> ALLOWED_RETURN_PATH_ROOTS = List.of("/workspace", "/admin");

    public record LoginResult(AuthSession session, String nextPath) {}

    private final BackendProperties properties;
    private final AuthSessionRepository sessions;
    private final IdentityAccountService accounts;
    private final List<IdentityProvider> providers;

    public AuthLoginService(BackendProperties properties, AuthSessionRepository sessions,
                            IdentityAccountService accounts, List<IdentityProvider> providers) {
        this.properties = properties;
        this.sessions = sessions;
        this.accounts = accounts;
        this.providers = providers;
    }

    /** 统一账号密码登录：依次尝试启用的 Provider，首个成功为准。 */
    public LoginResult login(String account, String password, String next) {
        String normalized = account == null ? "" : account.trim();
        if (normalized.isEmpty() || password == null || password.isEmpty()) {
            throw new BackendException(INVALID_CREDENTIALS, "账号或密码错误，请重试。");
        }
        Optional<ProviderIdentity> authenticated = providers.stream()
                .map(provider -> provider.authenticatePassword(normalized, password))
                .filter(Optional::isPresent)
                .map(Optional::get)
                .findFirst();
        if (authenticated.isEmpty()) {
            accounts.auditLogin(normalized, IdentityAccountService.PLATFORM_ORGANIZATION, "denied");
            throw new BackendException(INVALID_CREDENTIALS, "账号或密码错误，请重试。");
        }
        IdentityAccount row = accounts.findByAccount(authenticated.get().account())
                .orElseThrow(() -> new BackendException(INVALID_CREDENTIALS,
                        "该账号未开通平台访问权限，请联系管理员。"));
        return issueSession(row, next);
    }

    /**
     * URL 桥接登录：可信上游平台携带已验证账号换取会话。
     * 账号须预先供给（password_hash 可为空，走桥接通道），不自动注册未知账号。
     */
    public LoginResult bridgeLogin(String account, String next) {
        if (!properties.auth().providers().bridge().enabled()) {
            throw new BackendException(BRIDGE_DISABLED, "URL 桥接登录未开启。");
        }
        String normalized = account == null ? "" : account.trim();
        IdentityAccount row = accounts.findByAccount(normalized)
                .orElseThrow(() -> new BackendException(INVALID_CREDENTIALS,
                        "桥接账号未开通平台访问权限，请联系管理员。"));
        return issueSession(row, next);
    }

    public void logout(String sessionId) {
        sessions.delete(sessionId);
    }

    /** 允许的返回路径仅限 /workspace 与 /admin，其余一律回落 /workspace（防开放重定向）。 */
    public static String sanitizeNextPath(String nextPath) {
        if (nextPath == null || nextPath.isBlank()) {
            return "/workspace";
        }
        String value = nextPath.trim().replace('\\', '/');
        if (!value.startsWith("/") || value.startsWith("//")) {
            return "/workspace";
        }
        int cut = Integer.MAX_VALUE;
        int queryIndex = value.indexOf('?');
        int hashIndex = value.indexOf('#');
        if (queryIndex >= 0) cut = Math.min(cut, queryIndex);
        if (hashIndex >= 0) cut = Math.min(cut, hashIndex);
        String path = cut == Integer.MAX_VALUE ? value : value.substring(0, cut);
        String suffix = cut == Integer.MAX_VALUE ? "" : value.substring(cut);
        boolean allowed = ALLOWED_RETURN_PATH_ROOTS.stream()
                .anyMatch(root -> path.equals(root) || path.startsWith(root + "/"));
        return allowed ? path + suffix : "/workspace";
    }

    private LoginResult issueSession(IdentityAccount account, String next) {
        if (account.disabled()) {
            throw new BackendException(INVALID_CREDENTIALS, "该账号已停用，请联系管理员。");
        }
        if (account.locked()) {
            throw new BackendException(INVALID_CREDENTIALS, "账号已锁定，请稍后重试。");
        }
        AccessScope scope = accounts.scope(account);
        AuthSession session = sessions.create(new AuthIdentity(
                String.valueOf(account.id()), account.displayName(), scope));
        accounts.auditLogin(String.valueOf(account.id()), scope.organizationId(), "success");
        String target = (next == null || next.isBlank())
                && scope.roleCodes().contains(IdentityAccountService.PLATFORM_ADMIN)
                ? "/admin/ingestion" : sanitizeNextPath(next);
        return new LoginResult(session, target);
    }
}
