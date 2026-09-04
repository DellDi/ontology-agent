package com.dip3.ontologyagent.followup;

import com.dip3.ontologyagent.analysis.AnalysisService;
import com.dip3.ontologyagent.analysis.AnalysisSession;
import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.FollowUpPolicy;
import com.dip3.ontologyagent.execution.ExecutionRepository;
import com.dip3.ontologyagent.execution.ExecutionSnapshotMapper;
import com.dip3.ontologyagent.execution.WakeupPublisher;
import com.dip3.ontologyagent.ontology.OntologyCatalog;
import com.dip3.ontologyagent.ontology.OntologyRepository;
import com.dip3.ontologyagent.property.internal.application.PropertyFollowUpPolicyTestSupport;
import com.dip3.ontologyagent.property.internal.application.PropertyProjectScopeResolver;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.junit.jupiter.api.extension.ExtendWith;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
@ExtendWith(OutputCaptureExtension.class)
class AnalysisFollowUpPersistenceTest {
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

    @Autowired AnalysisFollowUpRepository repository;
    @Autowired AnalysisFollowUpService service;
    @Autowired ExecutionRepository executions;
    @Autowired ExecutionSnapshotMapper snapshots;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean AnalysisService analyses;
    @MockitoBean OntologyRepository ontologies;
    @MockitoBean WakeupPublisher wakeups;
    private final PropertyProjectScopeResolver scopedProjects = mock(PropertyProjectScopeResolver.class);
    private final FollowUpPolicy followUpPolicy = PropertyFollowUpPolicyTestSupport.policy(scopedProjects);

    private String suffix;
    private AuthSession owner;
    private AnalysisSession session;

    @BeforeEach
    void setUp() {
        reset(analyses, ontologies, wakeups);
        suffix = UUID.randomUUID().toString();
        owner = new AuthSession("auth-" + suffix, "user-" + suffix, "测试用户",
                new AccessScope("org-" + suffix, List.of("project-" + suffix), List.of(), List.of("analyst")),
                Instant.MAX);
        session = new AnalysisSession("session-" + suffix, owner.userId(), owner.scope(), "分析收缴率",
                Map.of("_executionContract", "java-initial-v1"), "completed", Instant.now(), Instant.now());
        when(analyses.ownedSession(session.id(), owner)).thenReturn(session);
        OntologyCatalog ontology = new OntologyCatalog(
                "ontology-" + suffix, "1.0.0", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
                List.of());
        when(ontologies.published(ontology.versionId())).thenReturn(ontology);
        when(analyses.followUpPolicy(
                owner,
                com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding(
                        owner, ontology.versionId())))
                .thenReturn(followUpPolicy);
    }

    @Test
    void nullablePlanJsonIsClearedAndListUsesCreatedOrder() {
        AnalysisFollowUp first = repository.create(followUp("follow-a-" + suffix, Instant.now(), plan()));
        AnalysisFollowUp second = repository.create(followUp("follow-b-" + suffix, Instant.now().minusSeconds(10),
                plan()));

        AnalysisFollowUp cleared = copy(first, null, plan(), null, first.resultExecutionId(), Instant.now());
        repository.replace(first, cleared);

        AnalysisFollowUp stored = repository.findOwned(first.id(), owner.userId()).orElseThrow();
        assertNull(stored.currentPlanSnapshot());
        assertEquals(com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding(owner,
                "ontology-" + suffix).snapshot(), stored.capabilityBinding());
        assertEquals(List.of(first.id(), second.id()), repository.listOwned(session.id(), owner.userId()).stream()
                .map(AnalysisFollowUp::id).toList());
    }

    @Test
    void completedSourceRequiresTheExactRootOrParentRound() {
        insertSnapshot("root-" + suffix, null, "java-initial-v1");
        AnalysisFollowUp rootChild = followUp("root-child-" + suffix, Instant.now(), plan());
        rootChild = withReference(rootChild, "root-" + suffix, null);
        assertTrue(repository.completedSourceSnapshot(rootChild).isPresent());

        insertSnapshot("wrong-round-" + suffix, "another-follow-up", "java-follow-up-v1");
        AnalysisFollowUp parentChild = withReference(followUp("parent-child-" + suffix, Instant.now(), plan()),
                "wrong-round-" + suffix, "expected-parent");
        assertTrue(repository.completedSourceSnapshot(parentChild).isEmpty());
    }

