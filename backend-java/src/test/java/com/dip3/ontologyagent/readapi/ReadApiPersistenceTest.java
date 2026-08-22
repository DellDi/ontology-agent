package com.dip3.ontologyagent.readapi;

import com.dip3.ontologyagent.analysis.AnalysisSessionReadService;
import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.integration.erp.ScopedProjectResolver;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import com.dip3.ontologyagent.workspace.WorkspaceHomeService;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
class ReadApiPersistenceTest {
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
    static void migrate() {
        MigrationTestSupport.migrate(POSTGRES);
    }

    @Autowired AnalysisSessionRepository sessions;
    @Autowired WorkspaceHomeService homes;
    @Autowired AnalysisSessionReadService sessionReads;
    @Autowired ScopedProjectResolver scopedProjects;
    @Autowired OntologyRepository ontologies;
    @Autowired JdbcTemplate jdbc;

    @Test
    void readModelsEnforceOwnerAndScopeAndUsePostgresExecutionFacts() {
        String suffix = UUID.randomUUID().toString();
        String userId = "user-" + suffix;
        String organizationId = "org-" + suffix;
        String projectId = "project-" + suffix;
        String areaId = "area-" + suffix;
        AuthSession viewer = viewer(userId, organizationId, List.of(projectId), List.of(areaId));

        var visible = sessions.create(viewer, "分析项目收缴率", Map.of("state", "missing"));
        sessions.create(viewer(userId, organizationId, List.of("forbidden-project-" + suffix), List.of(areaId)),
                "不可见项目", Map.of());
        sessions.create(viewer(userId, "other-org-" + suffix, List.of(projectId), List.of(areaId)),
                "不可见组织", Map.of());
        sessions.create(viewer("other-user-" + suffix, organizationId, List.of(projectId), List.of(areaId)),
                "不可见用户", Map.of());
        insertProject(projectId, organizationId, areaId, "授权项目");
        insertProject("other-project-" + suffix, organizationId, areaId, "未授权项目");

        Instant older = Instant.now().minusSeconds(30);
        Instant newer = Instant.now().minusSeconds(10);
        String completedExecution = "completed-" + suffix;
        String queuedExecution = "queued-" + suffix;
        insertJob(completedExecution, visible.id(), userId, organizationId, "completed", older, "trace-old");
        insertSnapshot(completedExecution, visible.id(), userId, "completed", older, "trace-old");
        insertEvent("event-old-" + suffix, visible.id(), completedExecution, userId, 1, "completed", older,
                "trace-old");
        insertJob(queuedExecution, visible.id(), userId, organizationId, "queued", newer, "trace-new");
        insertEvent("event-new-2-" + suffix, visible.id(), queuedExecution, userId, 2, "processing", newer,
                "trace-new");
        insertEvent("event-new-1-" + suffix, visible.id(), queuedExecution, userId, 1, "queued",
                newer.minusSeconds(1), "trace-new");

        var home = homes.load(viewer);
        assertEquals(List.of(visible.id()), home.sessions().stream().map(item -> item.id()).toList());
        assertEquals(queuedExecution, home.sessions().getFirst().latestExecution().executionId());
        assertEquals("queued", home.sessions().getFirst().latestExecution().status());
        assertEquals(List.of("other-project-" + suffix, projectId),
                home.projects().stream().map(item -> item.id()).sorted().toList());
        var areaOnlyHome = homes.load(viewer(userId, organizationId, List.of(), List.of(areaId)));
        assertEquals(List.of("other-project-" + suffix, projectId),
                areaOnlyHome.projects().stream().map(item -> item.id()).sorted().toList());
        assertEquals(List.of("other-project-" + suffix, projectId),
                scopedProjects.resolve(viewer(userId, organizationId, List.of(), List.of(areaId)))
                        .stream().sorted().toList());

        var latest = sessionReads.load(visible.id(), null, viewer);
        assertEquals(queuedExecution, latest.runtime().resolvedExecutionId());
        assertFalse(latest.runtime().autoExecute());
        assertTrue(latest.runtime().streamEnabled());
        assertEquals(List.of(1L, 2L), latest.events().stream().map(item -> item.sequence()).toList());
        assertEquals(2, latest.runtime().resumeAfterSequence());
        assertNull(latest.snapshot());

        var requested = sessionReads.load(visible.id(), completedExecution, viewer);
        assertEquals(completedExecution, requested.job().executionId());
        assertEquals("completed", requested.snapshot().status());
        assertFalse(requested.runtime().streamEnabled());
        assertTrue(requested.runtime().terminal());
        assertEquals(1, requested.runtime().resumeAfterSequence());

        BackendException wrongExecution = assertThrows(BackendException.class,
                () -> sessionReads.load(visible.id(), "missing-" + suffix, viewer));
        assertEquals("EXECUTION_NOT_FOUND", wrongExecution.code());
        BackendException wrongScope = assertThrows(BackendException.class,
                () -> sessionReads.load(visible.id(), null,
                        viewer(userId, organizationId, List.of("different-project"), List.of(areaId))));
        assertEquals("SESSION_NOT_FOUND", wrongScope.code());
    }

