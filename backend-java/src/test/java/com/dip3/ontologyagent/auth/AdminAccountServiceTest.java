package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.time.Instant;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;

@Testcontainers
class AdminAccountServiceTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
    JdbcTemplate jdbc;
    AdminAccountService service;
    AuthSessionRepository sessions;
    @BeforeAll static void migrate() { MigrationTestSupport.migrate(POSTGRES); }
    @BeforeEach void setup() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("truncate platform.admin_accounts, platform.audit_events");
        sessions = mock(AuthSessionRepository.class);
        when(sessions.create(any())).thenAnswer(invocation -> {
            AuthIdentity identity = invocation.getArgument(0);
            return new AuthSession("session", identity.userId(), identity.displayName(), identity.scope(), Instant.now().plusSeconds(3600));
        });
        service = new AdminAccountService(jdbc, sessions);
    }
    @Test void seedIsHashedIdempotentAndDoesNotGrantBusinessIdentity() {
        service.seed("operator", "test-initial-password-long");
        String hash = jdbc.queryForObject("select password_hash from platform.admin_accounts", String.class);
        assertFalse(hash.contains("test-initial-password-long"));
        service.seed("operator", "different-password-long");
        assertEquals(hash, jdbc.queryForObject("select password_hash from platform.admin_accounts", String.class));
        var session = service.login("operator", "test-initial-password-long").orElseThrow();
        assertTrue(session.userId().startsWith("admin:"));
        assertEquals(List.of("PLATFORM_ADMIN"), session.scope().roleCodes());
        assertTrue(session.scope().projectIds().isEmpty());
        assertEquals(1, jdbc.queryForObject("select count(*) from platform.audit_events where event_result='success'", Integer.class));
    }
    @Test void wrongPasswordsLockAccountAndDoNotCreateSessions() {
        service.seed("operator", "test-initial-password-long");
        assertTrue(service.login("unknown", "incorrect").isEmpty());
        for (int i=0;i<5;i++) assertTrue(service.login("operator", "incorrect").isEmpty());
        assertTrue(service.login("operator", "test-initial-password-long").isEmpty());
        verifyNoInteractions(sessions);
        assertEquals(5, jdbc.queryForObject("select count(*) from platform.audit_events where event_result='denied'", Integer.class));
        jdbc.update("update platform.admin_accounts set locked_until=now()-interval '1 second'");
        assertTrue(service.login("operator", "test-initial-password-long").isPresent());
    }
    @Test void rejectsWeakSeedAndInvalidAccount() {
        assertThrows(IllegalArgumentException.class, () -> service.seed("admin", "short"));
        assertThrows(IllegalArgumentException.class, () -> service.seed("invalid account", "long-enough-password"));
        assertEquals(0, jdbc.queryForObject("select count(*) from platform.admin_accounts", Integer.class));
    }
}