    @Test
    void submitAndAttachCommitAtomicallyAndDuplicateSubmissionIsIdempotent() {
        AnalysisFollowUp stored = repository.create(followUp("follow-submit-" + suffix, Instant.now(), null));

        String first = service.submit(session.id(), stored.id(), owner, "same", "trace-" + suffix);
        String second = null;
        BackendException repeated = null;
        try {
            second = service.submit(session.id(), stored.id(), owner, "same", "trace-" + suffix);
        } catch (BackendException error) {
            repeated = error;
        }

        if (repeated != null) throw repeated;
        assertEquals(first, second);
        assertEquals(first, repository.findOwned(stored.id(), owner.userId()).orElseThrow().resultExecutionId());
        assertEquals(1L, jdbc.queryForObject("select count(*) from platform.jobs where id=?", Long.class, first));
        verify(wakeups).publish(first);
    }

    @Test
    void concurrentSubmitSerializesOnFollowUpAndNeverLeavesAnOrphanJob() throws Exception {
        AnalysisFollowUp sameKey = repository.create(followUp("follow-concurrent-same-" + suffix,
                Instant.now(), null));
        List<String> sameResults = concurrentSubmit(sameKey, "same", "same");
        assertEquals(sameResults.get(0), sameResults.get(1));
        assertEquals(1L, jobCount(sameKey.id()));

        AnalysisFollowUp differentKeys = repository.create(followUp("follow-concurrent-different-" + suffix,
                Instant.now(), null));
        List<String> differentResults = concurrentSubmit(differentKeys, "first", "second");
        assertEquals(differentResults.get(0), differentResults.get(1));
        assertEquals(1L, jobCount(differentKeys.id()));
        assertEquals(differentResults.get(0), repository.findOwned(differentKeys.id(), owner.userId())
                .orElseThrow().resultExecutionId());
    }

