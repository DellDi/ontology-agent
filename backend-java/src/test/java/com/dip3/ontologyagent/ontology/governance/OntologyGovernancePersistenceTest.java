package com.dip3.ontologyagent.ontology.governance;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.ObjectMapper;
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
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static com.dip3.ontologyagent.ontology.governance.GovernanceResponses.CreateChangeRequest;
import static com.dip3.ontologyagent.ontology.governance.GovernanceResponses.PublishVersion;
import static com.dip3.ontologyagent.ontology.governance.GovernanceResponses.ReviewChangeRequest;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers
@SpringBootTest(properties = "dip3.worker.enabled=false")
class OntologyGovernancePersistenceTest {
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
    static void migrateAndInstallAuditFailureGuard() throws Exception {
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
                        create function platform.reject_governance_audit() returns trigger language plpgsql as $body$
                        begin
                          if new.correlation_id like 'rollback-%' then
                            raise exception 'forced governance audit failure';
                          end if;
                          return new;
                        end
                        $body$
                        """);
                statement.execute("""
                        create trigger reject_governance_audit before insert on platform.audit_events
                        for each row execute function platform.reject_governance_audit()
                        """);
            }
        }
    }

    @Autowired OntologyGovernanceService governance;
    @Autowired JdbcTemplate jdbc;
    private final ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();

    private String suffix;

    @BeforeEach
    void resetDatabase() {
        jdbc.execute("""
                truncate platform.ontology_approval_records, platform.ontology_publish_records,
                  platform.ontology_change_requests, platform.ontology_entity_definitions,
                  platform.ontology_metric_definitions, platform.ontology_metric_variants,
                  platform.ontology_factor_definitions, platform.ontology_causality_edges,
                  platform.ontology_plan_step_templates, platform.ontology_tool_capability_bindings,
                  platform.ontology_time_semantics, platform.ontology_evidence_type_definitions,
                  platform.ontology_versions, platform.audit_events cascade
                """);
        suffix = UUID.randomUUID().toString();
    }

    @Test
    void definitionsUnionReadsEveryCanonicalCategoryAndMatchesTheStrictDtoShape() {
        String versionId = version("definitions", "approved", null, Instant.now());
        Instant now = Instant.now();
        Timestamp timestamp = Timestamp.from(now);
        jdbc.update("""
                insert into platform.ontology_entity_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,synonyms,parent_business_key,metadata,created_at,updated_at)
                values (?,?,?,'项目','实体','approved',array['楼盘'],'portfolio',cast('{"source":"erp"}' as jsonb),?,?)
                """, "entity-" + suffix, versionId, "property-project", timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_metric_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,default_aggregation,unit,metadata,created_at,updated_at)
                values (?,?,?,'收缴率','指标','approved',array['property-project'],'ratio','percent','{}',?,?)
                """, "metric-" + suffix, versionId, "collection-rate", timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_metric_variants
                  (id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at)
                values (?,?,?,?, '应收口径','指标变体','approved','receivable',cast('{"view":"Collection"}' as jsonb),null,'{}',?,?)
                """, "variant-" + suffix, versionId, "metric-" + suffix, "collection-rate-receivable",
                timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_factor_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,category,related_metric_keys,metadata,created_at,updated_at)
                values (?,?,?,'催缴覆盖','因素','approved','operation',array['collection-rate'],'{}',?,?)
                """, "factor-" + suffix, versionId, "collection-coverage", timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_causality_edges
                  (id,ontology_version_id,business_key,display_name,description,status,source_entity_key,target_entity_key,causality_type,is_attribution_path_enabled,default_weight,neo4j_relationship_types,temporal_constraints,filter_conditions,metadata,created_at,updated_at)
                values (?,?,?,'项目影响指标','因果边','approved','property-project','collection-rate','influences',true,
                  cast('{"type":"fixed","value":1}' as jsonb),array['INFLUENCES'],null,null,'{}',?,?)
                """, "edge-" + suffix, versionId, "project-collection-rate", timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_plan_step_templates
                  (id,ontology_version_id,business_key,display_name,description,status,intent_types,required_capabilities,sort_order,metadata,created_at,updated_at)
                values (?,?,?,'指标查询','计划步骤','approved',array['metric_analysis'],array['cube.query'],10,'{}',?,?)
                """, "step-" + suffix, versionId, "metric-query", timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_tool_capability_bindings
                  (id,ontology_version_id,bound_step_template_key,bound_capability_tag,tool_name,activation_conditions,description,status,priority,created_at,updated_at,created_by)
                values (?,?,?,'cube.query','queryMetric',cast('[{"intent":"metric_analysis"}]' as jsonb),'工具绑定','approved',20,?,?,?)
                """, "tool-" + suffix, versionId, "metric-query", now.toString(), now.toString(), "admin");
        jdbc.update("""
                insert into platform.ontology_time_semantics
                  (id,ontology_version_id,business_key,display_name,description,status,semantic_type,entity_date_field_mapping,cube_time_dimension_mapping,calculation_rule,default_granularity,metadata,created_at,updated_at)
                values (?,?,?,'应收期间','时间语义','approved','business_period',cast('{"receivable":"period"}' as jsonb),null,null,'month','{}',?,?)
                """, "time-" + suffix, versionId, "receivable-period", timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_evidence_type_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,evidence_category,renderer_config,data_source_config,default_priority,is_interactive,template_schema,validation_rules,metadata,created_at,updated_at)
                values (?,?,?,'指标卡','证据','approved','metric',cast('{"renderer":"card"}' as jsonb),'{}','high','true',null,'[]','{}',?,?)
                """, "evidence-" + suffix, versionId, "metric-card", timestamp, timestamp);

        var result = governance.definitions(versionId, actor("ONTOLOGY_VIEWER"));

        assertEquals(1, result.entities().size());
        assertEquals(1, result.metrics().size());
        assertEquals(1, result.metricVariants().size());
        assertEquals(1, result.factors().size());
        assertEquals(1, result.causalityEdges().size());
        assertEquals(1, result.planStepTemplates().size());
        assertEquals(1, result.toolBindings().size());
        assertEquals(1, result.timeSemantics().size());
        assertEquals(1, result.evidenceTypes().size());
        assertEquals(List.of("楼盘"), result.entities().getFirst().fields().get("synonyms"));
        assertEquals("queryMetric", result.toolBindings().getFirst().businessKey());
        assertEquals(Boolean.TRUE, result.evidenceTypes().getFirst().fields().get("isInteractive"));

        Map<?, ?> json = objectMapper.convertValue(result, Map.class);
        assertEquals(List.of("capabilities", "causalityEdges", "entities", "evidenceTypes", "factors",
                        "metricVariants", "metrics", "planStepTemplates", "timeSemantics", "toolBindings", "version"),
                json.keySet().stream().map(Object::toString).sorted().toList());
        Map<?, ?> item = (Map<?, ?>) ((List<?>) json.get("entities")).getFirst();
        assertEquals(List.of("businessKey", "createdAt", "description", "displayName", "fields", "id",
                        "ontologyVersionId", "status", "updatedAt"),
                item.keySet().stream().map(Object::toString).sorted().toList());
    }

    @Test
    void approvedAndRejectedStateMachinesPersistApprovalAndAuditFacts() {
        String versionId = version("workflow", "draft", null, Instant.now());
        var approved = governance.create(change(versionId, "approved"), actor("ONTOLOGY_AUTHOR"), "trace-create");
        approved = governance.submit(approved.id(), actor("ONTOLOGY_AUTHOR"), "trace-submit");
        assertEquals("submitted", approved.status());
        assertNotNull(approved.submittedAt());
        var approval = governance.review(approved.id(), new ReviewChangeRequest("approved", "同意"),
                actor("ONTOLOGY_APPROVER"), "trace-review");
        assertEquals("approved", approval.changeRequest().status());
        assertEquals("approved", approval.approvalRecord().decision());

        var rejected = governance.create(change(versionId, "rejected"), actor("ONTOLOGY_AUTHOR"), "trace-create-2");
        governance.submit(rejected.id(), actor("ONTOLOGY_AUTHOR"), "trace-submit-2");
        var rejection = governance.review(rejected.id(), new ReviewChangeRequest("rejected", "需重做"),
                actor("ONTOLOGY_APPROVER"), "trace-reject");
        assertEquals("rejected", rejection.changeRequest().status());
        BackendException terminal = assertThrows(BackendException.class,
                () -> governance.submit(rejected.id(), actor("ONTOLOGY_AUTHOR"), "trace-repeat"));
        assertEquals("ONTOLOGY_CHANGE_REQUEST_SUBMIT_CONFLICT", terminal.code());

        assertEquals(2L, count("platform.ontology_approval_records"));
        assertEquals(6L, count("platform.audit_events"));
        var detail = governance.changeRequest(approval.changeRequest().id(), actor("ONTOLOGY_VIEWER"));
        assertEquals(1, detail.approvals().size());
        assertEquals("approved", detail.changeRequest().status());
        Map<?, ?> detailJson = objectMapper.convertValue(detail, Map.class);
        assertEquals(List.of("approvals", "capabilities", "changeRequest"), sortedKeys(detailJson));
        assertEquals(List.of("afterSummary", "beforeSummary", "changeType", "compatibilityNote",
                        "compatibilityType", "createdAt", "description", "id", "impactScope",
                        "ontologyVersionId", "status", "submittedAt", "submittedBy", "targetObjectKey",
                        "targetObjectType", "title", "updatedAt"),
                sortedKeys((Map<?, ?>) detailJson.get("changeRequest")));
        assertEquals(List.of("changeRequestId", "comment", "createdAt", "decision", "id", "reviewedBy"),
                sortedKeys((Map<?, ?>) ((List<?>) detailJson.get("approvals")).getFirst()));
    }

    @Test
    void roleChecksRejectEveryOperationOutsideItsDeclaredCapability() {
        String versionId = version("permissions", "draft", null, Instant.now());
        BackendException noView = assertThrows(BackendException.class,
                () -> governance.overview(actor("ANALYST")));
        assertEquals("ONTOLOGY_GOVERNANCE_FORBIDDEN", noView.code());
        BackendException noAuthor = assertThrows(BackendException.class,
                () -> governance.create(change(versionId, "denied"), actor("ONTOLOGY_VIEWER"), "trace-denied"));
        assertEquals("ONTOLOGY_GOVERNANCE_FORBIDDEN", noAuthor.code());
        BackendException noReview = assertThrows(BackendException.class,
                () -> governance.review("missing", new ReviewChangeRequest("approved", null),
                        actor("ONTOLOGY_AUTHOR"), "trace-denied"));
        assertEquals("ONTOLOGY_GOVERNANCE_FORBIDDEN", noReview.code());
        BackendException noPublish = assertThrows(BackendException.class,
                () -> governance.publish(versionId, null, actor("ONTOLOGY_APPROVER"), "trace-denied"));
        assertEquals("ONTOLOGY_GOVERNANCE_FORBIDDEN", noPublish.code());
        assertEquals(0L, count("platform.ontology_change_requests"));
        assertEquals(0L, count("platform.audit_events"));
    }

    @Test
    void publishDeprecatesPreviousVersionPublishesApprovedRequestsAndWritesOneAuditTransaction() {
        Instant base = Instant.now().minusSeconds(60);
        String previousId = version("previous", "approved", base, base);
        String targetId = version("target", "approved", null, Instant.now());
        seedCompleteOntology(targetId, "publish");
        var request = approvedRequest(targetId, "publish");

        var published = governance.publish(targetId, new PublishVersion("正式发布"),
                actor("ONTOLOGY_PUBLISHER"), "trace-publish");

        assertEquals(previousId, published.previousVersionId());
        assertEquals(List.of(request.id()), published.changeRequestIds());
        assertEquals("deprecated", value("select status from platform.ontology_versions where id=?", previousId));
        assertNotNull(value("select deprecated_at from platform.ontology_versions where id=?", previousId));
        assertEquals("approved", value("select status from platform.ontology_versions where id=?", targetId));
        assertNotNull(value("select published_at from platform.ontology_versions where id=?", targetId));
        assertEquals("published", value("select status from platform.ontology_change_requests where id=?", request.id()));
        assertEquals(1L, count("platform.ontology_publish_records"));
        assertEquals(1L, jdbc.queryForObject("select count(*) from platform.audit_events where event_type='ontology.version.published'",
                Long.class));

        var overview = governance.overview(actor("ONTOLOGY_VIEWER"));
        assertEquals(targetId, overview.currentPublishedVersion().id());
        assertEquals(0L, overview.approvedAwaitingPublishCount());
        Map<?, ?> overviewJson = objectMapper.convertValue(overview, Map.class);
        assertEquals(List.of("approvedAwaitingPublishCount", "capabilities", "currentPublishedVersion",
                        "latestApprovedVersion", "pendingReviewCount", "recentChangeRequests", "recentPublishes"),
                sortedKeys(overviewJson));
    }

    @Test
    void publishIntegrityFailsLoudForMissingOrphanInvalidBindingAndDuplicateWithoutChangingCurrent() {
        Instant base = Instant.now().minusSeconds(120);
        String previousId = version("integrity-previous", "approved", base, base);
        String targetId = version("integrity", "approved", null, Instant.now());

        BackendException missing = assertThrows(BackendException.class,
                () -> governance.publish(targetId, null, actor("ONTOLOGY_PUBLISHER"), "trace-missing"));
        assertEquals("ONTOLOGY_PUBLISH_INTEGRITY_INVALID", missing.code());
        assertTrue(missing.getMessage().contains("missing:entity_definition"));
        assertPublishDidNotMutate(previousId, targetId);

        seedCompleteOntology(targetId, "integrity");
        Instant now = Instant.now();
        jdbc.update("""
                insert into platform.ontology_metric_variants
                  (id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,
                   semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at)
                values (?,?, 'missing-parent',?,'孤儿变体',null,'approved','orphan','{}',null,'{}',?,?)
                """, "orphan-" + suffix, targetId, "orphan-" + suffix, Timestamp.from(now), Timestamp.from(now));
        BackendException orphan = assertThrows(BackendException.class,
                () -> governance.publish(targetId, null, actor("ONTOLOGY_PUBLISHER"), "trace-orphan"));
        assertEquals("ONTOLOGY_PUBLISH_INTEGRITY_INVALID", orphan.code());
        assertTrue(orphan.getMessage().contains("orphan:metric_variant:orphan-" + suffix));
        assertPublishDidNotMutate(previousId, targetId);
        jdbc.update("delete from platform.ontology_metric_variants where id=?", "orphan-" + suffix);

        String bindingId = "seed-tool-integrity-" + suffix;
        jdbc.update("update platform.ontology_tool_capability_bindings set bound_step_template_key='missing-step' "
                + "where id=?", bindingId);
        BackendException invalidBinding = assertThrows(BackendException.class,
                () -> governance.publish(targetId, null, actor("ONTOLOGY_PUBLISHER"), "trace-binding"));
        assertEquals("ONTOLOGY_PUBLISH_INTEGRITY_INVALID", invalidBinding.code());
        assertTrue(invalidBinding.getMessage().contains("invalid:tool_binding:" + bindingId));
        assertPublishDidNotMutate(previousId, targetId);
        jdbc.update("update platform.ontology_tool_capability_bindings set bound_step_template_key=? "
                + "where id=?", "inspect-metric-change", bindingId);

        jdbc.update("""
                insert into platform.ontology_metric_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,
                   default_aggregation,unit,metadata,created_at,updated_at)
                values (?,?,?,'重复指标',null,'approved',array[]::text[],'sum',null,'{}',?,?)
                """, "duplicate-" + suffix, targetId, "collection-rate",
                Timestamp.from(now), Timestamp.from(now));
        BackendException duplicate = assertThrows(BackendException.class,
                () -> governance.publish(targetId, null, actor("ONTOLOGY_PUBLISHER"), "trace-duplicate"));
        assertEquals("ONTOLOGY_PUBLISH_INTEGRITY_INVALID", duplicate.code());
        assertTrue(duplicate.getMessage().contains("duplicate:metric_definition:collection-rate"));
        assertPublishDidNotMutate(previousId, targetId);
    }

    @Test
    void publishRejectsRuntimeSemanticDriftWithoutChangingCurrentVersion() {
        Instant base = Instant.now().minusSeconds(120);
        String previousId = version("runtime-previous", "approved", base, base);
        String targetId = version("runtime-drift", "approved", null, Instant.now());
        seedCompleteOntology(targetId, "runtime-drift");
        jdbc.update("update platform.ontology_metric_variants "
                + "set cube_view_mapping=cast('{\"cubeMeasure\":\"FinancePayments.amount\"}' as jsonb) "
                + "where ontology_version_id=? and business_key='project-paid-amount'", targetId);

        BackendException drift = assertThrows(BackendException.class,
                () -> governance.publish(targetId, null, actor("ONTOLOGY_PUBLISHER"), "trace-runtime-drift"));

        assertEquals("ONTOLOGY_RUNTIME_SEMANTICS_UNSUPPORTED", drift.code());
        assertPublishDidNotMutate(previousId, targetId);
        assertEquals(0L, jdbc.queryForObject(
                "select count(*) from platform.audit_events where correlation_id='trace-runtime-drift'", Long.class));
    }

    @Test
    void concurrentPublishOfTheSameVersionIsSerializedToOneSuccess() throws Exception {
        String targetId = version("concurrent", "approved", null, Instant.now());
        seedCompleteOntology(targetId, "concurrent");
        CyclicBarrier barrier = new CyclicBarrier(2);
        Callable<Object> publish = () -> {
            barrier.await();
            try {
                return governance.publish(targetId, null, actor("ONTOLOGY_PUBLISHER"),
                        "trace-concurrent-" + UUID.randomUUID());
            } catch (RuntimeException error) {
                return error;
            }
        };
        List<Object> outcomes = new ArrayList<>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Object> first = executor.submit(publish);
            Future<Object> second = executor.submit(publish);
            outcomes.add(first.get(20, TimeUnit.SECONDS));
            outcomes.add(second.get(20, TimeUnit.SECONDS));
        }

        assertEquals(1L, outcomes.stream().filter(GovernanceResponses.OntologyPublishRecord.class::isInstance).count());
        Object failed = outcomes.stream().filter(BackendException.class::isInstance).findFirst().orElseThrow();
        assertEquals("ONTOLOGY_PUBLISH_CONFLICT", assertInstanceOf(BackendException.class, failed).code());
        assertEquals(1L, count("platform.ontology_publish_records"));
        assertEquals(1L, jdbc.queryForObject("select count(*) from platform.ontology_versions where status='approved' and published_at is not null",
                Long.class));
    }

    @Test
    void concurrentPublishOfDifferentVersionsAllowsOnlyOneWinner() throws Exception {
        String firstId = version("candidate-a", "approved", null, Instant.now());
        String secondId = version("candidate-b", "approved", null, Instant.now().plusMillis(1));
        seedCompleteOntology(firstId, "candidate-a");
        seedCompleteOntology(secondId, "candidate-b");
        CyclicBarrier barrier = new CyclicBarrier(2);
        Callable<Object> firstPublish = () -> publishAfterBarrier(firstId, barrier);
        Callable<Object> secondPublish = () -> publishAfterBarrier(secondId, barrier);
        List<Object> outcomes = new ArrayList<>();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            Future<Object> first = executor.submit(firstPublish);
            Future<Object> second = executor.submit(secondPublish);
            outcomes.add(first.get(20, TimeUnit.SECONDS));
            outcomes.add(second.get(20, TimeUnit.SECONDS));
        }

        assertEquals(1L, outcomes.stream().filter(GovernanceResponses.OntologyPublishRecord.class::isInstance).count());
        BackendException rejected = outcomes.stream().filter(BackendException.class::isInstance)
                .map(BackendException.class::cast).findFirst().orElseThrow();
        assertEquals("ONTOLOGY_PUBLISH_CONFLICT", rejected.code());
        assertEquals(1L, count("platform.ontology_publish_records"));
        assertEquals(1L, jdbc.queryForObject("select count(*) from platform.ontology_versions "
                + "where status='approved' and published_at is not null", Long.class));
    }

    @Test
    void auditFailureRollsBackCreateReviewAndPublishMutations() {
        String versionId = version("rollback-create", "draft", null, Instant.now());
        assertThrows(RuntimeException.class,
                () -> governance.create(change(versionId, "create"), actor("ONTOLOGY_AUTHOR"), "rollback-create"));
        assertEquals(0L, count("platform.ontology_change_requests"));

        var request = governance.create(change(versionId, "review"), actor("ONTOLOGY_AUTHOR"), "trace-create");
        governance.submit(request.id(), actor("ONTOLOGY_AUTHOR"), "trace-submit");
        assertThrows(RuntimeException.class, () -> governance.review(request.id(),
                new ReviewChangeRequest("approved", "同意"), actor("ONTOLOGY_APPROVER"), "rollback-review"));
        assertEquals("submitted", value("select status from platform.ontology_change_requests where id=?", request.id()));
        assertEquals(0L, count("platform.ontology_approval_records"));

        jdbc.update("update platform.ontology_versions set status='approved' where id=?", versionId);
        var approved = governance.review(request.id(), new ReviewChangeRequest("approved", "同意"),
                actor("ONTOLOGY_APPROVER"), "trace-review").changeRequest();
        seedCompleteOntology(versionId, "rollback");
        String previousId = version("rollback-previous", "approved", Instant.now().minusSeconds(30),
                Instant.now().minusSeconds(60));
        assertThrows(RuntimeException.class, () -> governance.publish(versionId, null,
                actor("ONTOLOGY_PUBLISHER"), "rollback-publish"));
        assertNull(value("select published_at from platform.ontology_versions where id=?", versionId));
        assertEquals("approved", value("select status from platform.ontology_versions where id=?", previousId));
        assertNull(value("select deprecated_at from platform.ontology_versions where id=?", previousId));
        assertEquals("approved", value("select status from platform.ontology_change_requests where id=?", approved.id()));
        assertEquals(0L, count("platform.ontology_publish_records"));
        assertEquals(0L, jdbc.queryForObject("select count(*) from platform.audit_events where correlation_id like 'rollback-%'",
                Long.class));
    }

    private GovernanceResponses.OntologyChangeRequest approvedRequest(String versionId, String label) {
        var request = governance.create(change(versionId, label), actor("ONTOLOGY_AUTHOR"), "trace-create-" + label);
        governance.submit(request.id(), actor("ONTOLOGY_AUTHOR"), "trace-submit-" + label);
        return governance.review(request.id(), new ReviewChangeRequest("approved", "同意"),
                actor("ONTOLOGY_APPROVER"), "trace-review-" + label).changeRequest();
    }

    private Object publishAfterBarrier(String versionId, CyclicBarrier barrier) throws Exception {
        barrier.await();
        try {
            return governance.publish(versionId, null, actor("ONTOLOGY_PUBLISHER"),
                    "trace-concurrent-" + UUID.randomUUID());
        } catch (RuntimeException error) {
            return error;
        }
    }

    private void seedCompleteOntology(String versionId, String label) {
        Instant now = Instant.now();
        Timestamp timestamp = Timestamp.from(now);
        String key = label + "-" + suffix;
        jdbc.update("""
                insert into platform.ontology_entity_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,synonyms,parent_business_key,metadata,created_at,updated_at)
                values (?,?,'project','项目','收费分析的项目主体','approved',array[]::text[],null,'{}',?,?)
                """, "seed-entity-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_metric_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,default_aggregation,unit,metadata,created_at,updated_at)
                values (?,?,'collection-rate','项目收缴率','实收金额与应收金额的比率','approved',array['project'],'ratio','%','{}',?,?)
                """, "seed-metric-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_metric_variants
                  (id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at)
                values (?,?,'collection-rate','project-collection-rate','项目收缴率','项目口径比率','approved','project-scope',
                  cast('{"numeratorMetricKey":"project-paid-amount","denominatorMetricKey":"project-receivable-amount","formula":"project-paid-amount / project-receivable-amount * 100"}' as jsonb),'{}','{}',?,?),
                  (?,?,'collection-rate','project-paid-amount','项目实收金额','Cube 实收指标','approved','project-scope',
                  cast('{"cubeMeasure":"FinancePayments.paidAmount"}' as jsonb),'{}','{}',?,?),
                  (?,?,'collection-rate','project-receivable-amount','项目应收金额','Cube 应收指标','approved','project-scope',
                  cast('{"cubeMeasure":"FinanceReceivables.receivableAmount"}' as jsonb),'{}','{}',?,?)
                """, "seed-variant-rate-" + key, versionId, timestamp, timestamp,
                "seed-variant-paid-" + key, versionId, timestamp, timestamp,
                "seed-variant-receivable-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_factor_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,category,related_metric_keys,metadata,created_at,updated_at)
                values (?,?,'collection-coverage','催缴覆盖','候选运营因素','approved','operation',array['collection-rate'],'{}',?,?)
                """, "seed-factor-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_causality_edges
                  (id,ontology_version_id,business_key,display_name,description,status,source_entity_key,target_entity_key,causality_type,is_attribution_path_enabled,default_weight,neo4j_relationship_types,temporal_constraints,filter_conditions,metadata,created_at,updated_at)
                values (?,?,'project-collection-rate-path','项目与收缴率关系','归因候选路径','approved','project','collection-rate','influences',true,
                  cast('{"type":"fixed","value":1}' as jsonb),array['INFLUENCES'],null,null,'{}',?,?)
                """, "seed-edge-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_plan_step_templates
                  (id,ontology_version_id,business_key,display_name,description,status,intent_types,required_capabilities,sort_order,metadata,created_at,updated_at)
                values (?,?,'confirm-analysis-scope','确认分析范围','校验范围与本体绑定','approved',array['fee-analysis'],array['capability-status'],1,'{}',?,?),
                  (?,?,'inspect-metric-change','检查指标变化','读取受治理指标','approved',array['fee-analysis'],array['semantic-query'],2,'{}',?,?),
                  (?,?,'validate-candidate-factors','验证候选因素','读取业务事实与图谱关系','approved',array['fee-analysis'],array['semantic-query','graph-query','erp-read'],3,'{}',?,?),
                  (?,?,'synthesize-attribution','生成归因结论','基于证据生成结论','approved',array['fee-analysis'],array['semantic-query','structured-analysis'],4,'{}',?,?)
                """, "seed-step-confirm-" + key, versionId, timestamp, timestamp,
                "seed-step-inspect-" + key, versionId, timestamp, timestamp,
                "seed-step-validate-" + key, versionId, timestamp, timestamp,
                "seed-step-synthesize-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_tool_capability_bindings
                  (id,ontology_version_id,bound_step_template_key,bound_capability_tag,tool_name,activation_conditions,description,status,priority,created_at,updated_at,created_by)
                values (?,?,'inspect-metric-change','semantic-query','cube.semantic-query',
                  cast('[{"type":"metric-present","metricKey":"collection-rate"}]' as jsonb),'Cube 语义查询','approved',100,?,?,?),
                  (?,?, 'validate-candidate-factors','erp-read','erp.read-model',
                  cast('[{"type":"always","value":true}]' as jsonb),'ERP 事实读取','approved',100,?,?,?),
                  (?,?, 'validate-candidate-factors','graph-query','neo4j.graph-query',
                  cast('[{"type":"always","value":true}]' as jsonb),'Neo4j 关系查询','approved',100,?,?,?),
                  (?,?, 'synthesize-attribution','llm-analysis','llm.structured-analysis',
                  cast('[{"type":"always","value":true}]' as jsonb),'结构化结论生成','approved',100,?,?,?)
                """, "seed-tool-" + key, versionId, now.toString(), now.toString(), "test",
                "seed-tool-erp-" + key, versionId, now.toString(), now.toString(), "test",
                "seed-tool-neo4j-" + key, versionId, now.toString(), now.toString(), "test",
                "seed-tool-llm-" + key, versionId, now.toString(), now.toString(), "test");
        jdbc.update("""
                insert into platform.ontology_time_semantics
                  (id,ontology_version_id,business_key,display_name,description,status,semantic_type,entity_date_field_mapping,cube_time_dimension_mapping,calculation_rule,default_granularity,metadata,created_at,updated_at)
                values (?,?,'receivable-accounting-period','应收会计期间','应收确认期间','approved','accounting-period',
                  cast('{"receivable":"shouldAccountBook"}' as jsonb),cast('{"cubeDimension":"FinanceReceivables.receivableAccountingPeriod"}' as jsonb),null,'year','{}',?,?),
                  (?,?,'payment-date','缴款日期','实收交易日期','approved','transaction-date',
                  cast('{"payment":"operatorDate"}' as jsonb),cast('{"cubeDimension":"FinancePayments.paymentDate"}' as jsonb),null,'month','{}',?,?)
                """, "seed-time-receivable-" + key, versionId, timestamp, timestamp,
                "seed-time-payment-" + key, versionId, timestamp, timestamp);
        jdbc.update("""
                insert into platform.ontology_evidence_type_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,evidence_category,renderer_config,data_source_config,default_priority,is_interactive,template_schema,validation_rules,metadata,created_at,updated_at)
                values (?,?,'collection-rate-evidence','收缴率证据','受治理的数据源证据','approved','metric','{}','{}','high','false',null,'[]','{}',?,?)
                """, "seed-evidence-" + key, versionId, timestamp, timestamp);
    }

    private void assertPublishDidNotMutate(String previousId, String targetId) {
        assertEquals("approved", value("select status from platform.ontology_versions where id=?", previousId));
        assertNotNull(value("select published_at from platform.ontology_versions where id=?", previousId));
        assertNull(value("select deprecated_at from platform.ontology_versions where id=?", previousId));
        assertNull(value("select published_at from platform.ontology_versions where id=?", targetId));
        assertEquals(0L, count("platform.ontology_publish_records"));
    }

    private CreateChangeRequest change(String versionId, String label) {
        return new CreateChangeRequest(versionId, "metric_definition", "metric-" + label, "update",
                "更新指标 " + label, "说明", Map.of("formula", "old"), Map.of("formula", "new"),
                List.of("metric-" + label), "backward_compatible", "兼容");
    }

    private String version(String label, String status, Instant publishedAt, Instant createdAt) {
        String id = label + "-" + suffix;
        jdbc.update("""
                insert into platform.ontology_versions
                  (id,semver,display_name,status,description,published_at,deprecated_at,retired_at,created_by,created_at,updated_at)
                values (?,?,?,?,'测试版本',?,null,null,'test',?,?)
                """, id, "99.0." + Math.abs(label.hashCode()), label, status,
                publishedAt == null ? null : Timestamp.from(publishedAt), Timestamp.from(createdAt), Timestamp.from(createdAt));
        return id;
    }

    private AuthSession actor(String role) {
        return new AuthSession("session-" + suffix, "user-" + role + "-" + suffix, "用户",
                new AccessScope("org-" + suffix, List.of(), List.of(), List.of(role)), Instant.MAX);
    }

    private long count(String table) {
        return jdbc.queryForObject("select count(*) from " + table, Long.class);
    }

    private Object value(String sql, String id) {
        return jdbc.queryForObject(sql, Object.class, id);
    }

    private static List<String> sortedKeys(Map<?, ?> value) {
        return value.keySet().stream().map(Object::toString).sorted().toList();
    }
}
