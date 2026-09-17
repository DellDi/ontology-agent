package com.dip3.ontologyagent.analysis;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
class AnalysisSessionDeletionTest {
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

    @Autowired AnalysisSessionDeletionService service;
    @Autowired JdbcTemplate jdbc;

    private String suffix;
    private AuthSession owner;
    private String sessionId;

    @BeforeEach
    void setUp() {
        suffix = UUID.randomUUID().toString();
        owner = new AuthSession("auth-" + suffix, "user-" + suffix, "测试用户",
                new AccessScope("org-" + suffix, List.of("project-" + suffix), List.of(), List.of("analyst")),
                Instant.MAX);
        // 会话主键即 UUID（chat_memory.conversation_id 为 varchar(36)）。
        sessionId = UUID.randomUUID().toString();
        insertSession();
    }

    @Test
    void deleteRemovesTheSessionAndAllOwnedArtifacts() {
        String executionId = "exec-" + suffix;
        String followUpId = "fu-" + suffix;
        insertJob(executionId, "completed");
        insertSnapshot(executionId, "completed");
        insertFollowUp(followUpId, executionId);
        insertEvent(executionId);
        insertProjection(executionId, followUpId);
        insertInvocation(executionId);
        insertChatMemory();
        insertAuditEvent();

        service.delete(sessionId, owner);

        assertAllZero("platform.jobs", "platform.analysis_execution_events",
                "platform.analysis_ui_message_projections", "platform.agent_invocations",
                "platform.analysis_execution_snapshots", "platform.analysis_session_follow_ups");
        assertEquals(0, count("platform.analysis_sessions", "id", sessionId));
        assertEquals(0, count("spring_ai_chat_memory", "conversation_id", sessionId));
        assertEquals(0, count("platform.job_events", "job_id", executionId));
        assertEquals(0, count("platform.job_dispatch_outbox", "job_id", executionId));
        // 平台审计日志有独立保留期，不随会话删除。
        assertEquals(1, count("platform.audit_events", "session_id", sessionId));
    }

    @Test
    void deleteRejectsOtherUsersSession() {
        AuthSession stranger = new AuthSession("auth-x-" + suffix, "user-x-" + suffix, "他人",
                new AccessScope("org-" + suffix, List.of("project-" + suffix), List.of(), List.of("analyst")),
                Instant.MAX);
        BackendException error = assertThrows(BackendException.class,
                () -> service.delete(sessionId, stranger));
        assertEquals("SESSION_NOT_FOUND", error.code());
        assertEquals(1, count("platform.analysis_sessions", "id", sessionId));
    }

    @Test
    void deleteRejectsSessionWithActiveExecution() {
        insertJob("exec-active-" + suffix, "processing");
        insertSnapshot("exec-active-" + suffix, "processing");
        BackendException error = assertThrows(BackendException.class,
                () -> service.delete(sessionId, owner));
        assertEquals("ANALYSIS_SESSION_ACTIVE", error.code());
        assertEquals(1, count("platform.analysis_sessions", "id", sessionId));
        assertEquals(1, count("platform.jobs", "session_id", sessionId));
    }

    @Test
    void deleteAllowsTerminalExecutions() {
        insertJob("exec-done-" + suffix, "failed");
        insertJob("exec-dead-" + suffix, "dead_letter");
        insertSnapshot("exec-done-" + suffix, "failed");
        service.delete(sessionId, owner);
        assertEquals(0, count("platform.analysis_sessions", "id", sessionId));
        assertEquals(0, count("platform.jobs", "session_id", sessionId));
    }

    private void assertAllZero(String... tables) {
        for (String table : tables) {
            assertEquals(0, count(table, "session_id", sessionId), table + " 仍有残留");
        }
    }

    private long count(String table, String column, String value) {
        return jdbc.queryForObject("select count(*) from " + table + " where " + column + "=?",
                Long.class, value);
    }

    private void insertSession() {
        jdbc.update("""
                insert into platform.analysis_sessions
                (id,owner_user_id,organization_id,project_ids,area_ids,question_text,saved_context,status,created_at,updated_at)
                values (?,?,?,?,?,?,'{}'::jsonb,'pending',?,?)
                """, sessionId, owner.userId(), owner.scope().organizationId(),
                new String[]{"project-" + suffix}, new String[]{},
                "分析收缴率", Timestamp.from(Instant.now()), Timestamp.from(Instant.now()));
    }

