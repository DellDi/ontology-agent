package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 平台身份库：identity.accounts / identity.role_grants 的读写与 scope 装配。
 *
 * <p>Provider 只证明身份；这里的角色授予与组织归属决定 AccessScope。
 * projectIds/areaIds 不由身份层填充——域范围映射由各 domain pack 在执行期自行解析。
 */
@Service
public class IdentityAccountService {

    public static final String PLATFORM_ADMIN = "PLATFORM_ADMIN";
    public static final String PLATFORM_ORGANIZATION = "platform";

    private static final int MIN_PASSWORD_LENGTH = 8;
    private static final int MAX_PASSWORD_LENGTH = 1024;

    private final JdbcTemplate jdbc;

    public IdentityAccountService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<IdentityAccount> findByAccount(String account) {
        return jdbc.query("""
                        select id, account, display_name, password_hash, status, source,
                               organization_id, locked_until
                        from identity.accounts where account = ?
                        """,
                (rs, n) -> mapAccount(rs), account).stream().findFirst();
    }

    public Optional<IdentityAccount> findById(long id) {
        return jdbc.query("""
                        select id, account, display_name, password_hash, status, source,
                               organization_id, locked_until
                        from identity.accounts where id = ?
                        """,
                (rs, n) -> mapAccount(rs), id).stream().findFirst();
    }

    public List<String> roleCodes(long accountId) {
        return jdbc.queryForList(
                "select role_code from identity.role_grants where account_id = ? order by role_code",
                String.class, accountId);
    }

    /** 装配登录会话权限范围：组织 + 角色授予；无组织账号归入 platform 组织。 */
    public AccessScope scope(IdentityAccount account) {
        String org = account.organizationId() == null || account.organizationId().isBlank()
                ? PLATFORM_ORGANIZATION : account.organizationId();
        return new AccessScope(org, List.of(), List.of(), roleCodes(account.id()));
    }

    /**
     * 供给账号（本地建号或外部通道首登落库）。已有同账号时返回既有行。
     */
    @Transactional
    public IdentityAccount provision(String account, String displayName, String password,
                                     String organizationId, String source, List<String> roles,
                                     String grantedBy) {
        String normalized = normalizeAccount(account);
        Optional<IdentityAccount> existing = findByAccount(normalized);
        if (existing.isPresent()) {
            return existing.get();
        }
        validatePassword(password);
        jdbc.update("""
                        insert into identity.accounts(account, display_name, password_hash, source, organization_id)
                        values (?,?,?,?,?)
                        """,
                normalized, normalizeDisplayName(displayName, normalized),
                password == null ? null : PasswordHash.hash(password),
                source == null ? "local" : source,
                organizationId == null || organizationId.isBlank() ? null : organizationId.trim());
        IdentityAccount created = findByAccount(normalized).orElseThrow();
        for (String role : roles == null ? List.<String>of() : roles) {
            grantRole(created.id(), role, grantedBy);
        }
        return findByAccount(normalized).orElseThrow();
    }

    @Transactional
    public void grantRole(long accountId, String roleCode, String grantedBy) {
        String role = roleCode == null ? "" : roleCode.trim();
        if (role.isEmpty() || role.length() > 64) {
            throw new BackendException("IDENTITY_ROLE_INVALID", "角色编码不能为空且不超过 64 字符。");
        }
        jdbc.update("""
                        insert into identity.role_grants(account_id, role_code, granted_by)
                        values (?,?,?) on conflict do nothing
                        """, accountId, role, grantedBy);
    }

    @Transactional
    public void revokeRole(long accountId, String roleCode) {
        jdbc.update("delete from identity.role_grants where account_id = ? and role_code = ?",
                accountId, roleCode);
    }

    @Transactional
    public void setStatus(long accountId, String status) {
        if (!List.of("active", "disabled").contains(status)) {
            throw new BackendException("IDENTITY_STATUS_INVALID", "账号状态仅允许 active/disabled。");
        }
        int updated = jdbc.update(
                "update identity.accounts set status = ?, updated_at = now() where id = ?",
                status, accountId);
        if (updated == 0) {
            throw new BackendException("IDENTITY_ACCOUNT_NOT_FOUND", "账号不存在。");
        }
    }

