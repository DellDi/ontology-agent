package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.support.BackendException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 登录用例：开发联调登录、目录账号密码登录、URL 桥接登录、回调登录、登出。
 *
 * <p>错误语义沿用历史实现：凭证类错误带具体中文原因（code=INVALID_ERP_CREDENTIALS），
 * 开发入口关闭使用 code=DEV_AUTH_DISABLED。
 */
@Service
public final class AuthLoginService {
    private static final Logger log = LoggerFactory.getLogger(AuthLoginService.class);

    public static final String DEV_AUTH_DISABLED = "DEV_AUTH_DISABLED";
    public static final String INVALID_ERP_CREDENTIALS = "INVALID_ERP_CREDENTIALS";

    private static final List<String> ALLOWED_RETURN_PATH_ROOTS = List.of("/workspace", "/admin");

    public record DevLoginCommand(String employeeId, String displayName, String organizationId,
                                  List<String> projectIds, List<String> areaIds, List<String> roleCodes) {
        public DevLoginCommand {
            projectIds = projectIds == null ? List.of() : projectIds;
            areaIds = areaIds == null ? List.of() : areaIds;
            roleCodes = roleCodes == null ? List.of() : roleCodes;
        }
    }

    public record LoginResult(AuthSession session, String nextPath) {}

    private final BackendProperties properties;
    private final AuthSessionRepository sessions;
    private final ErpDirectoryService directory;
    private final ErpPasswordEncryptor encryptor;

    public AuthLoginService(BackendProperties properties, AuthSessionRepository sessions,
                            ErpDirectoryService directory, ErpPasswordEncryptor encryptor) {
        this.properties = properties;
        this.sessions = sessions;
        this.directory = directory;
        this.encryptor = encryptor;
    }

    /** 开发联调登录（手填 scope）；ENABLE_DEV_ERP_AUTH 未开启时拒绝。 */
    public LoginResult devLogin(DevLoginCommand command, String next) {
        requireDevAuth("手填 scope 登录入口已关闭，请使用目录账号密码登录。");
        String userId = command.employeeId().trim();
        String organizationId = command.organizationId().trim();
        if (userId.isEmpty() || organizationId.isEmpty()) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "ERP 身份校验失败，请检查账号与组织范围后重试。");
        }
        AccessScope scope = new AccessScope(organizationId,
                uniqueNonBlank(command.projectIds()),
                uniqueNonBlank(command.areaIds()),
                uniqueNonBlank(command.roleCodes()));
        String displayName = command.displayName() != null && !command.displayName().isBlank()
                ? command.displayName().trim()
                : "ERP 用户 " + userId;
        return createLoginResult(new AuthIdentity(userId, displayName, scope), next);
    }

    /** 目录账号密码登录。 */
    public LoginResult directoryLogin(String account, String password, String next) {
        ErpDirectoryUser user = requireActiveUser(account);
        String encrypted = encryptor.encrypt(password == null ? "" : password)
                .orElseThrow(() -> new BackendException(INVALID_ERP_CREDENTIALS, "密码验证失败，请稍后重试。"));
        String storedPassword = user.userPassword == null ? "" : user.userPassword.trim();
        if (storedPassword.isEmpty() || !storedPassword.equals(encrypted)) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "密码错误，请重试。");
        }
        return identityResult(user, next);
    }

    /** URL 桥接登录：目录账号直接换取会话（不校验密码）。 */
    public LoginResult urlBridgeLogin(String account, String next) {
        return identityResult(requireActiveUser(account), next);
    }

    /** 回调登录：优先解析 ticket（employeeId|displayName|organizationId|projects|areas|roles）。 */
    public LoginResult callbackLogin(String ticket, String employeeId, String displayName,
                                     String organizationId, String projectIds, String areaIds,
                                     String roleCodes, String next) {
        requireDevAuth("当前环境未开放开发联调登录入口，请改用真实 ERP 登录流程或显式开启开发认证开关。");
        if (ticket != null && !ticket.isBlank()) {
            String[] parts = ticket.split("\\|", -1);
            String projects = at(parts, 3);
            String areas = at(parts, 4);
            String roles = at(parts, 5);
            return devLogin(new DevLoginCommand(at(parts, 0), at(parts, 1), at(parts, 2),
                    parseScopeParam(projects), parseScopeParam(areas), parseScopeParam(roles)), next);
        }
        return devLogin(new DevLoginCommand(employeeId, displayName, organizationId,
                parseScopeParam(projectIds), parseScopeParam(areaIds), parseScopeParam(roleCodes)), next);
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

    private void requireDevAuth(String message) {
        if (!properties.devAuthEnabled()) {
            throw new BackendException(DEV_AUTH_DISABLED, message);
        }
    }

    private ErpDirectoryUser requireActiveUser(String account) {
        String trimmedAccount = account == null ? "" : account.trim();
        if (trimmedAccount.isEmpty()) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "账号不能为空。");
        }
        List<ErpDirectoryUser> users = directory.findUserByAccount(trimmedAccount);
        if (users.isEmpty()) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "账号不存在，请检查后重试。");
        }
        if (users.size() > 1) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "账号命中多条记录，请联系管理员处理。");
        }
        ErpDirectoryUser user = users.get(0);
        if (user.disabled()) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "该账号已停用，请联系管理员。");
        }
        return user;
    }

    private LoginResult identityResult(ErpDirectoryUser user, String next) {
        if (user.organizationId == null) {
            throw new BackendException(INVALID_ERP_CREDENTIALS, "该账号未关联组织，无法登录。");
        }
        String userId = String.valueOf(user.sourceId);
        AccessScope scope = directory.resolveUserScope(userId, user.organizationId, user.userAccount);
        String displayName = user.sentryName != null && !user.sentryName.isBlank()
                ? user.sentryName.trim()
                : (user.userAccount != null && !user.userAccount.isBlank() ? user.userAccount : userId);
        return createLoginResult(new AuthIdentity(userId, displayName, scope), next);
    }

    private LoginResult createLoginResult(AuthIdentity identity, String next) {
        AuthSession session = sessions.create(identity);
        return new LoginResult(session, sanitizeNextPath(next));
    }

    private static List<String> parseScopeParam(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        return uniqueNonBlank(List.of(raw.split(",")));
    }

    private static List<String> uniqueNonBlank(List<String> values) {
        List<String> result = new ArrayList<>();
        for (String value : values) {
            String trimmed = value == null ? "" : value.trim();
            if (!trimmed.isEmpty() && !result.contains(trimmed)) {
                result.add(trimmed);
            }
        }
        return List.copyOf(result);
    }

    private static String at(String[] parts, int index) {
        return index < parts.length ? parts[index] : null;
    }
}