    @Test
    void attachFailureRollsBackNewJob() {
        AnalysisFollowUp stored = repository.create(followUp("follow-rollback-" + suffix, Instant.now(), null));
        String token = suffix.replace("-", "");
        String function = "platform.reject_attach_" + token;
        String trigger = "reject_attach_" + token;
        jdbc.execute("create function " + function + "() returns trigger language plpgsql as $body$ begin "
                + "raise exception 'forced attach failure'; end $body$");
        jdbc.execute("create trigger " + trigger + " before update on platform.analysis_session_follow_ups "
                + "for each row when (new.id = '" + stored.id() + "') execute function " + function + "()");
        try {
            assertThrows(RuntimeException.class,
                    () -> service.submit(session.id(), stored.id(), owner, "rollback", "trace-" + suffix));
        } finally {
            jdbc.execute("drop trigger " + trigger + " on platform.analysis_session_follow_ups");
            jdbc.execute("drop function " + function + "()");
        }
        String deterministicId = UUID.nameUUIDFromBytes(("analysis-follow-up-execution:" + session.id() + ":"
                + stored.id() + ":rollback").getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
        assertEquals(0L, jdbc.queryForObject("select count(*) from platform.jobs where id=?",
                Long.class, deterministicId));
    }

    @Test
    void wakeupFailureLeavesCommittedJobAndMarksDispatchFailed(CapturedOutput output) {
        AnalysisFollowUp stored = repository.create(followUp("follow-wakeup-" + suffix, Instant.now(), null));
        doThrow(new IllegalStateException("redis unavailable")).when(wakeups).publish(any());

        String executionId = service.submit(session.id(), stored.id(), owner, "wakeup", "trace-" + suffix);

        assertEquals("failed", jdbc.queryForObject("select dispatch_status from platform.jobs where id=?",
                String.class, executionId));
        assertEquals(executionId,
                repository.findOwned(stored.id(), owner.userId()).orElseThrow().resultExecutionId());
        assertTrue(output.getOut().contains("follow_up_wakeup_failed")
                || output.getErr().contains("follow_up_wakeup_failed"));
        assertTrue(output.getAll().contains(executionId));
        assertTrue(output.getAll().contains("trace-" + suffix));
    }

    private AnalysisFollowUp followUp(String id, Instant createdAt, Map<String, Object> currentPlan) {
        Map<String, Object> context = context();
        return new AnalysisFollowUp(id, session.id(), owner.userId(), "为什么下降", null, "root-" + suffix,
                "结论", "摘要", null, "ontology-" + suffix,
                Map.of("ontologyVersionId", "ontology-" + suffix, "source", "inherited"),
                com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding(owner,
                        "ontology-" + suffix).snapshot(), context, context,
                currentPlan == null ? null : 2, currentPlan, null, null, createdAt, createdAt);
    }

    private List<String> concurrentSubmit(AnalysisFollowUp followUp, String firstKey, String secondKey)
            throws Exception {
        var executor = Executors.newFixedThreadPool(2);
        try {
            CyclicBarrier barrier = new CyclicBarrier(2);
            Callable<String> first = () -> {
                barrier.await();
                return service.submit(session.id(), followUp.id(), owner, firstKey, "trace-first-" + suffix);
            };
            Callable<String> second = () -> {
                barrier.await();
                return service.submit(session.id(), followUp.id(), owner, secondKey, "trace-second-" + suffix);
            };
            Future<String> one = executor.submit(first);
            Future<String> two = executor.submit(second);
            return List.of(one.get(20, TimeUnit.SECONDS), two.get(20, TimeUnit.SECONDS));
        } finally {
            executor.shutdownNow();
        }
    }

    private long jobCount(String followUpId) {
        return jdbc.queryForObject("select count(*) from platform.jobs where payload->>'followUpId'=?",
                Long.class, followUpId);
    }

    private Map<String, Object> context() {
        return Map.of("targetMetric", field("目标指标", "collection-rate"),
                "entity", field("实体对象", "project-" + suffix),
                "timeRange", field("时间范围", "2026-01-01/2026-01-31"),
                "comparison", field("比较方式", "无需比较"), "constraints", List.of(
                        Map.of("label", "实体 business key", "value", "property-project"),
                        Map.of("label", "指标定义 business key", "value", "collection-rate-definition"),
                        Map.of("label", "指标口径 business key", "value", "collection-rate"),
                        Map.of("label", "时间语义 business key", "value", "receivable-period"),
                        Map.of("label", "项目 ID", "value", "project-" + suffix)));
    }

    private Map<String, Object> plan() {
        return Map.of("mode", "multi-step", "summary", "计划", "steps", List.of(),
                "_resolvedContext", Map.of("entityKey", "property-project",
                        "metricDefinitionKey", "collection-rate-definition", "metricVariantKey", "collection-rate",
                        "timeSemanticKey", "receivable-period", "projectIds", List.of("project-" + suffix),
                        "from", "2026-01-01", "to", "2026-01-31"));
    }

    private static Map<String, Object> field(String label, String value) {
        return Map.of("label", label, "value", value, "state", "confirmed");
    }

    private AnalysisFollowUp copy(AnalysisFollowUp source, Map<String, Object> currentPlan,
                                  Map<String, Object> previousPlan, Map<String, Object> diff,
                                  String resultExecutionId, Instant updatedAt) {
        return new AnalysisFollowUp(source.id(), source.sessionId(), source.ownerUserId(), source.questionText(),
                source.parentFollowUpId(), source.referencedExecutionId(), source.referencedConclusionTitle(),
                source.referencedConclusionSummary(), resultExecutionId, source.ontologyVersionId(),
                source.ontologyVersionBinding(), source.capabilityBinding(), source.inheritedContext(), source.mergedContext(),
                source.planVersion(), currentPlan, previousPlan, diff, source.createdAt(), updatedAt);
    }

    private AnalysisFollowUp withReference(AnalysisFollowUp source, String executionId, String parentId) {
        return new AnalysisFollowUp(source.id(), source.sessionId(), source.ownerUserId(), source.questionText(),
                parentId, executionId, source.referencedConclusionTitle(), source.referencedConclusionSummary(),
                source.resultExecutionId(), source.ontologyVersionId(), source.ontologyVersionBinding(), source.capabilityBinding(),
                source.inheritedContext(), source.mergedContext(), source.planVersion(), source.currentPlanSnapshot(),
                source.previousPlanSnapshot(), source.currentPlanDiff(), source.createdAt(), source.updatedAt());
    }

    private void insertSnapshot(String executionId, String followUpId, String contract) {
        jdbc.update("""
                insert into platform.analysis_execution_snapshots
                (execution_id,session_id,owner_user_id,follow_up_id,ontology_version_id,
                 ontology_version_binding_source,capability_binding,status,plan_snapshot,step_results,conclusion_state,
                 result_blocks,mobile_projection,created_at,updated_at)
                values (?,?,?,?,?,'grounded-context',cast(? as jsonb),'completed',cast(? as jsonb),'[]','{}','[]','{}',?,?)
                """, executionId, session.id(), owner.userId(), followUpId, "ontology-" + suffix,
                new com.dip3.ontologyagent.support.JsonCodec().write(
                        com.dip3.ontologyagent.support.CapabilityTestFixtures.propertyBinding(owner,
                                "ontology-" + suffix).snapshot()),
                "{\"_executionContract\":\"" + contract + "\",\"steps\":[]}",
                Timestamp.from(Instant.now()), Timestamp.from(Instant.now()));
    }
}
