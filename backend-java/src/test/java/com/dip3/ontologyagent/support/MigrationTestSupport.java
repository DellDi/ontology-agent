package com.dip3.ontologyagent.support;

import org.flywaydb.core.Flyway;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** 测试基座：在 Testcontainers PostgreSQL 上执行与生产同源的全部 Flyway migration。 */
public final class MigrationTestSupport {
    private MigrationTestSupport() {}

    @SuppressWarnings("rawtypes")
    public static void migrate(PostgreSQLContainer postgres) {
        migrate(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    public static void migrate(String jdbcUrl, String username, String password) {
        Flyway.configure()
                .dataSource(jdbcUrl, username, password)
                .baselineOnMigrate(false)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }
}
