package com.dip3.ontologyagent.execution;

import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.integration.erp.ErpEvidenceMapper;
import org.springframework.ai.chat.memory.ChatMemory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.UserMessage;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
class MybatisPersistenceTest {
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
        registry.add("spring.ai.chat.memory.repository.jdbc.initialize-schema", () -> "never");
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
    @Autowired ExecutionRepository executions;
    @Autowired AgentInvocationRepository invocations;
    @Autowired InvocationEventRecorder invocationEvents;
    @Autowired AnalysisService analyses;
    @Autowired JdbcTemplate jdbc;
    @Autowired ErpEvidenceMapper erpEvidence;
    @Autowired ChatMemory chatMemory;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void mybatisMappingsPreserveScopeIdempotencyLeaseEventsSnapshotAndAudit() {
        String userId = "user-" + UUID.randomUUID();
        AuthSession owner = new AuthSession("auth-1", userId, "测试用户",
                new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        var session = sessions.create(owner, "分析项目收缴率", Map.of("state", "missing"));
        var loaded = sessions.findOwned(session.id(), owner).orElseThrow();
        assertEquals(List.of("project-1"), loaded.scope().projectIds());
        assertEquals("missing", loaded.savedContext().get("state"));

        ExecutionSubmission submission = executions.submit(loaded, "same-request", "trace-1", "ontology-1");
        String executionId = submission.executionId();
        assertTrue(submission.created());
        ExecutionSubmission replay = executions.submit(loaded, "same-request", "trace-2", "ontology-2");
        assertEquals(executionId, replay.executionId());
        assertFalse(replay.created());
        ExecutionJob job = executions.claim("worker-1", Duration.ofMinutes(1)).orElseThrow();
        assertEquals(executionId, job.executionId());
        assertEquals(List.of("project-1"), job.projectIds());
        assertEquals(1, job.attemptCount());
        assertEquals(2, job.maxAttempts());
        assertEquals("ontology-1", job.ontologyVersionId());
        assertEquals("worker-1", job.workerId());
        assertTrue(executions.claim("worker-2", Duration.ofMinutes(1)).isEmpty());
        BackendException wrongLeaseOwner = assertThrows(BackendException.class,
                () -> executions.renewLease(executionId, "worker-2", Duration.ofMinutes(1)));
        assertEquals("JOB_LEASE_LOST", wrongLeaseOwner.code());
        executions.renewLease(executionId, "worker-1", Duration.ofMinutes(1));

        ExecutionEvent first = executions.append(userId, event(session.id(), executionId, "processing", "trace-1"));
        assertEquals(1, first.sequence());

        String invocation = invocations.start(session.id(), executionId, userId, "main-agent",
                "analysis_workflow", "workflow-tool", null, Map.of("metric", "collection-rate"), "trace-1");
        invocations.succeed(invocation, Map.of("evidenceCount", 3));
        assertEquals(1, invocations.count(executionId, "workflow-tool", "analysis_workflow"));
        invocations.startAgentRun(session.id(), executionId, userId, Map.of("attemptCount", 1), "trace-1");
        BackendException duplicateAgentRun = assertThrows(BackendException.class,
                () -> invocations.startAgentRun(session.id(), executionId, userId,
                        Map.of("attemptCount", 2), "trace-1"));
        assertEquals("AGENT_RUN_ALREADY_STARTED", duplicateAgentRun.code());

        AuthSession wrongScope = new AuthSession("auth-2", userId, "测试用户",
                new AccessScope("org-2", List.of("project-1"), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        BackendException denied = assertThrows(BackendException.class,
                () -> analyses.events(session.id(), executionId, wrongScope, 0));
        assertEquals("SESSION_NOT_FOUND", denied.code());

        Instant now = Instant.now();
        ExecutionSnapshot completion = new ExecutionSnapshot(executionId, session.id(), userId, null, "ontology-1",
                Map.of("ontologyVersionId", "ontology-1", "source", "grounded-context"),
                "completed", Map.of("mode", "multi-step", "_executionContract",
                        ExecutionRepository.EXECUTION_CONTRACT), List.of(),
                Map.of("causes", List.of()), List.of(Map.of("type", "markdown")),
                Map.of("summary", "done", "status", "completed", "updatedAt", now.toString()), null,
                null, "trace-1", now, now);
        ExecutionEvent terminal = event(session.id(), executionId, "completed", "trace-1");
        BackendException staleWorker = assertThrows(BackendException.class,
                () -> executions.completeAtomically(userId, "worker-2", terminal, completion,
                        Map.of("workflowInvocations", 1)));
        assertEquals("JOB_STATE_CONFLICT", staleWorker.code());
        assertEquals(1, analyses.events(session.id(), executionId, owner, 0).size());
        assertTrue(executions.findSnapshot(session.id(), executionId, userId).isEmpty());
        executions.completeAtomically(userId, "worker-1", terminal, completion, Map.of("workflowInvocations", 1));

        List<ExecutionEvent> resumed = analyses.events(session.id(), executionId, owner, 1);
        assertEquals(1, resumed.size());
        assertEquals(terminal.id(), resumed.getFirst().id());
        assertEquals(2, resumed.getFirst().sequence());
        ExecutionSnapshot snapshot = executions.findSnapshot(session.id(), executionId, userId).orElseThrow();
        assertEquals(2, snapshot.stepResults().size());
        assertEquals("trace-1", snapshot.traceId());
        assertEquals("grounded-context", snapshot.ontologyVersionBinding().get("source"));
        assertNull(snapshot.failurePoint());

        BackendException conflict = assertThrows(BackendException.class, () -> executions.completeAtomically(userId,
                "worker-1", event(session.id(), executionId, "completed", "trace-2"), completion,
                Map.of("workflowInvocations", 1)));
        assertEquals("JOB_STATE_CONFLICT", conflict.code());
        assertEquals(2, analyses.events(session.id(), executionId, owner, 0).size());
        assertEquals("trace-1", executions.findSnapshot(session.id(), executionId, userId).orElseThrow().traceId());
    }

    @Test
    void javaWorkerNeverClaimsATypeScriptJobWithoutTheJavaContractMarker() {
        String suffix = UUID.randomUUID().toString();
        String userId = "isolated-user-" + suffix;
        String organizationId = "isolated-org-" + suffix;
        AuthSession owner = new AuthSession("auth-" + suffix, userId, "测试用户",
                new AccessScope(organizationId, List.of("project-" + suffix), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        var session = sessions.create(owner, "分析项目收缴率", Map.of());
        String foreignExecutionId = "ts-execution-" + suffix;
        Instant older = Instant.now().minusSeconds(60);
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,attempt_count,max_attempts,available_at,dispatch_status,
                 owner_user_id,organization_id,session_id,origin_correlation_id,created_at,updated_at)
                values (?,'analysis-execution','queued',cast(? as jsonb),0,2,?,'published',?,?,?,?,?,?)
                """, foreignExecutionId, "{\"sessionId\":\"" + session.id() + "\"}", Timestamp.from(older),
                userId, organizationId, session.id(), "trace-ts", Timestamp.from(older), Timestamp.from(older));
        assertTrue(executions.findOwnedJob(session.id(), foreignExecutionId, userId).isEmpty());

        ExecutionSubmission javaSubmission = executions.submit(session, "java", "trace-java", "ontology-pinned");
        ExecutionJob claimed = executions.claim("worker-java", Duration.ofMinutes(1)).orElseThrow();

        assertEquals(javaSubmission.executionId(), claimed.executionId());
        assertEquals("ontology-pinned", claimed.ontologyVersionId());
        executions.fail(claimed.executionId(), "worker-java", "TEST_END", "test cleanup", "trace-java");
        assertEquals("queued", jdbc.queryForObject("select status from platform.jobs where id=?",
                String.class, foreignExecutionId));
    }

    @Test
    void malformedJavaJobIsFailedOnceAndNeverLeftInTheLeaseLoop() {
        String suffix = UUID.randomUUID().toString();
        String executionId = "malformed-java-" + suffix;
        Instant createdAt = Instant.now().minusSeconds(120);
        String payload = """
                {"executionContract":"java-initial-v1","projectIds":["project-1"],"areaIds":[],
                 "questionText":"分析项目收缴率","traceId":"trace-malformed"}
                """;
        jdbc.update("""
                insert into platform.jobs
                (id,type,status,payload,attempt_count,max_attempts,available_at,dispatch_status,
                 owner_user_id,organization_id,session_id,origin_correlation_id,created_at,updated_at)
                values (?,'analysis-execution','queued',cast(? as jsonb),0,2,?,'published',?,?,?,?,?,?)
                """, executionId, payload, Timestamp.from(createdAt), "malformed-user", "malformed-org",
                "malformed-session", "trace-malformed", Timestamp.from(createdAt), Timestamp.from(createdAt));

        BackendException error = assertThrows(BackendException.class,
                () -> executions.claim("worker-malformed", Duration.ofMinutes(1)));

        assertEquals("JOB_PAYLOAD_INVALID", error.code());
        assertEquals("failed", jdbc.queryForObject("select status from platform.jobs where id=?",
                String.class, executionId));
        assertTrue(executions.claim("worker-malformed", Duration.ofMinutes(1)).isEmpty());
    }

    @Test
    void invocationTransitionRollsBackWhenItsAuditEventCannotBeAppended() {
        String suffix = UUID.randomUUID().toString();
        String userId = "audit-user-" + suffix;
        AuthSession owner = new AuthSession("auth-" + suffix, userId, "测试用户",
                new AccessScope("org-" + suffix, List.of("project-" + suffix), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        var session = sessions.create(owner, "分析 2026 年 1 月项目收缴率", Map.of());
        String executionId = executions.submit(session, "audit", "trace-audit", "ontology-1").executionId();
        ExecutionJob job = executions.claim("worker-audit", Duration.ofMinutes(1)).orElseThrow();
        String invocationId = invocations.start(session.id(), executionId, userId, "analysis-workflow",
                "cube.semantic-query", "subtool", null, Map.of(), "trace-audit");
        ExecutionEvent event = event(session.id(), executionId, "processing", "trace-audit");
        executions.append(userId, event);

        assertThrows(RuntimeException.class,
                () -> invocationEvents.succeed(invocationId, Map.of("rowCount", 1), userId, job.workerId(), event));

        assertEquals("running", jdbc.queryForObject(
                "select status from platform.agent_invocations where id=?", String.class, invocationId));
        assertEquals(1L, jdbc.queryForObject(
                "select count(*) from platform.analysis_execution_events where execution_id=?",
                Long.class, executionId));
    }

    @Test
    void expiredLeaseTokenCannotRenewOrCommitBeforeOrAfterReclaim() {
        String suffix = UUID.randomUUID().toString();
        AuthSession owner = new AuthSession("auth-" + suffix, "lease-user-" + suffix, "测试用户",
                new AccessScope("org-" + suffix, List.of("project-" + suffix), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        var session = sessions.create(owner, "分析 2026 年 1 月项目收缴率", Map.of());
        String executionId = executions.submit(session, "lease", "trace-lease", "ontology-1").executionId();
        ExecutionJob first = executions.claim("worker:first", Duration.ofMinutes(1)).orElseThrow();
        String invocationId = invocations.start(session.id(), executionId, owner.userId(), "main-agent",
                "main-agent", "agent-run", null, Map.of(), "trace-lease");
        jdbc.update("update platform.jobs set locked_until=now()-interval '1 second' where id=?", executionId);

        BackendException expired = assertThrows(BackendException.class,
                () -> executions.renewLease(executionId, first.workerId(), Duration.ofMinutes(1)));
        assertEquals("JOB_LEASE_LOST", expired.code());
        BackendException expiredComplete = assertThrows(BackendException.class,
                () -> executions.complete(executionId, first.workerId(), Map.of()));
        assertEquals("JOB_STATE_CONFLICT", expiredComplete.code());
        BackendException expiredFail = assertThrows(BackendException.class,
                () -> executions.fail(executionId, first.workerId(), "STALE", "stale", "trace-lease"));
        assertEquals("JOB_STATE_CONFLICT", expiredFail.code());
        BackendException staleAudit = assertThrows(BackendException.class,
                () -> invocationEvents.succeedWhileLeased(invocationId, Map.of(), executionId, first.workerId()));
        assertEquals("JOB_LEASE_LOST", staleAudit.code());
        assertEquals("running", jdbc.queryForObject(
                "select status from platform.agent_invocations where id=?", String.class, invocationId));

        ExecutionJob second = executions.claim("worker:second", Duration.ofMinutes(1)).orElseThrow();
        assertEquals(1, invocationEvents.interruptRunningWhileLeased(executionId, second.workerId()));
        assertEquals("failed", jdbc.queryForObject(
                "select status from platform.agent_invocations where id=?", String.class, invocationId));
        assertEquals("AGENT_EXECUTION_INTERRUPTED", jdbc.queryForObject(
                "select error_code from platform.agent_invocations where id=?", String.class, invocationId));
        BackendException staleCommit = assertThrows(BackendException.class,
                () -> executions.complete(executionId, first.workerId(), Map.of()));
        assertEquals("JOB_STATE_CONFLICT", staleCommit.code());
        executions.fail(executionId, second.workerId(), "TEST_END", "test cleanup", "trace-lease");
    }

    @Test
    void erpEvidenceUsesTheGovernedReceivableCohortAndPaymentDateRules() {
        long base = Math.floorMod(UUID.randomUUID().getMostSignificantBits(), 100_000_000L) * 100;
        String suffix = UUID.randomUUID().toString();
        String projectId = "erp-project-" + suffix;
        String chargeItemId = "erp-item-" + suffix;
        String excludedItemId = "erp-item-excluded-" + suffix;
        String detailId = "erp-detail-" + suffix;
        jdbc.update("""
                insert into erp_staging.dw_datacenter_chargeitem
                (record_id,organization_id,charge_item_id,charge_item_name,charge_item_type)
                values (?,?,?,?,?),(?,?,?,?,?)
                """, base + 1, "child-org", chargeItemId, "物业费", "1",
                base + 2, "child-org", excludedItemId, "非物业费", "2");
        jdbc.update("""
                insert into erp_staging.dw_datacenter_charge
                (record_id,organization_id,charge_detail_id,precinct_id,precinct_name,charge_item_id,
                 should_account_book,actual_charge_sum,arrears,is_check,is_delete)
                values (?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?),
                       (?,?,?,?,?,?,?,?,?,?,?)
                """,
                base + 10, "child-org", detailId, projectId, "子组织项目", chargeItemId,
                202601, new BigDecimal("100"), new BigDecimal("60"), "审核通过", 0,
                base + 11, "child-org", "deleted-" + suffix, projectId, "子组织项目", chargeItemId,
                202601, new BigDecimal("900"), new BigDecimal("900"), "审核通过", 1,
                base + 12, "child-org", "unchecked-" + suffix, projectId, "子组织项目", chargeItemId,
                202601, new BigDecimal("800"), new BigDecimal("800"), "待审核", 0,
                base + 13, "child-org", "wrong-type-" + suffix, projectId, "子组织项目", excludedItemId,
                202601, new BigDecimal("700"), new BigDecimal("700"), "审核通过", 0);
        jdbc.update("""
                insert into erp_staging.dw_datacenter_bill
                (record_id,organization_id,charge_detail_id,precinct_id,precinct_name,charge_paid,operator_date,
                 is_enter_account,subject_code,is_delete,precinct_collection_type,refund_status)
                 values (?,?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?,?),
                        (?,?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?,?),(?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                base + 20, "child-org", detailId, projectId, "子组织项目", new BigDecimal("40"),
                Timestamp.valueOf("2026-01-15 12:00:00"), "1", "已缴款", 0, 0, null,
                base + 21, "child-org", detailId, projectId, "子组织项目", new BigDecimal("500"),
                Timestamp.valueOf("2026-02-01 00:00:00"), "1", "已缴款", 0, 0, null,
                base + 22, "child-org", detailId, projectId, "子组织项目", new BigDecimal("400"),
                Timestamp.valueOf("2026-01-10 00:00:00"), "1", "已缴款", 1, 0, null,
                base + 23, "child-org", detailId, projectId, "子组织项目", new BigDecimal("300"),
                Timestamp.valueOf("2026-01-10 00:00:00"), "1", "已缴款", 0, 0, "待退款",
                 base + 24, "child-org", detailId, projectId, "子组织项目", new BigDecimal("200"),
                 Timestamp.valueOf("2026-01-10 00:00:00"), "1", "无效科目", 0, 0, null,
                 base + 25, "child-org", detailId, projectId, "子组织项目", new BigDecimal("600"),
                 OffsetDateTime.parse("2026-01-31T20:00:00Z"), "1", "已缴款", 0, 0, null);

        var rows = erpEvidence.byProjects(new String[]{projectId},
                LocalDate.parse("2026-01-01"), LocalDate.parse("2026-01-31"));

        assertEquals(1, rows.size());
        assertEquals(0, rows.getFirst().receivableAmount.compareTo(new BigDecimal("100")));
        assertEquals(0, rows.getFirst().paidAmount.compareTo(new BigDecimal("40")));
        assertEquals(0, rows.getFirst().arrearsAmount.compareTo(new BigDecimal("60")));
    }

    @Test
    void followUpJobsUseAnIsolatedContractIdempotencyDomainAndSnapshotRead() {
        String userId = "follow-up-user-" + UUID.randomUUID();
        AuthSession owner = new AuthSession("auth-follow-up", userId, "追问用户",
                new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        var session = sessions.create(owner, "分析 2026 年 1 月项目收缴率", Map.of());
        Map<String, Object> context = Map.of("timeRange",
                Map.of("label", "时间范围", "value", "2026年1月", "state", "confirmed"));
        Map<String, Object> referencedConclusion = Map.of("title", "上一轮结论", "summary", "收缴率下降。");

        ExecutionSubmission first = executions.submitFollowUp(session, "follow-up-1", "execution-root",
                "为什么下降", referencedConclusion, context, "same-request", "trace-follow-up", "ontology-1");
        ExecutionSubmission replay = executions.submitFollowUp(session, "follow-up-1", "execution-root",
                "为什么下降", referencedConclusion, context, "same-request", "trace-replayed", "ontology-1");
        ExecutionSubmission anotherTurn = executions.submitFollowUp(session, "follow-up-2", "execution-root",
                "换个因素", referencedConclusion, context, "same-request", "trace-other", "ontology-1");
        assertTrue(first.created());
        assertFalse(replay.created());
        assertEquals(first.executionId(), replay.executionId());
        assertNotEquals(first.executionId(), anotherTurn.executionId());
        BackendException identityConflict = assertThrows(BackendException.class,
                () -> executions.submitFollowUp(session, "follow-up-1", "execution-root",
                        "被替换的问题", referencedConclusion, context, "same-request", "trace-conflict", "ontology-1"));
        assertEquals("IDEMPOTENCY_CONFLICT", identityConflict.code());

        ExecutionJob job = executions.claim("worker-follow-up", Duration.ofMinutes(1)).orElseThrow();
        assertEquals(ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT, job.contract());
        assertEquals("follow-up-1", job.followUpId());
        assertEquals("execution-root", job.referencedExecutionId());
        assertEquals(referencedConclusion, job.referencedConclusion());
        assertEquals(context, job.effectiveContext());
        Instant now = Instant.now();
        Map<String, Object> plan = Map.of(
                "_executionContract", ExecutionRepository.FOLLOW_UP_EXECUTION_CONTRACT,
                "_followUpId", "follow-up-1", "_referencedExecutionId", "execution-root",
                "_resolvedContext", context);
        ExecutionSnapshot snapshot = new ExecutionSnapshot(job.executionId(), session.id(), userId,
                "follow-up-1", "ontology-1", Map.of("ontologyVersionId", "ontology-1", "source", "inherited"),
                "completed", plan, List.of(), Map.of("causes", List.of()), List.of(),
                Map.of("summary", "done", "status", "completed", "updatedAt", now.toString()), null,
                null, "trace-follow-up", now, now);
        executions.completeAtomically(userId, job.workerId(),
                event(session.id(), job.executionId(), "completed", "trace-follow-up"), snapshot, Map.of());

        assertTrue(executions.findSnapshot(session.id(), job.executionId(), userId).isEmpty());
        assertEquals("follow-up-1", executions.findFollowUpSnapshot(session.id(), "follow-up-1",
                job.executionId(), userId).orElseThrow().followUpId());
        ExecutionJob pendingOtherTurn = executions.claim("worker-follow-up-cleanup", Duration.ofMinutes(1))
                .orElseThrow();
        executions.fail(pendingOtherTurn.executionId(), pendingOtherTurn.workerId(), "TEST_END", "test cleanup",
                pendingOtherTurn.traceId());
    }

    @Test
    void springAiJdbcChatMemoryPersistsIsolatesAndClearsConversations() {
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();
        chatMemory.add(first, List.of(new UserMessage("第一轮问题"), new AssistantMessage("第一轮回答")));
        chatMemory.add(second, List.of(new UserMessage("第二个会话问题"), new AssistantMessage("第二个会话回答")));

        assertEquals(List.of(MessageType.USER, MessageType.ASSISTANT),
                chatMemory.get(first).stream().map(message -> message.getMessageType()).toList());
        assertEquals(List.of("第一轮问题", "第一轮回答"),
                chatMemory.get(first).stream().map(message -> message.getText()).toList());
        assertEquals(List.of("第二个会话问题", "第二个会话回答"),
                chatMemory.get(second).stream().map(message -> message.getText()).toList());
        assertEquals(2, jdbc.queryForObject(
                "select count(*) from spring_ai_chat_memory where conversation_id=?", Integer.class, first));

        chatMemory.clear(first);

        assertTrue(chatMemory.get(first).isEmpty());
        assertEquals(List.of("第二个会话问题", "第二个会话回答"),
                chatMemory.get(second).stream().map(message -> message.getText()).toList());
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from spring_ai_chat_memory where conversation_id=?", Integer.class, first));
    }

    @Test
    void concurrentFollowUpIdempotencyReplaysWithoutAbortingTheOuterTransaction() throws Exception {
        String userId = "concurrent-user-" + UUID.randomUUID();
        AuthSession owner = new AuthSession("auth-concurrent", userId, "并发用户",
                new AccessScope("org-1", List.of("project-1"), List.of(), List.of("analyst")),
                Instant.now().plusSeconds(3600));
        var session = sessions.create(owner, "分析 2026 年 1 月项目收缴率", Map.of());
        Map<String, Object> conclusion = Map.of("title", "上一轮结论", "summary", "收缴率下降。");
        Map<String, Object> context = Map.of("from", "2026-01-01", "to", "2026-01-31");
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            java.util.concurrent.Callable<ExecutionSubmission> submit = () -> {
                start.await();
                return new TransactionTemplate(transactionManager).execute(status -> executions.submitFollowUp(
                        session, "follow-up-concurrent", "execution-root", "为什么下降", conclusion, context,
                        "same-key", "trace-" + UUID.randomUUID(), "ontology-1"));
            };
            var first = pool.submit(submit);
            var second = pool.submit(submit);
            start.countDown();
            List<ExecutionSubmission> results = List.of(first.get(), second.get());

            assertEquals(1, results.stream().filter(ExecutionSubmission::created).count());
            assertEquals(1, results.stream().map(ExecutionSubmission::executionId).distinct().count());
            assertEquals(1, jdbc.queryForObject("select count(*) from platform.jobs where id=?", Integer.class,
                    results.getFirst().executionId()));
            jdbc.update("update platform.jobs set status='failed',error='TEST_END',failed_at=now(),updated_at=now() where id=?",
                    results.getFirst().executionId());
        }
    }

    private static ExecutionEvent event(String sessionId, String executionId, String status, String traceId) {
        return new ExecutionEvent(UUID.randomUUID().toString(), sessionId, executionId, 0,
                "execution-status", Instant.now(), status, status, List.of(), Map.of(), null, traceId);
    }
}
