package com.dip3.ontologyagent.auth;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
public class AdminAccountService {
    private static final String DUMMY_HASH = AdminPasswordHash.hash(UUID.randomUUID().toString());
    private final JdbcTemplate jdbc;
    private final AuthSessionRepository sessions;
    public AdminAccountService(JdbcTemplate jdbc, AuthSessionRepository sessions) { this.jdbc = jdbc; this.sessions = sessions; }
    private record Account(String id, String hash, boolean locked) {}

    @Transactional
    public Optional<AuthSession> login(String username, String password) {
        if (username == null || password == null || username.length() > 100 || password.length() > 1024) return Optional.empty();
        var accounts = jdbc.query("select user_id,password_hash,locked_until > now() as locked from platform.admin_accounts where username=? for update",
                (rs, n) -> new Account(rs.getString(1), rs.getString(2), rs.getBoolean(3)), username);
        if (accounts.isEmpty()) { AdminPasswordHash.matches(password, DUMMY_HASH); return Optional.empty(); }
        var account = accounts.getFirst();
        if (account.locked()) return Optional.empty();
        if (!AdminPasswordHash.matches(password, account.hash())) {
            jdbc.update("""
                    update platform.admin_accounts set failed_attempts=failed_attempts+1,
                      locked_until=case when failed_attempts+1 >= 5 then now()+interval '5 minutes' else null end
                    where username=?
                    """, username);
            audit(account.id(), "denied");
            return Optional.empty();
        }
        jdbc.update("update platform.admin_accounts set failed_attempts=0,locked_until=null where username=?", username);
        var session = sessions.create(new AuthIdentity(account.id(), "平台管理员",
                new AccessScope("platform", List.of(), List.of(), List.of("PLATFORM_ADMIN"))));
        audit(account.id(), "success");
        return Optional.of(session);
    }
    @Transactional
    public void seed(String username, String password) {
        if (username == null || !username.matches("[a-zA-Z0-9][a-zA-Z0-9_.-]{2,99}") || password == null || password.length() < 16 || password.length() > 1024)
            throw new IllegalArgumentException("ADMIN_SEED_USERNAME must be 3-100 account characters; ADMIN_SEED_PASSWORD must be 16-1024 characters");
        // Initialization is idempotent; rerunning deployment never resets an existing password.
        jdbc.update("insert into platform.admin_accounts(username,user_id,password_hash) values(?,?,?) on conflict(username) do nothing",
                username, "admin:" + UUID.randomUUID(), AdminPasswordHash.hash(password));
    }
    private void audit(String userId, String result) {
        jdbc.update("""
                insert into platform.audit_events(id,user_id,organization_id,event_type,event_result,event_source,correlation_id,payload,created_at,retention_until)
                values(?,?,'platform','auth.admin.login',?,'admin-login',?,'{}'::jsonb,now(),now()+interval '180 days')
                """, UUID.randomUUID().toString(), userId, result, UUID.randomUUID().toString());
    }
}
