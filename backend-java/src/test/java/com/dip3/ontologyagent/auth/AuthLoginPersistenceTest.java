package com.dip3.ontologyagent.auth;

import com.dip3.ontologyagent.config.BackendProperties;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
class AuthLoginPersistenceTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.data.redis.url", () -> "redis://127.0.0.1:1");
        registry.add("spring.ai.openai.base-url", () -> "http://127.0.0.1:1");
        registry.add("spring.ai.openai.api-key", () -> "test-key");
        registry.add("spring.ai.openai.chat.model", () -> "test-model");
        registry.add("spring.ai.openai.chat.max-retries", () -> "0");
        registry.add("spring.ai.openai.chat.parallel-tool-calls", () -> "false");
        registry.add("dip3.ai.provider.mode", () -> "openai-compatible");
        registry.add("dip3.ai.provider.tool-calling", () -> "true");
        registry.add("dip3.ai.provider.structured-output", () -> "native-json-schema");
        registry.add("spring.ai.chat.memory.repository.jdbc.initialize-schema", () -> "never");
        registry.add("dip3.session-secret", () -> "test-session-secret-with-adequate-entropy");
        registry.add("dip3.redis-key-prefix", () -> "test");
        registry.add("dip3.cube.api-url", () -> "http://127.0.0.1:1/cubejs-api/v1");
        registry.add("dip3.cube.api-secret", () -> "cube-secret");
        registry.add("dip3.cube.timeout", () -> "1s");
        registry.add("dip3.neo4j.uri", () -> "bolt://127.0.0.1:1");
        registry.add("dip3.neo4j.username", () -> "neo4j");
        registry.add("dip3.neo4j.password", () -> "neo4j-test-password");
        registry.add("dip3.neo4j.database", () -> "neo4j");
        registry.add("dip3.worker.poll-delay", () -> "1s");
        registry.add("dip3.stream.poll-delay", () -> "10ms");
        registry.add("dip3.stream.timeout", () -> "1s");
        registry.add("dip3.auth.providers.bridge.enabled", () -> "false");
    }

    @BeforeAll
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @BeforeEach
    void clean() {
        jdbc.update("truncate platform.auth_sessions");
        jdbc.update("truncate identity.role_grants, identity.accounts cascade");
        jdbc.update("delete from platform.audit_events where event_type = 'auth.login'");
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired AuthSessionRepository sessions;
    @Autowired CookieSessionAuthenticator cookieAuth;
    @Autowired AuthLoginService auth;
    @Autowired IdentityAccountService accounts;
    @Autowired BackendProperties properties;

    @Test
    void cookieValueRoundTripsAndTamperedSignatureIsRejected() {
        String sessionId = "session-1";
        String cookieValue = cookieAuth.createCookieValue(sessionId);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie(CookieSessionAuthenticator.COOKIE_NAME, cookieValue));
        assertEquals(Optional.of(sessionId), cookieAuth.verifiedSessionId(request));

        MockHttpServletRequest tampered = new MockHttpServletRequest();
        tampered.setCookies(new Cookie(CookieSessionAuthenticator.COOKIE_NAME, cookieValue + "x"));
        assertEquals(Optional.empty(), cookieAuth.verifiedSessionId(tampered));
        assertEquals(Optional.empty(), cookieAuth.verifiedSessionId(new MockHttpServletRequest()));
    }

    @Test
    void sessionCreateFindAndDeleteFollowTtl() {
        AuthIdentity identity = new AuthIdentity("user-1", "测试用户",
                new AccessScope("org-1", List.of("project-1", "project-1"), List.of(), List.of("analyst")));
        AuthSession created = sessions.create(identity);
        assertTrue(created.expiresAt().isAfter(Instant.now().plus(Duration.ofHours(7))));

        AuthSession loaded = sessions.findValid(created.sessionId()).orElseThrow();
        assertEquals(List.of("project-1"), loaded.scope().projectIds());

        jdbc.update("update platform.auth_sessions set expires_at = now() - interval '1 hour' where session_id = ?",
                created.sessionId());
        assertEquals(Optional.empty(), sessions.findValid(created.sessionId()));

        sessions.delete(created.sessionId());
        assertEquals(Optional.empty(), sessions.findValid(created.sessionId()));
    }

    @Test
    void loginIssuesSessionWithScopeFromPlatformIdentity() {
        IdentityAccount account = accounts.provision("analyst-a", "分析师甲", "password-123",
                "org-hz-001", "local", List.of("EASYV_ANALYST"), "test");

        AuthLoginService.LoginResult result = auth.login("analyst-a", "password-123", "/workspace");

        assertEquals(String.valueOf(account.id()), result.session().userId());
        assertEquals("分析师甲", result.session().displayName());
        assertEquals("org-hz-001", result.session().scope().organizationId());
        assertEquals(List.of("EASYV_ANALYST"), result.session().scope().roleCodes());
        assertTrue(result.session().scope().projectIds().isEmpty());
        assertEquals("/workspace", result.nextPath());
        assertEquals(Optional.of(String.valueOf(account.id())),
                sessions.findValid(result.session().sessionId()).map(AuthSession::userId));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from platform.audit_events where event_type='auth.login' and event_result='success'",
                Integer.class));
    }

    @Test
    void loginDefaultsToAdminLandingForPlatformAdmin() {
        accounts.provision("operator", null, "admin-password-123",
                null, "local", List.of(IdentityAccountService.PLATFORM_ADMIN), "test");

        AuthLoginService.LoginResult result = auth.login("operator", "admin-password-123", null);

        assertEquals("/admin/ingestion", result.nextPath());
        assertEquals("platform", result.session().scope().organizationId());
        assertEquals(List.of("PLATFORM_ADMIN"), result.session().scope().roleCodes());
    }

    @Test
    void loginRejectsWrongPasswordUnknownAccountAndDisabledAccount() {
        accounts.provision("active-user", null, "correct-password",
                "org-1", "local", List.of("EASYV_ANALYST"), "test");
        IdentityAccount disabled = accounts.provision("disabled-user", null, "correct-password",
                "org-1", "local", List.of(), "test");
        accounts.setStatus(disabled.id(), "disabled");

        BackendException wrongPassword = assertThrows(BackendException.class,
                () -> auth.login("active-user", "bad-password", "/workspace"));
        assertEquals(AuthLoginService.INVALID_CREDENTIALS, wrongPassword.code());

        BackendException unknown = assertThrows(BackendException.class,
                () -> auth.login("nobody", "correct-password", "/workspace"));
        assertEquals(AuthLoginService.INVALID_CREDENTIALS, unknown.code());

        BackendException empty = assertThrows(BackendException.class,
                () -> auth.login("  ", "correct-password", "/workspace"));
        assertEquals(AuthLoginService.INVALID_CREDENTIALS, empty.code());

        BackendException disabledLogin = assertThrows(BackendException.class,
                () -> auth.login("disabled-user", "correct-password", "/workspace"));
        assertEquals(AuthLoginService.INVALID_CREDENTIALS, disabledLogin.code());
        assertTrue(jdbc.queryForObject(
                "select count(*) from platform.audit_events where event_type='auth.login' and event_result='denied'",
                Integer.class) >= 1);
    }

    @Test
    void failedPasswordAttemptsLockAccountTemporarily() {
        accounts.provision("lock-user", null, "correct-password",
                "org-1", "local", List.of("EASYV_ANALYST"), "test");

        for (int i = 0; i < 5; i++) {
            assertThrows(BackendException.class,
                    () -> auth.login("lock-user", "wrong-password", "/workspace"));
        }
        // 5 次失败后即使正确密码也被锁定拒绝
        assertThrows(BackendException.class,
                () -> auth.login("lock-user", "correct-password", "/workspace"));

        jdbc.update("update identity.accounts set locked_until = now() - interval '1 second'"
                + " where account = 'lock-user'");
        assertEquals("/workspace",
                auth.login("lock-user", "correct-password", "/workspace").nextPath());
    }

    @Test
    void bridgeLoginRequiresEnabledFlagAndProvisionedAccount() {
        accounts.provision("bridge-user", "桥接用户", null,
                "org-easyv", "bridge", List.of("EASYV_ANALYST"), "test");

        BackendException disabled = assertThrows(BackendException.class,
                () -> auth.bridgeLogin("bridge-user", "/workspace"));
        assertEquals(AuthLoginService.BRIDGE_DISABLED, disabled.code());

        BackendProperties enabled = new BackendProperties(properties.sessionSecret(),
                properties.redisKeyPrefix(), properties.cube(), properties.neo4j(),
                properties.worker(), properties.stream(),
                new BackendProperties.Auth(new BackendProperties.Auth.Providers(
                        new BackendProperties.Auth.Providers.Local(true),
                        new BackendProperties.Auth.Providers.Bridge(true))),
                properties.cookieSecure());
        AuthLoginService bridgeAuth = new AuthLoginService(enabled, sessions, accounts,
                List.of(new LocalIdentityProvider(accounts)));

        AuthLoginService.LoginResult result = bridgeAuth.bridgeLogin("bridge-user", "/workspace");
        assertEquals("org-easyv", result.session().scope().organizationId());
        assertEquals(List.of("EASYV_ANALYST"), result.session().scope().roleCodes());

        BackendException unknown = assertThrows(BackendException.class,
                () -> bridgeAuth.bridgeLogin("not-provisioned", "/workspace"));
        assertEquals(AuthLoginService.INVALID_CREDENTIALS, unknown.code());
    }

    @Test
    void logoutDeletesOnlyOwnSession() {
        accounts.provision("u-1", null, "password-123", "org-1", "local", List.of(), "test");
        accounts.provision("u-2", null, "password-123", "org-1", "local", List.of(), "test");
        AuthSession first = auth.login("u-1", "password-123", "/workspace").session();
        AuthSession second = auth.login("u-2", "password-123", "/workspace").session();

        auth.logout(first.sessionId());

        assertEquals(Optional.empty(), sessions.findValid(first.sessionId()));
        assertEquals(Optional.of(second.userId()),
                sessions.findValid(second.sessionId()).map(AuthSession::userId));
    }

    @Test
    void sanitizeNextPathOnlyAllowsWorkspaceAndAdminRoots() {
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath(null));
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath(""));
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath("https://evil.example/x"));
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath("//evil"));
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath("/login?next=/workspace"));
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath("/other"));
        assertEquals("/workspace", AuthLoginService.sanitizeNextPath("/workspace-evil"));
        assertEquals("/workspace?tab=history", AuthLoginService.sanitizeNextPath("/workspace?tab=history"));
        assertEquals("/admin/ontology", AuthLoginService.sanitizeNextPath("/admin/ontology"));
        assertEquals("/workspace/analysis/a-1", AuthLoginService.sanitizeNextPath("/workspace/analysis/a-1"));
    }

    @Test
    void authConfigReflectsLocalProviderAvailability() {
        assertTrue(properties.auth().providers().local().enabled());
        assertFalse(properties.auth().providers().bridge().enabled());
    }
}
