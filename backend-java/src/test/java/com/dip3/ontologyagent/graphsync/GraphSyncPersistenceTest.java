package com.dip3.ontologyagent.graphsync;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.apache.ibatis.session.SqlSessionFactory;
import org.mybatis.spring.SqlSessionFactoryBean;
import org.mybatis.spring.SqlSessionTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
class GraphSyncPersistenceTest {
    @Container
    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

    @BeforeAll
    static void migrate() throws Exception {
        Path migrations = Path.of(System.getProperty("user.dir")).resolveSibling("drizzle");
        try (var connection = DriverManager.getConnection(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(),
                POSTGRES.getPassword())) {
            ScriptUtils.executeSqlScript(connection, new FileSystemResource(migrations.resolve("0000_initial.sql")));
        }
    }

    @Test
    void advisoryLockSerializesSameOrganizationAndDifferentOrganizationsProceed() throws Exception {
        DriverManagerDataSource dataSource = dataSource();
        PlatformTransactionManager manager = new org.springframework.jdbc.support.JdbcTransactionManager(dataSource);
        TransactionTemplate transactions = new TransactionTemplate(manager);
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> transactions.execute(status -> {
                boolean acquired = new org.springframework.jdbc.core.JdbcTemplate(dataSource).queryForObject(
                        "select pg_try_advisory_xact_lock(hashtextextended(?,0))", Boolean.class, "org-lock");
                locked.countDown();
                try { release.await(5, TimeUnit.SECONDS); } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                }
                return acquired;
            }));
            assertTrue(locked.await(5, TimeUnit.SECONDS));
            boolean same = transactions.execute(status -> new org.springframework.jdbc.core.JdbcTemplate(dataSource)
                    .queryForObject("select pg_try_advisory_xact_lock(hashtextextended(?,0))", Boolean.class,
                            "org-lock"));
            boolean other = transactions.execute(status -> new org.springframework.jdbc.core.JdbcTemplate(dataSource)
                    .queryForObject("select pg_try_advisory_xact_lock(hashtextextended(?,0))", Boolean.class,
                            "org-other"));
            assertFalse(same);
            assertTrue(other);
            release.countDown();
            assertTrue(first.get(5, TimeUnit.SECONDS));
        }
    }

    @Test
    void persistedRunFollowsPendingRunningCompletedAndFailedLifecycle() {
        DriverManagerDataSource dataSource = dataSource();
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        GraphSyncRunMapper mapper = mapper(dataSource);
        String runId = UUID.randomUUID().toString();
        Instant now = Instant.now();
        GraphSyncRun pending = new GraphSyncRun(runId, "org-rebuild", "pending", "organization", "org-life",
                "manual", "admin", Map.of(), 0, 0, null, null, null, null, now, now);
        assertEquals(1, mapper.insert(pending));
        assertEquals(1, mapper.transition(runId, "pending", "running", 0, 0, null, null,
                now, null, now));
        assertEquals(1, mapper.transition(runId, "running", "completed", 3, 2, null,
                Map.of("nodesDeleted", 0, "edgesDeleted", 0), null, now, now));
        Map<String, Object> completed = jdbc.queryForMap("select * from platform.graph_sync_runs where id=?", runId);
        assertEquals("completed", completed.get("status"));
        assertEquals(3, completed.get("nodes_written"));
        assertNotNull(completed.get("finished_at"));

        String failedId = UUID.randomUUID().toString();
        GraphSyncRun running = new GraphSyncRun(failedId, "org-rebuild", "running", "organization", "org-failed",
                "manual", "admin", Map.of(), 0, 0, null, null, now, null, now, now);
        assertEquals(1, mapper.insert(running));
        assertEquals(1, mapper.fail(failedId, "partial", "neo4j failed",
                Map.of("partialWrite", true), now));
        assertEquals("partial", jdbc.queryForObject("select status from platform.graph_sync_runs where id=?",
                String.class, failedId));
    }

    @Test
    void scanIncludesDeletedProjectAndExposesMissingTimestampForFailLoudHandling() {
        DriverManagerDataSource dataSource = dataSource();
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        jdbc.update("""
                insert into erp_staging.dw_datacenter_precinct
                  (precinct_id,precinct_name,org_id,is_delete,delete_flag,update_date)
                values ('deleted-project','已删除项目','org-delete',1,1,?),
                       ('missing-time','无时间项目','org-missing',0,0,null)
                """, java.sql.Timestamp.from(Instant.parse("2026-08-14T00:00:00Z")));
        GraphSyncSourceMapper source = mapper(dataSource, GraphSyncSourceMapper.class);

        var changes = source.scanProjects(null, null, 10);

        assertEquals("missing-time", changes.getFirst().sourcePk());
        assertEquals(null, changes.getFirst().cursorTime());
        assertEquals("deleted-project", changes.get(1).sourcePk());
        assertEquals("org-delete", changes.get(1).organizationId());
    }

    @Test
    void staleRunIsRecoveredBeforeSourceCanBeClaimedAgain() {
        DriverManagerDataSource dataSource = dataSource();
        GraphSyncRunMapper mapper = mapper(dataSource);
        Instant stale = Instant.now().minusSeconds(3600);
        GraphSyncRun stuck = new GraphSyncRun(UUID.randomUUID().toString(), "incremental-scan", "running",
                "all", "erp.projects", "scheduler", "system", Map.of(), 0, 0, null, null,
                stale, null, stale, stale);
        assertEquals(1, mapper.insert(stuck));

        assertEquals(1, mapper.recoverStale("all", "erp.projects", Instant.now().minusSeconds(1800), Instant.now()));

        assertEquals("failed", new org.springframework.jdbc.core.JdbcTemplate(dataSource).queryForObject(
                "select status from platform.graph_sync_runs where id=?", String.class, stuck.id()));
    }

    @Test
    void dirtyScopeStaleRecoveryUsesClaimTimeAndSourceRunLease() {
        DriverManagerDataSource dataSource = dataSource();
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        GraphSyncRunMapper runMapper = mapper(dataSource);
        GraphSyncIncrementalMapper dirtyMapper = mapper(dataSource, GraphSyncIncrementalMapper.class);
        Instant now = Instant.now();
        String sourceRunId = UUID.randomUUID().toString();
        String dirtyId = UUID.randomUUID().toString();
        assertEquals(1, runMapper.insert(new GraphSyncRun(sourceRunId, "incremental-scan", "running",
                "all", "erp.projects", "scheduler", "system", Map.of(), 0, 0, null, null,
                now, null, now, now)));
        jdbc.update("""
                insert into platform.graph_sync_dirty_scopes
                  (id,scope_type,scope_key,reason,source_name,source_pk,source_progress,
                   first_detected_at,last_detected_at,status,attempt_count)
                values (?, 'organization', 'org-dirty-lease', 'project-changed', 'erp.projects', 'project-1',
                        '{"erp.projects":{"cursorPk":"project-1"}}'::jsonb, ?, ?, 'pending', 0)
                """, dirtyId, java.sql.Timestamp.from(now.minusSeconds(7200)),
                java.sql.Timestamp.from(now.minusSeconds(7200)));

        assertEquals(1, dirtyMapper.claim(dirtyId, sourceRunId, now));
        assertEquals(sourceRunId, jdbc.queryForObject(
                "select last_run_id from platform.graph_sync_dirty_scopes where id=?", String.class, dirtyId));
        assertEquals(0, dirtyMapper.recoverProcessing("erp.projects", now.minusSeconds(1800)));

        jdbc.update("update platform.graph_sync_dirty_scopes set last_detected_at=? where id=?",
                java.sql.Timestamp.from(now.minusSeconds(3600)), dirtyId);
        assertEquals(0, dirtyMapper.recoverProcessing("erp.projects", now.minusSeconds(1800)));
        jdbc.update("update platform.graph_sync_runs set status='failed' where id=?", sourceRunId);
        assertEquals(1, dirtyMapper.recoverProcessing("erp.projects", now.minusSeconds(1800)));
        assertEquals("failed", jdbc.queryForObject(
                "select status from platform.graph_sync_dirty_scopes where id=?", String.class, dirtyId));
    }

    @Test
    void sweepOrganizationDiscoveryReturnsOnlyActiveOrganizations() {
        DriverManagerDataSource dataSource = dataSource();
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        jdbc.update("insert into erp_staging.dw_datacenter_system_organization(source_id,organization_name,is_deleted) values (9001,'active',0),(9002,'deleted',1)");
        GraphSyncIncrementalMapper mapper = mapper(dataSource, GraphSyncIncrementalMapper.class);

        assertEquals(List.of("9001"), mapper.organizationIds(10));
    }

    private static DriverManagerDataSource dataSource() {
        return new DriverManagerDataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static GraphSyncRunMapper mapper(DriverManagerDataSource dataSource) {
        return mapper(dataSource, GraphSyncRunMapper.class);
    }

    private static <T> T mapper(DriverManagerDataSource dataSource, Class<T> type) {
        try {
            SqlSessionFactoryBean factory = new SqlSessionFactoryBean();
            factory.setDataSource(dataSource);
            SqlSessionFactory sessionFactory = factory.getObject();
            sessionFactory.getConfiguration().addMapper(type);
            return new SqlSessionTemplate(sessionFactory).getMapper(type);
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }
}
