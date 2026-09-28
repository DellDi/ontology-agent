package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class IdentityAccountServiceTest {
    @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
    JdbcTemplate jdbc;
    IdentityAccountService accounts;
    LocalIdentityProvider provider;

    @BeforeAll static void migrate() { MigrationTestSupport.migrate(POSTGRES); }
    @BeforeEach void setup() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
        jdbc.execute("truncate identity.role_grants, identity.accounts cascade");
        accounts = new IdentityAccountService(jdbc);
        provider = new LocalIdentityProvider(accounts);
    }

    @Test void seedAdminIsHashedIdempotentAndGrantsPlatformAdmin() {
        accounts.seedAdmin("operator", "test-initial-password-long");
        String hash = jdbc.queryForObject("select password_hash from identity.accounts", String.class);
        assertFalse(hash.contains("test-initial-password-long"));
        accounts.seedAdmin("operator", "different-password-long");
        assertEquals(hash, jdbc.queryForObject("select password_hash from identity.accounts", String.class));

        var identity = provider.authenticatePassword("operator", "test-initial-password-long").orElseThrow();
        IdentityAccount account = accounts.findByAccount(identity.account()).orElseThrow();
        AccessScope scope = accounts.scope(account);
        assertEquals(List.of("PLATFORM_ADMIN"), scope.roleCodes());
        assertEquals("platform", scope.organizationId());
    }

    @Test void wrongPasswordsLockAccount() {
        accounts.seedAdmin("operator", "test-initial-password-long");
        assertTrue(provider.authenticatePassword("unknown", "incorrect-password").isEmpty());
        for (int i = 0; i < 5; i++) {
            assertTrue(provider.authenticatePassword("operator", "incorrect-password").isEmpty());
        }
        assertTrue(provider.authenticatePassword("operator", "test-initial-password-long").isEmpty());
        jdbc.update("update identity.accounts set locked_until = now() - interval '1 second'");
        assertTrue(provider.authenticatePassword("operator", "test-initial-password-long").isPresent());
    }

    @Test void provisionIsIdempotentAndBindsRoles() {
        IdentityAccount first = accounts.provision("18668184122", "开发账号", "dev-password-1",
                "org-easyv", "local", List.of("EASYV_ANALYST"), "test");
        IdentityAccount second = accounts.provision("18668184122", "不应覆盖", null,
                "org-other", "local", List.of("PLATFORM_ADMIN"), "test");
        assertEquals(first.id(), second.id());
        assertEquals("开发账号", second.displayName());
        assertEquals("org-easyv", second.organizationId());
        assertEquals(List.of("EASYV_ANALYST"), second.roleCodes());
        assertTrue(second.id() > 0);
    }

    @Test void subjectBindingsAreUpsertedListedAndRemoved() {
        IdentityAccount account = accounts.provision("18668184122", "开发账号", "dev-password-1",
                "org-easyv", "local", List.of("EASYV_ANALYST"), "test");
        accounts.bindSubject(account.id(), "easyv", "userId", " 15 ", "admin");
        accounts.bindSubject(account.id(), "easyv", "userId", "16", "admin");

        assertEquals(java.util.Optional.of("16"), accounts.subjectValue(account.id(), "easyv", "userId"));
        assertEquals(List.of(new IdentityAccountService.SubjectBinding("easyv", "userId", "16")),
                accounts.subjectBindings(account.id()));

        accounts.unbindSubject(account.id(), "easyv", "userId");
        assertTrue(accounts.subjectBindings(account.id()).isEmpty());
    }

    @Test void subjectBindingRejectsInvalidInputAndUnknownAccount() {
        IdentityAccount account = accounts.provision("user-1", null, null, null, "local", List.of(), "test");
        assertEquals("IDENTITY_BINDING_INVALID", assertThrows(BackendException.class,
                () -> accounts.bindSubject(account.id(), "EasyV", "userId", "16", "admin")).code());
        assertEquals("IDENTITY_BINDING_INVALID", assertThrows(BackendException.class,
                () -> accounts.bindSubject(account.id(), "easyv", "userId", " ", "admin")).code());
        assertEquals("IDENTITY_ACCOUNT_NOT_FOUND", assertThrows(BackendException.class,
                () -> accounts.bindSubject(account.id() + 1000, "easyv", "userId", "16", "admin")).code());
    }

    @Test void provisionRejectsInvalidAccountAndWeakPassword() {
        assertThrows(BackendException.class,
                () -> accounts.provision("", null, "password-123", "org", "local", List.of(), "test"));
        assertThrows(BackendException.class,
                () -> accounts.provision("user", null, "short", "org", "local", List.of(), "test"));
        assertEquals(0, jdbc.queryForObject("select count(*) from identity.accounts", Integer.class));
    }

    @Test void provisionAllowsPasswordlessAccountForBridgeSource() {
        IdentityAccount account = accounts.provision("easyv-embed-user", null, null,
                "org-easyv", "bridge", List.of("EASYV_ANALYST"), "test");
        assertNull(account.passwordHash());
        assertTrue(provider.authenticatePassword("easyv-embed-user", "any-password").isEmpty());
        assertEquals(List.of("EASYV_ANALYST"), accounts.scope(account).roleCodes());
    }

    @Test void rejectsWeakSeedAndInvalidAccount() {
        assertThrows(IllegalArgumentException.class, () -> accounts.seedAdmin("admin", "short"));
        assertThrows(IllegalArgumentException.class, () -> accounts.seedAdmin("invalid account", "long-enough-password"));
        assertEquals(0, jdbc.queryForObject("select count(*) from identity.accounts", Integer.class));
    }
}