    @Transactional
    public void updateProfile(long accountId, String displayName, String organizationId) {
        int updated = jdbc.update("""
                        update identity.accounts set display_name = ?, organization_id = ?, updated_at = now()
                        where id = ?
                        """,
                displayName == null || displayName.isBlank() ? null : displayName.trim(),
                organizationId == null || organizationId.isBlank() ? null : organizationId.trim(),
                accountId);
        if (updated == 0) {
            throw new BackendException("IDENTITY_ACCOUNT_NOT_FOUND", "账号不存在。");
        }
    }

    @Transactional
    public void resetPassword(long accountId, String password) {
        validatePassword(password);
        int updated = jdbc.update(
                "update identity.accounts set password_hash = ?, updated_at = now() where id = ?",
                PasswordHash.hash(password), accountId);
        if (updated == 0) {
            throw new BackendException("IDENTITY_ACCOUNT_NOT_FOUND", "账号不存在。");
        }
    }

    /**
     * 初始化平台管理员（admin-seed profile）：幂等，重复执行不重置既有口令。
     * 校验规则与历史 admin-seed 保持一致（账号 3-100 位，口令 16-1024 位）。
     */
    @Transactional
    public void seedAdmin(String username, String password) {
        if (username == null || !username.matches("[a-zA-Z0-9][a-zA-Z0-9_.-]{2,99}")
                || password == null || password.length() < 16 || password.length() > 1024) {
            throw new IllegalArgumentException(
                    "ADMIN_SEED_USERNAME must be 3-100 account characters; ADMIN_SEED_PASSWORD must be 16-1024 characters");
        }
        jdbc.update("""
                        insert into identity.accounts(account, display_name, password_hash, source, organization_id)
                        values (?, '平台管理员', ?, 'local', ?) on conflict (account) do nothing
                        """,
                username, PasswordHash.hash(password), PLATFORM_ORGANIZATION);
        findByAccount(username).ifPresent(a -> grantRole(a.id(), PLATFORM_ADMIN, "admin-seed"));
    }

    /** 记录失败尝试并按阈值锁定（5 次锁 5 分钟）。 */
    @Transactional
    public void recordFailedAttempt(long accountId) {
        jdbc.update("""
                update identity.accounts set failed_attempts = failed_attempts + 1,
                  locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
                where id = ?
                """, accountId);
    }

    @Transactional
    public void clearFailedAttempts(long accountId) {
        jdbc.update(
                "update identity.accounts set failed_attempts = 0, locked_until = null where id = ?",
                accountId);
    }

    public List<IdentityAccount> list() {
        return jdbc.query("""
                        select id, account, display_name, password_hash, status, source,
                               organization_id, locked_until
                        from identity.accounts order by id
                        """,
                (rs, n) -> mapAccount(rs));
    }

    static String normalizeAccount(String account) {
        String normalized = account == null ? "" : account.trim();
        if (normalized.isEmpty() || normalized.length() > 100) {
            throw new BackendException("IDENTITY_ACCOUNT_INVALID", "账号不能为空且不超过 100 字符。");
        }
        return normalized;
    }

    private static String normalizeDisplayName(String displayName, String fallback) {
        return displayName == null || displayName.isBlank() ? fallback : displayName.trim();
    }

    private static void validatePassword(String password) {
        if (password != null && (password.length() < MIN_PASSWORD_LENGTH
                || password.length() > MAX_PASSWORD_LENGTH)) {
            throw new BackendException("IDENTITY_PASSWORD_INVALID",
                    "密码长度须在 " + MIN_PASSWORD_LENGTH + "-" + MAX_PASSWORD_LENGTH + " 之间。");
        }
    }

    private IdentityAccount mapAccount(ResultSet rs) throws SQLException {
        Timestamp lockedUntil = rs.getTimestamp("locked_until");
        return new IdentityAccount(
                rs.getLong("id"),
                rs.getString("account"),
                rs.getString("display_name"),
                rs.getString("password_hash"),
                rs.getString("status"),
                rs.getString("source"),
                rs.getString("organization_id"),
                lockedUntil == null ? null : lockedUntil.toInstant(),
                roleCodes(rs.getLong("id")));
    }

    /** 登录审计事件。 */
    public void auditLogin(String userId, String organizationId, String result) {
        jdbc.update("""
                insert into platform.audit_events(id,user_id,organization_id,event_type,event_result,event_source,correlation_id,payload,created_at,retention_until)
                values(?,?,?,'auth.login',?,'account-login',?,'{}'::jsonb,now(),now()+interval '180 days')
                """, UUID.randomUUID().toString(), userId, organizationId, result,
                UUID.randomUUID().toString());
    }
}
