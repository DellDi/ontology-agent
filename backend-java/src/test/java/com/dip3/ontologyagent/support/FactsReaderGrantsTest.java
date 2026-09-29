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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
class FactsReaderGrantsTest {
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
        jdbc.execute("drop schema if exists facts cascade");
        jdbc.execute("drop schema if exists platform cascade");
        jdbc.execute("drop schema if exists erp_staging cascade");
        jdbc.execute("drop schema if exists ingestion cascade");
        jdbc.execute("drop table if exists public.spring_ai_chat_memory cascade");
        jdbc.execute("drop table if exists public.flyway_schema_history cascade");
        jdbc.execute("""
                do $$ begin
                  if exists (select 1 from pg_roles where rolname = 'cube_reader') then
                    drop owned by cube_reader;
                    drop role cube_reader;
                  end if;
                  if exists (select 1 from pg_roles where rolname = 'cube_admin') then
                    drop owned by cube_admin;
                    drop role cube_admin;
                  end if;
                end $$;
                """);
    }

    private FactsReaderGrants grants(String role) {
        return new FactsReaderGrants(jdbc.getDataSource(), role);
    }

    @Test
    void grantsFactsReadOnlyWithoutTouchingPlatformObjects() {
        jdbc.execute("create role cube_reader login password 'test'");
        MigrationTestSupport.migrate(POSTGRES);

        grants("cube_reader").apply();

        assertEquals(Boolean.TRUE, jdbc.queryForObject(
                "select has_table_privilege('cube_reader', 'facts.easyv_ai_application', 'SELECT')",
                Boolean.class));
        assertEquals(Boolean.FALSE, jdbc.queryForObject(
                "select has_schema_privilege('cube_reader', 'platform', 'USAGE')", Boolean.class));
        assertEquals(Boolean.FALSE, jdbc.queryForObject(
                "select has_table_privilege('cube_reader', 'platform.jobs', 'SELECT')", Boolean.class));
        // 重复执行幂等：不报错且授权保持。
        grants("cube_reader").apply();
        assertEquals(Boolean.TRUE, jdbc.queryForObject(
                "select has_table_privilege('cube_reader', 'facts.easyv_ai_application', 'SELECT')",
                Boolean.class));
    }

    @Test
    void missingRoleFailsLoudWithDbaInstructions() {
        MigrationTestSupport.migrate(POSTGRES);

        BackendException error =
                assertThrows(BackendException.class, () -> grants("cube_reader").apply());

        assertEquals("FACTS_READER_ROLE_MISSING", error.code());
        assertTrue(error.getMessage().contains("facts-reader-sql"));
    }

    @Test
    void privilegedRoleIsRejected() {
        MigrationTestSupport.migrate(POSTGRES);
        jdbc.execute("create role cube_admin login superuser password 'test'");

        BackendException error =
                assertThrows(BackendException.class, () -> grants("cube_admin").apply());

        assertEquals("FACTS_READER_ROLE_UNSAFE", error.code());
    }

    @Test
    void invalidRoleNameIsRejectedBeforeAnySql() {
        BackendException error =
                assertThrows(BackendException.class, () -> grants("cube-reader;drop table x").apply());
        assertEquals("FACTS_READER_ROLE_INVALID", error.code());
        assertThrows(BackendException.class, () -> grants("Cube_Reader").apply());
    }

    @Test
    void unconfiguredRoleSkipsGrants() {
        MigrationTestSupport.migrate(POSTGRES);
        grants("").apply();
    }
}
