package com.dip3.ontologyagent.support;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
        assertEquals(DatabaseMigrationService.Decision.INITIALIZED, decision);

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
    void initScriptItselfIsReusable() {
        // 模拟不依赖 Flyway 的重复执行：先 Flyway 建库，清空历史后整份脚本重跑一遍，
        // 第二次必须全部 IF NOT EXISTS 跳过而不报错（DO $$ 块由 Flyway 执行器解析）。
        service().run();
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");

        service().run();

        Integer platformTables = jdbc.queryForObject(
                "select count(*) from pg_tables where schemaname = 'platform'", Integer.class);
        assertTrue(platformTables >= 20, "重复执行后表结构应保持不变");
        Integer foreignKeys = jdbc.queryForObject(
                "select count(*) from pg_constraint where contype = 'f'", Integer.class);
        assertEquals(5, foreignKeys, "重复执行不应产生重复外键约束");
    }

    @Test
    void existingBusinessSchemaWithoutHistoryIsCompletedIdempotently() {
        // 模拟旧库：只有业务 schema（如旧 Drizzle 库），没有 Flyway 历史
        service().run();
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");
        assertFalse(historyExists());

        // 幂等 init 脚本对已有库直接补全，不报错、不丢数据
        DatabaseMigrationService.Decision decision = service().run();
        assertEquals(DatabaseMigrationService.Decision.INITIALIZED, decision);
        Integer applied = jdbc.queryForObject(
                "select count(*) from flyway_schema_history where type = 'SQL' and success", Integer.class);
        assertEquals(1, applied, "旧库补全后 V1 应只记录一次执行（baseline 0 标记不计入）");
    }
}
