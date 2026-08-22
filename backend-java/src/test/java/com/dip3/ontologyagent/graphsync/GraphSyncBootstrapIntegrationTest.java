package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.apache.ibatis.session.SqlSessionFactory;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.neo4j.Neo4jContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;

import javax.sql.DataSource;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
class GraphSyncBootstrapIntegrationTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
    @Container
    static final Neo4jContainer NEO4J = new Neo4jContainer("neo4j:5.26.12-community").withoutAuthentication();
    private static AnnotationConfigApplicationContext context;
    private JdbcTemplate jdbc;
    private Driver driver;

    @BeforeAll
    static void startContext() throws Exception {
        Path migration = Path.of(System.getProperty("user.dir")).resolveSibling("drizzle/0000_initial.sql");
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword())) {
            ScriptUtils.executeSqlScript(connection, new FileSystemResource(migration));
        }
        context = new AnnotationConfigApplicationContext(TestConfig.class);
    }

    @AfterAll
    static void stopContext() { context.close(); }

    @BeforeEach
    void clean() {
        jdbc = context.getBean(JdbcTemplate.class);
        driver = context.getBean(Driver.class);
        jdbc.update("truncate platform.graph_sync_cursors,platform.graph_sync_dirty_scopes,platform.graph_sync_runs");
        jdbc.update("""
                truncate erp_staging.dw_datacenter_system_organization,
                         erp_staging.dw_datacenter_precinct,erp_staging.dw_datacenter_owner,
                         erp_staging.dw_datacenter_chargeitem,erp_staging.dw_datacenter_charge,
                         erp_staging.dw_datacenter_bill,erp_staging.dw_datacenter_services
                """);
        driver.executableQuery("match (n) detach delete n").execute();
    }

    @Test
    void emptyNeo4jBootstrapsMultipleOrganizationsThenIncrementalScanStartsAfterWatermark() {
        Instant at = Instant.parse("2026-08-22T00:00:00Z");
        seedOrganizations(at, 1001, 1002);

        GraphSyncRun parent = context.getBean(GraphSyncBootstrapService.class).run("trace-bootstrap");

        assertEquals("completed", parent.status());
        assertEquals("full-bootstrap", parent.mode());
        assertEquals(2, parent.nodesWritten());
        assertEquals(2, jdbc.queryForObject("""
                select count(*) from platform.graph_sync_runs
                where cursor_snapshot->>'parentRunId'=? and status='completed'
                """, Integer.class, parent.id()));
        assertEquals(7, jdbc.queryForObject("select count(*) from platform.graph_sync_cursors", Integer.class));
        assertEquals(parent.id(), jdbc.queryForObject("""
                select last_run_id from platform.graph_sync_cursors where source_name='erp.organizations'
                """, String.class));
        assertEquals(2L, driver.executableQuery("match (n:GraphNode) return count(n) as count")
                .execute().records().getFirst().get("count").asLong());

        GraphSyncCursor cursor = context.getBean(GraphSyncIncrementalMapper.class).cursor("erp.organizations");
        seedOrganizations(at.plusSeconds(1), 1003);
        List<GraphSyncChange> changes = context.getBean(GraphSyncSourceMapper.class)
                .scanOrganizations(cursor.cursorTime(), cursor.cursorPk(), 100);
        assertEquals(List.of("1003"), changes.stream().map(GraphSyncChange::sourcePk).toList());
    }

    @Test
    void childFailureFailsParentPreservesCompletedProjectionAndRollsBackAllCursorInitialization() {
        seedOrganizations(Instant.parse("2026-08-22T00:00:00Z"), 2001, 2002);
        GraphWriter real = context.getBean(GraphWriter.class);
        GraphWriter failSecond = (organizationId, runId, token, batch) -> {
            if ("2002".equals(organizationId)) {
                throw new GraphSyncException("NEO4J_GRAPH_SYNC_FAILED", "forced failure", false);
            }
            return real.replaceOrganization(organizationId, runId, token, batch);
        };
        GraphSyncBootstrapService service = service(failSecond);

        BackendException error = assertThrows(BackendException.class, () -> service.run("trace-failure"));

        assertEquals("NEO4J_GRAPH_SYNC_FAILED", error.code());
        assertEquals("failed", jdbc.queryForObject("""
                select status from platform.graph_sync_runs where mode='full-bootstrap'
                """, String.class));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from platform.graph_sync_runs
                where cursor_snapshot ? 'parentRunId' and status='completed'
                """, Integer.class));
        assertEquals(0, jdbc.queryForObject("select count(*) from platform.graph_sync_cursors", Integer.class));
        assertEquals(1L, driver.executableQuery("match (n:GraphNode) return count(n) as count")
                .execute().records().getFirst().get("count").asLong());
    }

    @Test
    void deletedOrganizationTombstonePurgesStaleNeo4jScopeBeforeCursorAdvances() {
        Instant at = Instant.parse("2026-08-22T00:00:00Z");
        jdbc.update("""
                insert into erp_staging.dw_datacenter_system_organization
                  (source_id,organization_name,is_deleted,create_time,update_time)
                values (2501,'deleted-org',1,?,?)
                """, Timestamp.from(at), Timestamp.from(at));
        driver.executableQuery("""
                create (:GraphNode {scope_org_id:'2501',kind:'organization',id:'2501',
                                    label:'stale',last_seen_run_id:'legacy'})
                """).execute();

        GraphSyncRun parent = context.getBean(GraphSyncBootstrapService.class).run("trace-delete");

        assertEquals("completed", parent.status());
        assertEquals(0L, driver.executableQuery("""
                match (n:GraphNode {scope_org_id:'2501'}) return count(n) as count
                """).execute().records().getFirst().get("count").asLong());
        assertEquals(parent.id(), jdbc.queryForObject("""
                select last_run_id from platform.graph_sync_cursors where source_name='erp.organizations'
                """, String.class));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from platform.graph_sync_runs
                where cursor_snapshot->>'parentRunId'=? and status='completed'
                """, Integer.class, parent.id()));
    }

    @Test
    void globalClaimRejectsConcurrentDuplicateBootstrapAndTheWinnerOwnsAllSevenCursors() throws Exception {
        seedOrganizations(Instant.parse("2026-08-22T00:00:00Z"), 3001);
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        GraphWriter real = context.getBean(GraphWriter.class);
        GraphWriter blocking = (organizationId, runId, token, batch) -> {
            writing.countDown();
            try {
                if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("timeout");
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(error);
            }
            return real.replaceOrganization(organizationId, runId, token, batch);
        };
        GraphSyncBootstrapService firstService = service(blocking);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> firstService.run("trace-first"));
            assertTrue(writing.await(10, TimeUnit.SECONDS));

            BackendException conflict = assertThrows(BackendException.class,
                    () -> context.getBean(GraphSyncBootstrapService.class).run("trace-second"));
            assertEquals("GRAPH_SYNC_BOOTSTRAP_CONFLICT", conflict.code());
            release.countDown();
            assertEquals("completed", first.get(10, TimeUnit.SECONDS).status());
        }
        assertEquals(7, jdbc.queryForObject("select count(*) from platform.graph_sync_cursors", Integer.class));
        assertEquals(1, jdbc.queryForObject("""
                select count(*) from platform.graph_sync_runs where mode='full-bootstrap'
                """, Integer.class));
    }

    @Test
    void exhaustedDirtyScopeAbsorbsNewChangesAndBlocksPendingDuplicateFromDispatch() {
        Instant at = Instant.parse("2026-08-22T00:00:00Z");
        jdbc.update("""
                insert into platform.graph_sync_dirty_scopes
                  (id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count,last_run_id,error_summary)
                values ('exhausted','organization','org-cap','payments-changed','erp.payments','old',
                        '{"erp.payments":{"cursorPk":"old"}}'::jsonb,?,?,'failed',3,'source-run','failed'),
                       ('bypass','organization','org-cap','payments-changed','erp.payments','newer',
                        '{"erp.payments":{"cursorPk":"newer"}}'::jsonb,?,?,'pending',0,null,null)
                """, Timestamp.from(at), Timestamp.from(at), Timestamp.from(at), Timestamp.from(at));
        GraphSyncIncrementalRepository repository = context.getBean(GraphSyncIncrementalRepository.class);

        repository.record(GraphSyncSource.PAYMENTS,
                new GraphSyncChange("latest", "org-cap", at.plusSeconds(1)));

        assertEquals(2, jdbc.queryForObject("""
                select count(*) from platform.graph_sync_dirty_scopes where scope_key='org-cap'
                """, Integer.class));
        assertEquals(3, jdbc.queryForObject("""
                select attempt_count from platform.graph_sync_dirty_scopes where id='exhausted'
                """, Integer.class));
        assertTrue(repository.pending("erp.payments").isEmpty());
        assertFalse(repository.requeueRetryable("erp.payments", 3) > 0);
    }

    private GraphSyncBootstrapService service(GraphWriter writer) {
        GraphSyncRunRepository runs = context.getBean(GraphSyncRunRepository.class);
        GraphSyncService rebuilds = new GraphSyncService(runs, context.getBean(GraphBatchBuilder.class), writer,
                context.getBean(GraphSyncLease.class));
        return new GraphSyncBootstrapService(runs, context.getBean(GraphSyncBootstrapRepository.class), rebuilds,
                context.getBean(GraphSyncLease.class));
    }

    private void seedOrganizations(Instant at, long... ids) {
        for (long id : ids) {
            jdbc.update("""
                    insert into erp_staging.dw_datacenter_system_organization
                      (source_id,organization_name,is_deleted,create_time,update_time)
                    values (?,?,0,?,?)
                    """, id, "org-" + id, Timestamp.from(at), Timestamp.from(at));
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class TestConfig {
        @Bean DataSource dataSource() {
            return new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        }
        @Bean PlatformTransactionManager transactionManager(DataSource dataSource) {
            return new JdbcTransactionManager(dataSource);
        }
        @Bean SqlSessionFactory sqlSessionFactory(DataSource dataSource) throws Exception {
            SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            SqlSessionFactory sessionFactory = factory.getObject();
            sessionFactory.getConfiguration().addMapper(GraphSyncRunMapper.class);
            sessionFactory.getConfiguration().addMapper(GraphSyncIncrementalMapper.class);
            sessionFactory.getConfiguration().addMapper(GraphSyncBootstrapMapper.class);
            sessionFactory.getConfiguration().addMapper(GraphSyncSourceMapper.class);
            return sessionFactory;
        }
        @Bean SqlSessionTemplate sqlSessionTemplate(SqlSessionFactory factory) {
            return new SqlSessionTemplate(factory);
        }
        @Bean GraphSyncRunMapper runMapper(SqlSessionTemplate template) {
            return template.getMapper(GraphSyncRunMapper.class);
        }
        @Bean GraphSyncIncrementalMapper incrementalMapper(SqlSessionTemplate template) {
            return template.getMapper(GraphSyncIncrementalMapper.class);
        }
        @Bean GraphSyncBootstrapMapper bootstrapMapper(SqlSessionTemplate template) {
            return template.getMapper(GraphSyncBootstrapMapper.class);
        }
        @Bean GraphSyncSourceMapper sourceMapper(SqlSessionTemplate template) {
            return template.getMapper(GraphSyncSourceMapper.class);
        }
        @Bean GraphSyncRunRepository runs(GraphSyncRunMapper mapper) { return new GraphSyncRunRepository(mapper); }
        @Bean GraphSyncIncrementalRepository incremental(GraphSyncIncrementalMapper mapper) {
            return new GraphSyncIncrementalRepository(mapper);
        }
        @Bean GraphSyncBootstrapRepository bootstrap(GraphSyncBootstrapMapper bootstrap,
                                                     GraphSyncIncrementalMapper incremental,
                                                     GraphSyncRunMapper runs) {
            return new GraphSyncBootstrapRepository(bootstrap, incremental, runs);
        }
        @Bean Driver neo4jDriver() { return GraphDatabase.driver(NEO4J.getBoltUrl()); }
        @Bean GraphWriter graphWriter(Driver driver) { return new Neo4jGraphWriter(driver, "neo4j"); }
        @Bean GraphBatchBuilder batches(GraphSyncSourceMapper source) { return new GraphBatchBuilder(source); }
        @Bean(destroyMethod = "shutdown") ThreadPoolTaskScheduler scheduler() {
            ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
            scheduler.setPoolSize(2);
            scheduler.initialize();
            return scheduler;
        }
        @Bean GraphSyncLease leases(ThreadPoolTaskScheduler scheduler, GraphSyncRunRepository runs) {
            return new GraphSyncLease(scheduler, runs);
        }
        @Bean GraphSyncService rebuilds(GraphSyncRunRepository runs, GraphBatchBuilder batches,
                                        GraphWriter graph, GraphSyncLease leases) {
            return new GraphSyncService(runs, batches, graph, leases);
        }
        @Bean GraphSyncBootstrapService bootstrapService(GraphSyncRunRepository runs,
                                                         GraphSyncBootstrapRepository bootstrap,
                                                         GraphSyncService rebuilds, GraphSyncLease leases) {
            return new GraphSyncBootstrapService(runs, bootstrap, rebuilds, leases);
        }
        @Bean JdbcTemplate jdbcTemplate(DataSource dataSource) { return new JdbcTemplate(dataSource); }
    }
}