    @Test
    void sessionWithoutExecutionExposesOnlyAutoExecuteFacts() {
        String suffix = UUID.randomUUID().toString();
        AuthSession viewer = viewer("user-empty-" + suffix, "org-empty-" + suffix,
                List.of("project-empty-" + suffix), List.of());
        var session = sessions.create(viewer, "分析空会话",
                Map.of("_executionContract", ExecutionRepository.EXECUTION_CONTRACT));

        var aggregate = sessionReads.load(session.id(), null, viewer);

        assertNull(aggregate.job());
        assertNull(aggregate.snapshot());
        assertTrue(aggregate.events().isEmpty());
        assertNull(aggregate.runtime().resolvedExecutionId());
        assertTrue(aggregate.runtime().autoExecute());
        assertFalse(aggregate.runtime().streamEnabled());
        assertEquals(0, aggregate.runtime().resumeAfterSequence());
    }

    @Test
    void legacySessionWithoutJavaContractIsNeverAutoExecuted() {
        String suffix = UUID.randomUUID().toString();
        AuthSession viewer = viewer("legacy-user-" + suffix, "legacy-org-" + suffix,
                List.of("legacy-project-" + suffix), List.of());
        var session = sessions.create(viewer, "旧后端会话", Map.of("legacy", true));

        var aggregate = sessionReads.load(session.id(), null, viewer);

        assertNull(aggregate.job());
        assertNull(aggregate.snapshot());
        assertFalse(aggregate.runtime().autoExecute());
        assertFalse(aggregate.runtime().streamEnabled());
    }

    @Test
    void currentRuntimeOntologyNeverSelectsADeprecatedVersion() {
        String suffix = UUID.randomUUID().toString();
        Instant now = Instant.now();
        insertOntologyVersion("approved-" + suffix, "approved", now);
        insertOntologyVersion("deprecated-" + suffix, "deprecated", now.plusSeconds(30));

        assertEquals("approved-" + suffix, ontologies.currentPublished().versionId());
    }

    private AuthSession viewer(String userId, String organizationId, List<String> projectIds, List<String> areaIds) {
        return new AuthSession("auth-" + userId, userId, "测试用户",
                new AccessScope(organizationId, projectIds, areaIds, List.of("analyst")),
                Instant.now().plusSeconds(3600));
    }

    private void insertProject(String projectId, String organizationId, String areaId, String name) {
        jdbc.update("""
                insert into erp_staging.dw_datacenter_precinct
                (org_id,area_id,precinct_id,precinct_name,is_delete,delete_flag)
                values (?,?,?,?,0,0)
                """, organizationId, areaId, projectId, name);
    }

    private void insertJob(String executionId, String sessionId, String ownerUserId, String organizationId,
                           String status, Instant createdAt, String traceId) {
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,attempt_count,max_attempts,available_at,dispatch_status,
                 owner_user_id,organization_id,session_id,origin_correlation_id,created_at,updated_at)
                values (?,'analysis-execution',?,cast(? as jsonb),0,2,?,'published',?,?,?,?,?,?)
                """, executionId, status, "{\"executionContract\":\"java-initial-v1\"}", Timestamp.from(createdAt), ownerUserId, organizationId, sessionId,
                traceId, Timestamp.from(createdAt), Timestamp.from(createdAt));
    }

    private void insertEvent(String eventId, String sessionId, String executionId, String ownerUserId,
                             long sequence, String status, Instant timestamp, String traceId) {
        jdbc.update("""
                insert into platform.analysis_execution_events
                (id,session_id,execution_id,owner_user_id,sequence,kind,event_timestamp,status,message,
                 render_blocks,metadata,trace_id,created_at)
                values (?,?,?,?,?,'execution-status',?,?,?,cast(? as jsonb),cast(? as jsonb),?,?)
                """, eventId, sessionId, executionId, ownerUserId, sequence, Timestamp.from(timestamp), status,
                status, "[]", "{}", traceId, Timestamp.from(timestamp));
    }

    private void insertSnapshot(String executionId, String sessionId, String ownerUserId, String status,
                                Instant timestamp, String traceId) {
        jdbc.update("""
                insert into platform.analysis_execution_snapshots
                (execution_id,session_id,owner_user_id,ontology_version_binding_source,status,plan_snapshot,
                 step_results,conclusion_state,result_blocks,mobile_projection,trace_id,created_at,updated_at)
                values (?,?,?,'grounded-context',?,cast(? as jsonb),cast(? as jsonb),cast(? as jsonb),
                        cast(? as jsonb),cast(? as jsonb),?,?,?)
                """, executionId, sessionId, ownerUserId, status,
                "{\"_executionContract\":\"java-initial-v1\"}", "[]", "{\"causes\":[]}", "[]",
                "{}", traceId, Timestamp.from(timestamp), Timestamp.from(timestamp));
    }

    private void insertOntologyVersion(String id, String status, Instant publishedAt) {
        jdbc.update("""
                insert into platform.ontology_versions
                (id,semver,display_name,status,published_at,created_by,created_at,updated_at)
                values (?,?,'Test',?,?, 'test',?,?)
                """, id, id, status, Timestamp.from(publishedAt), Timestamp.from(publishedAt),
                Timestamp.from(publishedAt));
    }
}