    private void insertJob(String executionId, String status) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,available_at,owner_user_id,organization_id,session_id,created_at,updated_at)
                values (?,'analysis-execution',?,?::jsonb,?,?,?,?,?,?)
                """, executionId, status,
                "{\"sessionId\":\"" + sessionId + "\",\"executionContract\":\"java-initial-v1\"}",
                now, owner.userId(), owner.scope().organizationId(), sessionId, now, now);
        jdbc.update("insert into platform.job_events (id,job_id,event_type,created_at) values (?,?,?,?)",
                "je-" + executionId, executionId, "created", now);
        jdbc.update("insert into platform.job_dispatch_outbox (id,job_id,status,created_at,updated_at) values (?,?,?,?,?)",
                "ob-" + executionId, executionId, "published", now, now);
    }

    private void insertSnapshot(String executionId, String status) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                insert into platform.analysis_execution_snapshots
                (execution_id,session_id,owner_user_id,status,plan_snapshot,capability_binding,created_at,updated_at)
                values (?,?,?,?,'{"_executionContract":"java-initial-v1"}'::jsonb,'{}'::jsonb,?,?)
                """, executionId, sessionId, owner.userId(), status, now, now);
    }

    private void insertFollowUp(String followUpId, String executionId) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                insert into platform.analysis_session_follow_ups
                (id,session_id,owner_user_id,question_text,referenced_execution_id,result_execution_id,
                 inherited_context,merged_context,capability_binding,created_at,updated_at)
                values (?,?,?,?,?,?,'{}'::jsonb,'{}'::jsonb,'{}'::jsonb,?,?)
                """, followUpId, sessionId, owner.userId(), "追问", executionId, executionId, now, now);
    }

    private void insertEvent(String executionId) {
        jdbc.update("""
                insert into platform.analysis_execution_events
                (id,session_id,execution_id,owner_user_id,sequence,kind,event_timestamp,trace_id,created_at)
                values (?,?,?,?,1,'execution-status',?,?,?)
                """, "ev-" + suffix, sessionId, executionId, owner.userId(),
                Timestamp.from(Instant.now()), "trace-" + suffix, Timestamp.from(Instant.now()));
    }

    private void insertProjection(String executionId, String followUpId) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                insert into platform.analysis_ui_message_projections
                (id,session_id,owner_user_id,execution_id,follow_up_id,projection_version,
                 part_schema_version,contract_version,status,is_terminal,created_at,updated_at)
                values (?,?,?,?,?,1,1,1,'completed',true,?,?)
                """, "proj-" + suffix, sessionId, owner.userId(), executionId, followUpId, now, now);
    }

    private void insertInvocation(String executionId) {
        Timestamp now = Timestamp.from(Instant.now());
        jdbc.update("""
                insert into platform.agent_invocations
                (id,session_id,execution_id,owner_user_id,agent_name,tool_name,kind,status,trace_id,started_at,created_at,updated_at)
                values (?,?,?,?,?,?,?,?,?,?,?,?)
                """, "inv-" + suffix, sessionId, executionId, owner.userId(), "agent", "tool", "tool-call",
                "completed", "trace-" + suffix, now, now, now);
    }

    private void insertChatMemory() {
        jdbc.update("insert into spring_ai_chat_memory (conversation_id,content,type,\"timestamp\",sequence_id) values (?,?,?,?,?)",
                sessionId, "{}", "USER", Timestamp.from(Instant.now()), 1L);
    }

    private void insertAuditEvent() {
        jdbc.update("""
                insert into platform.audit_events
                (id,user_id,organization_id,session_id,event_type,event_result,event_source,correlation_id,payload,retention_until)
                values (?,?,?,?,?,?,?,?,'{}'::jsonb,?)
                """, "ae-" + suffix, owner.userId(), owner.scope().organizationId(), sessionId,
                "analysis.session.create", "success", "test", "trace-" + suffix,
                Timestamp.from(Instant.now().plusSeconds(86400)));
    }
}
