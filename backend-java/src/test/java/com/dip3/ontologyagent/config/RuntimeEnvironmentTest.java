package com.dip3.ontologyagent.config;

import static org.junit.jupiter.api.Assertions.*;

import com.dip3.ontologyagent.config.RuntimeEnvironment.Kind;
import org.junit.jupiter.api.Test;

class RuntimeEnvironmentTest {
  private static final String COMPANY = "jdbc:postgresql://172.16.124.100:32408/ontology_agent_test?stringtype=unspecified";

  @Test
  void localDevAcceptsOnlyThisMachinesDatabaseAndReportsItsCoordinates() {
    for (String host : new String[] {"127.0.0.1", "localhost", "[::1]", "host.docker.internal", "postgres"}) {
      var environment = RuntimeEnvironment.resolve("local-dev", "", "jdbc:postgresql://" + host + ":55432/ontology_agent_local", false);
      assertEquals(Kind.LOCAL, environment.kind(), host);
      assertFalse(environment.remoteDatabase(), host);
      assertEquals(55432, environment.database().port());
      assertEquals("ontology_agent_local", environment.database().name());
    }
    var defaults = RuntimeEnvironment.resolve("local-dev", "", "jdbc:postgresql://127.0.0.1/ontology_agent?stringtype=unspecified", false);
    assertEquals(5432, defaults.database().port(), "未写端口时使用 PostgreSQL 默认端口");
    assertEquals("ontology_agent", defaults.database().name(), "查询参数不属于库名");
  }

  @Test
  void localDevRefusesCompanyDatabaseWithAMessageThatNamesTheFix() {
    var error = assertThrows(IllegalStateException.class, () -> RuntimeEnvironment.resolve("local-dev", "", COMPANY, false));
    for (String expected : new String[] {"local-dev", "172.16.124.100:32408/ontology_agent_test", "JAVA_DATABASE_URL", "DIP3_ALLOW_REMOTE_DATABASE", "docs/environments.md"}) {
      assertTrue(error.getMessage().contains(expected), "提示缺少「" + expected + "」：" + error.getMessage());
    }
    assertFalse(error.getMessage().contains("password"), "提示不得回显凭据");
    assertThrows(IllegalStateException.class, () -> RuntimeEnvironment.resolve("local-dev", "", "jdbc:postgresql://127.0.0.1.evil.example:5432/db", false),
        "不能靠前缀冒充本机");
  }

  @Test
  void explicitRemoteOptInIsAllowedButStaysVisible() {
    var environment = RuntimeEnvironment.resolve("local-dev", "", COMPANY, true);
    assertTrue(environment.remoteDatabase());
    assertEquals("172.16.124.100", environment.database().host());
  }

  @Test
  void sharedAndProductionEnvironmentsAreDeclaredNotGuessed() {
    var shared = RuntimeEnvironment.resolve("easyv-dev", "", COMPANY, false);
    assertEquals(Kind.SHARED, shared.kind());
    assertEquals("公司验收 easyv-dev", shared.label());
    assertFalse(shared.remoteDatabase(), "非本地环境连接共享库是常态，不标记为远程告警");
    var production = RuntimeEnvironment.resolve("production", "", "jdbc:postgresql://db.internal:5432/ontology_agent", false);
    assertEquals(Kind.PRODUCTION, production.kind());
    assertEquals("生产", production.label());
    var custom = RuntimeEnvironment.resolve("uat-2", "UAT 第二套", "jdbc:postgresql://uat-db:5432/app", false);
    assertEquals(Kind.SHARED, custom.kind());
    assertEquals("UAT 第二套", custom.label());
    assertEquals("本地开发", RuntimeEnvironment.resolve("local-dev", "", "jdbc:postgresql://localhost/x", false).label());
  }

  @Test
  void invalidDeclarationsAndUnreadableUrlsFailLoudInsteadOfFallingBack() {
    for (String name : new String[] {"", "  ", "Local Dev", "1dev", "x", "local_dev", "a".repeat(40)}) {
      assertThrows(IllegalStateException.class, () -> RuntimeEnvironment.resolve(name, "", "jdbc:postgresql://localhost/x", false), "[" + name + "]");
    }
    assertThrows(IllegalStateException.class, () -> RuntimeEnvironment.resolve("easyv-dev", "", "postgres://localhost/x", false));
    assertThrows(IllegalStateException.class, () -> RuntimeEnvironment.resolve("easyv-dev", "", "jdbc:postgresql:///x", false));
  }

  @Test
  void aProcessWithoutAPlatformDatabaseIsStillIdentified() {
    var environment = RuntimeEnvironment.resolve("local-dev", "", null, false);
    assertNull(environment.database());
    assertFalse(environment.remoteDatabase());
  }
}
