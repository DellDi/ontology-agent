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
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

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
        registry.add("dip3.dev-auth-enabled", () -> "true");
        registry.add("dip3.erp-api-base-url", () -> "http://127.0.0.1:1");
    }

    @BeforeAll
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @BeforeEach
    void clean() {
        jdbc.update("truncate platform.auth_sessions");
        jdbc.update("truncate erp_staging.dw_datacenter_system_organization,"
                + " erp_staging.dw_datacenter_precinct, erp_staging.dw_datacenter_system_user");
    }

    @MockitoBean
    ErpPasswordEncryptor passwordEncryptor;

    @Autowired JdbcTemplate jdbc;
    @Autowired AuthSessionRepository sessions;
    @Autowired CookieSessionAuthenticator cookieAuth;
    @Autowired AuthLoginService auth;
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
    void devLoginNormalizesScopeAndDefaultsDisplayName() {
        AuthLoginService.LoginResult result = auth.devLogin(
                new AuthLoginService.DevLoginCommand("  user-1 ", "  ", "org-1",
                        List.of("p1", " p1 ", "", "p2"), List.of(), List.of("a", "b", "b")),
                "/workspace");
        assertEquals("user-1", result.session().userId());
        assertEquals("ERP 用户 user-1", result.session().displayName());
        assertEquals(List.of("p1", "p2"), result.session().scope().projectIds());
        assertEquals(List.of("a", "b"), result.session().scope().roleCodes());
        assertEquals("/workspace", result.nextPath());
        assertEquals(Optional.of("user-1"),
                sessions.findValid(result.session().sessionId()).map(AuthSession::userId));
    }

    @Test
    void devLoginRejectedWhenDevAuthDisabled() {
        BackendProperties disabled = withDevAuth(false);
        AuthLoginService service = new AuthLoginService(disabled, sessions,
                new ErpDirectoryService(null), passwordEncryptor);
        BackendException error = assertThrows(BackendException.class, () -> service.devLogin(
                new AuthLoginService.DevLoginCommand("user-1", null, "org-1",
                        List.of(), List.of(), List.of()),
                "/workspace"));
        assertEquals("DEV_AUTH_DISABLED", error.code());
    }

    @Test
    void directoryLoginResolvesScopeFromOrganizationPath() {
        seedOrganization(1L, "platform", "/1");
        seedOrganization(2L, "propertyProject", "/1/2");
        seedOrganization(3L, "propertyProject", "/1/2/3");
        seedPrecinct("project-2", "2", 0, 0);
        seedPrecinct("project-3", "3", 0, 0);
        seedPrecinct("project-deleted", "3", 1, 0);
        seedUser(10L, "analyst-a", "encrypted-password", 1L, "1", 0, "分析师甲");

        when(passwordEncryptor.encrypt(anyString())).thenReturn(Optional.of("encrypted-password"));
        AuthLoginService.LoginResult result = auth.directoryLogin("analyst-a", "plain", "/workspace");

        assertEquals("10", result.session().userId());
        assertEquals("分析师甲", result.session().displayName());
        assertEquals("1", result.session().scope().organizationId());
        // 组织 1 的后代 propertyProject（2、3）下的未删除项目
        assertEquals(List.of("project-2", "project-3"), result.session().scope().projectIds());
        // 目录登录只授予 PROPERTY_ANALYST，不存在账号名特判
        assertEquals(List.of(ErpDirectoryService.PROPERTY_ANALYST), result.session().scope().roleCodes());
    }

    @Test
    void adminAccountGetsNoSpecialPlatformAdminRole() {
        seedOrganization(1L, "platform", "/1");
        seedOrganization(2L, "propertyProject", "/1/2");
        seedPrecinct("project-2", "2", 0, 0);
        seedUser(20L, "admin", "encrypted-admin", 1L, "1", 0, "管理员");

        when(passwordEncryptor.encrypt(anyString())).thenReturn(Optional.of("encrypted-admin"));
        AuthLoginService.LoginResult result = auth.directoryLogin("admin", "plain", "/workspace");

        assertEquals(List.of(ErpDirectoryService.PROPERTY_ANALYST), result.session().scope().roleCodes());
        assertFalse(result.session().scope().roleCodes().contains("PLATFORM_ADMIN"));
    }

    @Test
    void directoryLoginRejectsWrongPasswordDisabledAccountAndUnknownAccount() {
        seedUser(30L, "active-user", "correct", 1L, "1", 0, "正常账号");
        seedUser(31L, "disabled-user", "correct", 1L, "0", 0, "停用账号");

        when(passwordEncryptor.encrypt(anyString())).thenReturn(Optional.of("wrong"));
        BackendException wrongPassword = assertThrows(BackendException.class,
                () -> auth.directoryLogin("active-user", "bad", "/workspace"));
        assertEquals("密码错误，请重试。", wrongPassword.getMessage());

        when(passwordEncryptor.encrypt(anyString())).thenReturn(Optional.of("correct"));
        BackendException disabled = assertThrows(BackendException.class,
                () -> auth.directoryLogin("disabled-user", "correct", "/workspace"));
        assertEquals("该账号已停用，请联系管理员。", disabled.getMessage());

        BackendException unknown = assertThrows(BackendException.class,
                () -> auth.directoryLogin("nobody", "correct", "/workspace"));
        assertEquals("账号不存在，请检查后重试。", unknown.getMessage());

        BackendException empty = assertThrows(BackendException.class,
                () -> auth.directoryLogin("  ", "correct", "/workspace"));
        assertEquals("账号不能为空。", empty.getMessage());
    }

    @Test
    void urlBridgeLoginSkipsPasswordButKeepsAccountChecks() {
        seedOrganization(1L, "platform", "/1");
        seedOrganization(2L, "propertyProject", "/1/2");
        seedPrecinct("project-2", "2", 0, 0);
        seedUser(40L, "bridge-user", "irrelevant", 1L, "1", 0, "桥接用户");

        AuthLoginService.LoginResult result = auth.urlBridgeLogin("bridge-user", "/admin/ontology");
        assertEquals("/admin/ontology", result.nextPath());
        assertEquals(List.of("project-2"), result.session().scope().projectIds());

        BackendException unknown = assertThrows(BackendException.class,
                () -> auth.urlBridgeLogin("nobody", "/workspace"));
        assertEquals("账号不存在，请检查后重试。", unknown.getMessage());
    }

    @Test
    void logoutDeletesOnlyOwnSession() {
        AuthSession first = auth.devLogin(new AuthLoginService.DevLoginCommand("u-1", null, "org-1",
                List.of(), List.of(), List.of()), "/workspace").session();
        AuthSession second = auth.devLogin(new AuthLoginService.DevLoginCommand("u-2", null, "org-1",
                List.of(), List.of(), List.of()), "/workspace").session();

        auth.logout(first.sessionId());

        assertEquals(Optional.empty(), sessions.findValid(first.sessionId()));
        assertEquals(Optional.of("u-2"), sessions.findValid(second.sessionId()).map(AuthSession::userId));
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
    void authConfigReflectsDirectoryAvailability() {
        assertEquals("http://127.0.0.1:1", properties.erpApiBaseUrl());
        assertTrue(properties.directoryAuthAvailable());
    }

    private BackendProperties withDevAuth(boolean devEnabled) {
        return new BackendProperties(properties.sessionSecret(), properties.redisKeyPrefix(),
                properties.cube(), properties.neo4j(), properties.worker(), properties.stream(),
                properties.erpApiBaseUrl(), properties.erpApiOrigin(), devEnabled,
                properties.urlBridgeEnabled(), properties.cookieSecure());
    }

    private void seedOrganization(long sourceId, String nature, String path) {
        jdbc.update("insert into erp_staging.dw_datacenter_system_organization"
                        + " (source_id, organization_name, organization_nature, organization_path)"
                        + " values (?, ?, ?, ?)",
                sourceId, "组织" + sourceId, nature, path);
    }

    private void seedPrecinct(String precinctId, String orgId, int isDelete, int deleteFlag) {
        jdbc.update("insert into erp_staging.dw_datacenter_precinct"
                        + " (precinct_id, precinct_name, org_id, is_delete, delete_flag)"
                        + " values (?, ?, ?, ?, ?)",
                precinctId, "项目" + precinctId, orgId, isDelete, deleteFlag);
    }

    private void seedUser(long sourceId, String account, String password, long organizationId,
                          String isActived, int isDeleted, String sentryName) {
        jdbc.update("insert into erp_staging.dw_datacenter_system_user"
                        + " (source_id, user_account, user_password, organization_id, is_actived, is_deleted, sentry_name)"
                        + " values (?, ?, ?, ?, ?, ?, ?)",
                sourceId, account, password, organizationId, isActived, isDeleted, sentryName);
    }
}
