package com.dip3.ontologyagent.support;

import org.flywaydb.core.Flyway;
import org.testcontainers.postgresql.PostgreSQLContainer;

/** 测试基座：在 Testcontainers PostgreSQL 上执行与生产同源的 Flyway V1~V6。 */
public final class MigrationTestSupport {
    private MigrationTestSupport() {}

    @SuppressWarnings("rawtypes")
    public static void migrate(PostgreSQLContainer postgres) {
        Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .baselineOnMigrate(false)
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }
}
