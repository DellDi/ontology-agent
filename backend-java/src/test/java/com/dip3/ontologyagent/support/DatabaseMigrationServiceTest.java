package com.dip3.ontologyagent.support;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.Connection;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
class DatabaseMigrationServiceTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    private static JdbcTemplate jdbc;

    @BeforeAll
    static void setup() {
        jdbc = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }

    @BeforeEach
    void resetDatabase() {
        jdbc.execute("drop schema if exists platform cascade");
        jdbc.execute("drop schema if exists erp_staging cascade");
        jdbc.execute("drop table if exists public.spring_ai_chat_memory cascade");
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");
    }

    private DatabaseMigrationService service() {
        return new DatabaseMigrationService(jdbc.getDataSource());
    }

    private boolean historyExists() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.flyway_schema_history') is not null", Boolean.class));
    }

    @Test
    void freshDatabaseRunsSingleInitScript() {
        DatabaseMigrationService.Decision decision = service().run();
        assertEquals(DatabaseMigrationService.Decision.INITIALIZED_FROM_EMPTY, decision);

        Integer applied = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where success", Integer.class);
        assertEquals(1, applied, "合并后的初始化脚本应只执行一次（V1__init.sql）");
        Integer platformTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'platform'", Integer.class);
        assertTrue(platformTables >= 20, "初始化应建齐 platform 业务表");
        Integer erpTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'erp_staging'", Integer.class);
        assertTrue(erpTables >= 9, "初始化应建齐 erp_staging 表");
        assertTrue(Boolean.TRUE.equals(jdbc.queryForObject(
                "select to_regclass('public.spring_ai_chat_memory') is not null", Boolean.class)));
        assertEquals(0, service().pendingMigrations().length);
    }

    @Test
    void existingFlywayHistoryIsIdempotent() {
        service().run();
        DatabaseMigrationService.Decision decision = service().run();
        assertEquals(DatabaseMigrationService.Decision.MIGRATED_INCREMENTAL, decision);
        Integer executed = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where type = 'SQL'", Integer.class);
        assertEquals(1, executed, "重复执行不得重跑初始化脚本");
    }

    @Test
    void existingBusinessSchemaWithoutHistoryFailsLoudly() throws Exception {
        // 模拟旧库：只有业务 schema（如旧 Drizzle 库），没有 Flyway 历史
        try (Connection connection = POSTGRES.createConnection("")) {
            ScriptUtils.executeSqlScript(connection,
                    new ClassPathResource("db/migration/V1__init.sql"));
            jdbc.execute("drop table if exists public.flyway_schema_history cascade");
        }
        assertFalse(historyExists());

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> service().run());
        assertTrue(error.getMessage().contains("不会对已有库执行"), error.getMessage());
        assertFalse(historyExists(), "拒绝执行时不得写入任何 Flyway 历史");
    }
}
