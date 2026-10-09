package com.dip3.ontologyagent.auth;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.config.RuntimeEnvironment;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class LocalDevAccountSeedTest {
  @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
  private static final RuntimeEnvironment LOCAL = RuntimeEnvironment.resolve("local-dev", "", "jdbc:postgresql://127.0.0.1:55432/ontology_agent_local", false);
  private JdbcTemplate jdbc;
  private IdentityAccountService accounts;
  private LocalIdentityProvider provider;

  @BeforeAll static void migrate() { MigrationTestSupport.migrate(POSTGRES); }

  @BeforeEach void setup() {
    jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    jdbc.execute("truncate identity.subject_bindings, identity.role_grants, identity.accounts cascade");
    accounts = new IdentityAccountService(jdbc);
    provider = new LocalIdentityProvider(accounts);
  }

  @Test void seedsTheFiveAcceptanceShapedAccountsWithRolesOrganizationsAndEasyVBindings() {
    assertEquals(5, LocalDevAccountSeed.seed(accounts, LOCAL, "123456"));
    assertEquals(List.of("18668184122", "acceptance-admin", "acceptance-scoped", "acceptance-unbound", "platform-admin"),
        accounts.list().stream().map(IdentityAccount::account).sorted().toList());
    var business = accounts.findByAccount("18668184122").orElseThrow();
    assertEquals("业务验收账号", business.displayName());
    assertEquals(List.of("EASYV_ANALYST"), business.roleCodes());
    assertEquals("easyv-dev", business.organizationId());
    assertEquals("3", accounts.subjectValue(business.id(), "easyv", "userId").orElseThrow());
    var scoped = accounts.findByAccount("acceptance-scoped").orElseThrow();
    assertEquals("8", accounts.subjectValue(scoped.id(), "easyv", "userId").orElseThrow());
    assertTrue(accounts.subjectBindings(accounts.findByAccount("acceptance-unbound").orElseThrow().id()).isEmpty());
    assertEquals(List.of("PLATFORM_ADMIN"), accounts.findByAccount("platform-admin").orElseThrow().roleCodes());
    assertEquals("platform", accounts.findByAccount("acceptance-admin").orElseThrow().organizationId());
  }

  @Test void theSeededPasswordWorksForLoginAndIsStoredOnlyAsAHash() {
    LocalDevAccountSeed.seed(accounts, LOCAL, "123456");
    assertTrue(provider.authenticatePassword("18668184122", "123456").isPresent());
    assertTrue(provider.authenticatePassword("18668184122", "654321").isEmpty());
    assertFalse(jdbc.queryForObject("select password_hash from identity.accounts where account = '18668184122'", String.class).contains("123456"));
  }

  @Test void rerunningKeepsExistingCredentialsAndRepairsMissingRolesAndBindings() {
    LocalDevAccountSeed.seed(accounts, LOCAL, "123456");
    jdbc.update("delete from identity.subject_bindings");
    jdbc.update("delete from identity.role_grants where account_id = (select id from identity.accounts where account = '18668184122')");
    assertEquals(5, LocalDevAccountSeed.seed(accounts, LOCAL, "another-secret"));
    assertEquals(5, jdbc.queryForObject("select count(*) from identity.accounts", Integer.class));
    assertTrue(provider.authenticatePassword("18668184122", "123456").isPresent(), "既有口令不被重置");
    assertTrue(provider.authenticatePassword("18668184122", "another-secret").isEmpty());
    var business = accounts.findByAccount("18668184122").orElseThrow();
    assertEquals(List.of("EASYV_ANALYST"), business.roleCodes());
    assertEquals("3", accounts.subjectValue(business.id(), "easyv", "userId").orElseThrow());
  }

  @Test void refusesEveryEnvironmentExceptALocalProcessOnALocalDatabase() {
    var company = "jdbc:postgresql://172.16.124.100:32408/ontology_agent_test";
    for (var environment : List.of(RuntimeEnvironment.resolve("easyv-dev", "", company, false),
        RuntimeEnvironment.resolve("production", "", company, false),
        RuntimeEnvironment.resolve("local-dev", "", company, true))) {
      assertThrows(IllegalStateException.class, () -> LocalDevAccountSeed.seed(accounts, environment, "123456"), environment.name());
    }
    assertEquals(0, jdbc.queryForObject("select count(*) from identity.accounts", Integer.class));
  }

  @Test void thePlatformPasswordPolicyStaysUnchangedForEveryOtherPath() {
    assertEquals("IDENTITY_PASSWORD_INVALID", assertThrows(BackendException.class,
        () -> accounts.provision("someone", "x", "123456", "org", "local", List.of(), "test")).code());
    assertThrows(IllegalArgumentException.class, () -> accounts.seedAdmin("operator", "123456"));
    assertThrows(IllegalArgumentException.class, () -> LocalDevAccountSeed.seed(accounts, LOCAL, " "));
  }
}
