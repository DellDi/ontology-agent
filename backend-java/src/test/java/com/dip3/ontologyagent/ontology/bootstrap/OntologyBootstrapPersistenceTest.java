package com.dip3.ontologyagent.ontology.bootstrap;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.AnalysisWorkflow;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
class OntologyBootstrapPersistenceTest {
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
    }

    @BeforeAll
    static void migrateAndInstallFailureGuard() throws Exception {
        Path migrations = Path.of(System.getProperty("user.dir")).resolveSibling("drizzle");
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword())) {
            for (String migration : List.of("0000_initial.sql", "0001_dazzling_dakota_north.sql",
                    "0002_wooden_morg.sql", "0003_oval_la_nuit.sql", "0004_wealthy_callisto.sql",
                    "0005_neat_tenebrous.sql")) {
                ScriptUtils.executeSqlScript(connection, new FileSystemResource(migrations.resolve(migration)));
            }
            try (var statement = connection.createStatement()) {
                statement.execute("""
                        create function platform.reject_bootstrap_audit() returns trigger language plpgsql as $body$
                        begin
                          if new.correlation_id = 'rollback-bootstrap' then
                            raise exception 'forced bootstrap audit failure';
                          end if;
                          return new;
                        end
                        $body$
                        """);
                statement.execute("""
                        create trigger reject_bootstrap_audit before insert on platform.audit_events
                        for each row execute function platform.reject_bootstrap_audit()
                        """);
            }
        }
    }

    @Autowired OntologyBootstrapService bootstrap;
    @Autowired OntologyRepository ontologies;
    @Autowired JdbcTemplate jdbc;

    @BeforeEach
    void resetDatabase() {
        jdbc.execute("""
                truncate platform.ontology_approval_records, platform.ontology_publish_records,
                  platform.ontology_change_requests, platform.ontology_entity_definitions,
                  platform.ontology_metric_definitions, platform.ontology_metric_variants,
                  platform.ontology_factor_definitions, platform.ontology_causality_edges,
                  platform.ontology_plan_step_templates, platform.ontology_tool_capability_bindings,
                  platform.ontology_time_semantics, platform.ontology_evidence_type_definitions,
                  platform.ontology_grounded_contexts, platform.ontology_versions, platform.audit_events cascade
                """);
    }

    @Test
    void bootstrapsEmptyRegistryAndExposesTheRuntimeCatalog() {
        assertEquals("empty", bootstrap.status(admin()).state());

        OntologyBootstrapResponses.Result result = bootstrap.bootstrap(admin(), "trace-bootstrap-created");

        assertTrue(result.created());
        assertTrue(result.status().ready());
        assertEquals(CanonicalOntologyBaseline.VERSION_ID, result.status().currentVersionId());
        assertEquals(3L, result.status().definitionCounts().get("metricVariants"));
        assertEquals(4L, result.status().definitionCounts().get("toolBindings"));
        assertEquals(1L, count("platform.ontology_publish_records"));
        assertEquals(1L, jdbc.queryForObject("""
                select count(*) from platform.audit_events
                where event_type='ontology.baseline.bootstrapped' and correlation_id='trace-bootstrap-created'
                """, Long.class));

        var catalog = ontologies.currentPublished();
        assertEquals(CanonicalOntologyBaseline.VERSION_ID, catalog.versionId());
        assertNotNull(catalog.metricVariants().stream()
                .filter(item -> "project-collection-rate".equals(item.businessKey())).findFirst().orElse(null));
        AnalysisWorkflow.validateCatalog(catalog);
    }

    @Test
    void repeatedBootstrapIsReadOnlyAndIdempotent() {
        OntologyBootstrapResponses.Result first = bootstrap.bootstrap(admin(), "trace-first");
        long auditCount = count("platform.audit_events");
        long definitionCount = count("platform.ontology_metric_variants");

        OntologyBootstrapResponses.Result second = bootstrap.bootstrap(admin(), "trace-second");

        assertTrue(first.created());
        assertFalse(second.created());
        assertEquals(auditCount, count("platform.audit_events"));
        assertEquals(definitionCount, count("platform.ontology_metric_variants"));
        assertEquals(0L, jdbc.queryForObject(
                "select count(*) from platform.audit_events where correlation_id='trace-second'", Long.class));
    }

    @Test
    void blockingTransactionLockSerializesConcurrentBootstrapCalls() throws Exception {
        CyclicBarrier barrier = new CyclicBarrier(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var first = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return bootstrap.bootstrap(admin(), "trace-concurrent-1");
            });
            var second = executor.submit(() -> {
                barrier.await(10, TimeUnit.SECONDS);
                return bootstrap.bootstrap(admin(), "trace-concurrent-2");
            });

            List<Boolean> created = List.of(first.get(30, TimeUnit.SECONDS).created(),
                    second.get(30, TimeUnit.SECONDS).created());
            assertEquals(1, created.stream().filter(Boolean::booleanValue).count());
        }
        assertEquals(1L, count("platform.ontology_versions"));
        assertEquals(1L, count("platform.audit_events"));
    }

    @Test
    void auditFailureRollsBackTheWholeBaseline() {
        assertThrows(RuntimeException.class, () -> bootstrap.bootstrap(admin(), "rollback-bootstrap"));

        assertEquals(0L, count("platform.ontology_versions"));
        assertEquals(0L, count("platform.ontology_metric_variants"));
        assertEquals(0L, count("platform.ontology_publish_records"));
        assertEquals(0L, count("platform.audit_events"));
    }

    @Test
    void rejectsPartialAndIncompleteRegistryInsteadOfOverwritingIt() {
        jdbc.update("""
                insert into platform.ontology_versions
                  (id,semver,display_name,status,description,created_by,created_at,updated_at)
                values ('partial','0.1.0','半成品','draft',null,'operator',now(),now())
                """);
        BackendException partial = assertThrows(BackendException.class,
                () -> bootstrap.bootstrap(admin(), "trace-partial"));
        assertEquals("ONTOLOGY_BOOTSTRAP_PARTIAL_STATE", partial.code());
        assertEquals(1L, count("platform.ontology_versions"));

        resetDatabase();
        jdbc.update("""
                insert into platform.ontology_versions
                  (id,semver,display_name,status,description,published_at,created_by,created_at,updated_at)
                values ('incomplete','1.0.0','不完整','approved',null,now(),'operator',now(),now())
                """);
        jdbc.update("""
                insert into platform.ontology_publish_records
                  (id,ontology_version_id,published_by,previous_version_id,change_request_ids,publish_note,created_at)
                values ('publish-incomplete','incomplete','operator',null,array[]::text[],null,now())
                """);
        BackendException incomplete = assertThrows(BackendException.class, () -> bootstrap.status(admin()));
        assertEquals("ONTOLOGY_BOOTSTRAP_INCOMPLETE_CURRENT", incomplete.code());
    }

    @Test
    void rejectsMultipleCurrentVersionsAndNonAdminOperators() {
        BackendException forbidden = assertThrows(BackendException.class, () -> bootstrap.status(viewer()));
        assertEquals("ONTOLOGY_BOOTSTRAP_FORBIDDEN", forbidden.code());

        jdbc.execute("drop index platform.ontology_versions_single_current_uidx");
        try {
            for (String id : List.of("current-a", "current-b")) {
                jdbc.update("""
                        insert into platform.ontology_versions
                          (id,semver,display_name,status,published_at,created_by,created_at,updated_at)
                        values (?,?,'冲突版本','approved',now(),'operator',now(),now())
                        """, id, "1.0." + id.charAt(id.length() - 1));
            }
            BackendException conflict = assertThrows(BackendException.class, () -> bootstrap.status(admin()));
            assertEquals("ONTOLOGY_BOOTSTRAP_MULTIPLE_CURRENT", conflict.code());
        } finally {
            jdbc.execute("truncate platform.ontology_versions cascade");
            jdbc.execute("""
                    create unique index ontology_versions_single_current_uidx
                    on platform.ontology_versions using btree (status)
                    where status = 'approved' and published_at is not null
                    """);
        }
    }

    private long count(String table) {
        Long count = jdbc.queryForObject("select count(*) from " + table, Long.class);
        return count == null ? 0 : count;
    }

    private static AuthSession admin() {
        return actor("PLATFORM_ADMIN");
    }

    private static AuthSession viewer() {
        return actor("ONTOLOGY_PUBLISHER");
    }

    private static AuthSession actor(String role) {
        return new AuthSession("session-bootstrap", "user-bootstrap", "Bootstrap Operator",
                new AccessScope("org-bootstrap", List.of(), List.of(), List.of(role)), Instant.MAX);
    }
}
