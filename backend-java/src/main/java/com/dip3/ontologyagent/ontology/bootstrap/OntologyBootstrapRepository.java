package com.dip3.ontologyagent.ontology.bootstrap;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ontology.governance.OntologyGovernanceMapper;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.sql.Timestamp;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Repository
public class OntologyBootstrapRepository {
    private static final String VERSION = CanonicalOntologyBaseline.VERSION_ID;
    private final JdbcTemplate jdbc;
    private final JsonCodec json;
    private final OntologyGovernanceMapper governance;

    public OntologyBootstrapRepository(JdbcTemplate jdbc, JsonCodec json, OntologyGovernanceMapper governance) {
        this.jdbc = jdbc;
        this.json = json;
        this.governance = governance;
    }

    void lock() {
        jdbc.query("select pg_advisory_xact_lock(hashtextextended('ontology-baseline-bootstrap',0))", rs -> {});
    }

    RegistrySnapshot snapshot() {
        return jdbc.queryForObject("""
                select
                  (select count(*) from platform.ontology_versions) versions,
                  (select count(*) from platform.ontology_entity_definitions) entities,
                  (select count(*) from platform.ontology_metric_definitions) metrics,
                  (select count(*) from platform.ontology_metric_variants) metric_variants,
                  (select count(*) from platform.ontology_factor_definitions) factors,
                  (select count(*) from platform.ontology_causality_edges) causality_edges,
                  (select count(*) from platform.ontology_plan_step_templates) plan_steps,
                  (select count(*) from platform.ontology_tool_capability_bindings) tool_bindings,
                  (select count(*) from platform.ontology_time_semantics) time_semantics,
                  (select count(*) from platform.ontology_evidence_type_definitions) evidence_types,
                  (select count(*) from platform.ontology_change_requests) change_requests,
                  (select count(*) from platform.ontology_approval_records) approvals,
                  (select count(*) from platform.ontology_publish_records) publishes,
                  (select count(*) from platform.ontology_grounded_contexts) grounded_contexts
                """, (rs, row) -> new RegistrySnapshot(Map.ofEntries(
                Map.entry("versions", rs.getLong("versions")),
                Map.entry("entities", rs.getLong("entities")),
                Map.entry("metrics", rs.getLong("metrics")),
                Map.entry("metricVariants", rs.getLong("metric_variants")),
                Map.entry("factors", rs.getLong("factors")),
                Map.entry("causalityEdges", rs.getLong("causality_edges")),
                Map.entry("planStepTemplates", rs.getLong("plan_steps")),
                Map.entry("toolBindings", rs.getLong("tool_bindings")),
                Map.entry("timeSemantics", rs.getLong("time_semantics")),
                Map.entry("evidenceTypes", rs.getLong("evidence_types")),
                Map.entry("changeRequests", rs.getLong("change_requests")),
                Map.entry("approvals", rs.getLong("approvals")),
                Map.entry("publishes", rs.getLong("publishes")),
                Map.entry("groundedContexts", rs.getLong("grounded_contexts")))));
    }

    List<CurrentVersion> currentVersions() {
        return jdbc.query("""
                select id,semver from platform.ontology_versions
                where status='approved' and published_at is not null order by id
                """, (rs, row) -> new CurrentVersion(rs.getString("id"), rs.getString("semver")));
    }

    Map<String, Long> definitionCounts(String versionId) {
        return jdbc.queryForObject("""
                select
                  (select count(*) from platform.ontology_entity_definitions where ontology_version_id=?) entities,
                  (select count(*) from platform.ontology_metric_definitions where ontology_version_id=?) metrics,
                  (select count(*) from platform.ontology_metric_variants where ontology_version_id=?) metric_variants,
                  (select count(*) from platform.ontology_factor_definitions where ontology_version_id=?) factors,
                  (select count(*) from platform.ontology_causality_edges where ontology_version_id=?) causality_edges,
                  (select count(*) from platform.ontology_plan_step_templates where ontology_version_id=?) plan_steps,
                  (select count(*) from platform.ontology_tool_capability_bindings where ontology_version_id=?) tool_bindings,
                  (select count(*) from platform.ontology_time_semantics where ontology_version_id=?) time_semantics,
                  (select count(*) from platform.ontology_evidence_type_definitions where ontology_version_id=?) evidence_types
                """, (rs, row) -> {
            Map<String, Long> counts = new LinkedHashMap<>();
            counts.put("entities", rs.getLong("entities"));
            counts.put("metrics", rs.getLong("metrics"));
            counts.put("metricVariants", rs.getLong("metric_variants"));
            counts.put("factors", rs.getLong("factors"));
            counts.put("causalityEdges", rs.getLong("causality_edges"));
            counts.put("planStepTemplates", rs.getLong("plan_steps"));
            counts.put("toolBindings", rs.getLong("tool_bindings"));
            counts.put("timeSemantics", rs.getLong("time_semantics"));
            counts.put("evidenceTypes", rs.getLong("evidence_types"));
            return Map.copyOf(counts);
        }, versionId, versionId, versionId, versionId, versionId, versionId, versionId, versionId, versionId);
    }

    List<String> integrityIssues(String versionId) {
        return governance.publishIntegrityIssues(versionId);
    }

    long publishRecordCount(String versionId) {
        Long count = jdbc.queryForObject(
                "select count(*) from platform.ontology_publish_records where ontology_version_id=?",
                Long.class, versionId);
        return count == null ? 0 : count;
    }

    void insertBaseline(String actorId, Instant now) {
        insertVersion(actorId, now);
        insertDefinitions(actorId, now);
        requireOne(jdbc.update("""
                insert into platform.ontology_publish_records
                  (id,ontology_version_id,published_by,previous_version_id,change_request_ids,publish_note,created_at)
                values ('publish-ontology-java-baseline-v1',?, ?,null,array[]::text[],
                  'Java canonical runtime baseline bootstrap',?)
                """, VERSION, actorId, at(now)), "发布记录");
    }

    void audit(AuthSession actor, String correlationId, Instant now) {
        int changed = jdbc.update("""
                insert into platform.audit_events
                  (id,user_id,organization_id,session_id,event_type,event_result,event_source,correlation_id,
                   payload,created_at,retention_until)
                values (?,?,?,?, 'ontology.baseline.bootstrapped','succeeded','application',?,cast(? as jsonb),?,?)
                """, UUID.randomUUID().toString(), actor.userId(), actor.scope().organizationId(), actor.sessionId(),
                correlationId, json.write(Map.of("ontologyVersionId", VERSION,
                        "semver", CanonicalOntologyBaseline.SEMVER)), at(now), at(now.plus(180, ChronoUnit.DAYS)));
        requireOne(changed, "审计记录");
    }

    private void insertVersion(String actorId, Instant now) {
        requireOne(jdbc.update("""
                insert into platform.ontology_versions
                  (id,semver,display_name,status,description,published_at,created_by,created_at,updated_at)
                values (?,?,'Java 分析运行时基线','approved',
                  'Java Main Agent 与 Workflow 的首个受治理固定语义版本。',?,?,?,?)
                """, VERSION, CanonicalOntologyBaseline.SEMVER, at(now), actorId, at(now), at(now)), "本体版本");
    }

    private void insertDefinitions(String actorId, Instant now) {
        requireOne(jdbc.update("""
                insert into platform.ontology_entity_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,synonyms,parent_business_key,metadata,created_at,updated_at)
                values ('entity-project-java-v1',?,'project','项目','物业分析的授权项目实体。','approved',
                  array['小区'],null,'{"isPrimarySubject":true,"intentTypes":["fee-analysis"]}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "实体定义");
        requireOne(jdbc.update("""
                insert into platform.ontology_metric_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,default_aggregation,unit,metadata,created_at,updated_at)
                values ('metric-collection-rate-java-v1',?,'collection-rate','收缴率','项目实收除以项目应收并乘以 100。',
                  'approved',array['project'],'ratio','%','{"intentTypes":["fee-analysis"],"hasVariants":true}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "指标定义");
        insertMetricVariants(now);
        requireOne(jdbc.update("""
                insert into platform.ontology_factor_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,category,related_metric_keys,metadata,created_at,updated_at)
                values ('factor-charge-item-java-v1',?,'charge-item-structure','收费项目结构','收费项目与应收、实收事实的结构关系。',
                  'approved','structure',array['collection-rate'],'{"intentTypes":["fee-analysis"]}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "因素定义");
        requireOne(jdbc.update("""
                insert into platform.ontology_causality_edges
                  (id,ontology_version_id,business_key,display_name,description,status,source_entity_key,target_entity_key,
                   causality_type,is_attribution_path_enabled,default_weight,neo4j_relationship_types,temporal_constraints,
                   filter_conditions,metadata,created_at,updated_at)
                values ('edge-charge-item-collection-rate-java-v1',?,'charge-item-structure-collection-rate',
                  '收费项目结构到收缴率','仅表示可查证的候选关系，不作为因果证明。','approved','charge-item-structure',
                  'collection-rate','candidate-influence',true,'{"type":"fixed","value":1}'::jsonb,array['GRAPH_EDGE'],
                  null,null,'{"intentTypes":["fee-analysis"]}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "因果边");
        insertPlanSteps(now);
        insertToolBindings(actorId, now);
        insertTimeSemantics(now);
        insertEvidenceTypes(now);
    }

    private void insertMetricVariants(Instant now) {
        String sql = """
                insert into platform.ontology_metric_variants
                  (id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,
                   semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at)
                values (?,?, 'collection-rate',?,?,?,?, 'project-scope',cast(? as jsonb),null,'{}'::jsonb,?,?)
                """;
        requireOne(jdbc.update(sql, "variant-project-collection-rate-java-v1", VERSION,
                "project-collection-rate", "项目口径收缴率", "项目实收 / 项目应收 × 100。", "approved",
                json.write(Map.of("numeratorMetricKey", "project-paid-amount",
                        "denominatorMetricKey", "project-receivable-amount",
                        "formula", "project-paid-amount / project-receivable-amount * 100")), at(now), at(now)), "收缴率变体");
        requireOne(jdbc.update(sql, "variant-project-paid-amount-java-v1", VERSION,
                "project-paid-amount", "项目口径实收金额", "按缴款日期统计项目实收。", "approved",
                json.write(Map.of("cubeMeasure", "FinancePayments.paidAmount")), at(now), at(now)), "实收变体");
        requireOne(jdbc.update(sql, "variant-project-receivable-amount-java-v1", VERSION,
                "project-receivable-amount", "项目口径应收金额", "按应收账期统计项目应收。", "approved",
                json.write(Map.of("cubeMeasure", "FinanceReceivables.receivableAmount")), at(now), at(now)), "应收变体");
    }

    private void insertPlanSteps(Instant now) {
        String sql = """
                insert into platform.ontology_plan_step_templates
                  (id,ontology_version_id,business_key,display_name,description,status,intent_types,required_capabilities,
                   sort_order,metadata,created_at,updated_at)
                values (?,?,?, ?,?,'approved',array['fee-analysis'],string_to_array(?,','),?,'{}'::jsonb,?,?)
                """;
        requireOne(jdbc.update(sql, "step-confirm-analysis-scope-java-v1", VERSION, "confirm-analysis-scope",
                "确认分析范围", "校验权限范围与本体绑定。", "capability-status", 1, at(now), at(now)), "计划步骤 1");
        requireOne(jdbc.update(sql, "step-inspect-metric-change-java-v1", VERSION, "inspect-metric-change",
                "校验指标波动", "读取受治理 Cube 指标。", "semantic-query", 2, at(now), at(now)), "计划步骤 2");
        requireOne(jdbc.update(sql, "step-validate-candidate-factors-java-v1", VERSION,
                "validate-candidate-factors", "查证候选因素", "读取 ERP 与 Neo4j 关系证据。",
                "semantic-query,graph-query,erp-read", 3, at(now), at(now)), "计划步骤 3");
        requireOne(jdbc.update(sql, "step-synthesize-attribution-java-v1", VERSION, "synthesize-attribution",
                "汇总结论", "仅基于已取得证据生成结构化结论。", "semantic-query,structured-analysis", 4,
                at(now), at(now)), "计划步骤 4");
    }

    private void insertToolBindings(String actorId, Instant now) {
        String sql = """
                insert into platform.ontology_tool_capability_bindings
                  (id,ontology_version_id,bound_step_template_key,bound_capability_tag,tool_name,activation_conditions,
                   description,status,priority,created_at,updated_at,created_by)
                values (?,?,?,?,?,'[{"type":"always","value":true}]'::jsonb,?,'approved',100,?,?,?)
                """;
        String timestamp = now.toString();
        requireOne(jdbc.update(sql, "binding-erp-java-v1", VERSION, "validate-candidate-factors", "erp-read",
                "erp.read-model", "受范围约束的 ERP 事实读取。", timestamp, timestamp, actorId), "ERP 工具绑定");
        requireOne(jdbc.update(sql, "binding-cube-java-v1", VERSION, "inspect-metric-change", "semantic-query",
                "cube.semantic-query", "受治理 Cube 语义查询。", timestamp, timestamp, actorId), "Cube 工具绑定");
        requireOne(jdbc.update(sql, "binding-neo4j-java-v1", VERSION, "validate-candidate-factors", "graph-query",
                "neo4j.graph-query", "组织隔离的图谱关系查询。", timestamp, timestamp, actorId), "Neo4j 工具绑定");
        requireOne(jdbc.update(sql, "binding-llm-java-v1", VERSION, "synthesize-attribution", "llm-analysis",
                "llm.structured-analysis", "结构化且带证据引用的模型结论。", timestamp, timestamp, actorId), "LLM 工具绑定");
    }

    private void insertTimeSemantics(Instant now) {
        String sql = """
                insert into platform.ontology_time_semantics
                  (id,ontology_version_id,business_key,display_name,description,status,semantic_type,
                   entity_date_field_mapping,cube_time_dimension_mapping,calculation_rule,default_granularity,
                   metadata,created_at,updated_at)
                values (?,?,?,?,?,'approved',?,cast(? as jsonb),cast(? as jsonb),null,?,'{}'::jsonb,?,?)
                """;
        requireOne(jdbc.update(sql, "time-receivable-accounting-period-java-v1", VERSION,
                "receivable-accounting-period", "应收账期", "按 shouldAccountBook 圈定应收。", "accounting-period",
                json.write(Map.of("receivable", "shouldAccountBook")),
                json.write(Map.of("cubeDimension", "FinanceReceivables.receivableAccountingPeriod")),
                "year", at(now), at(now)), "应收时间语义");
        requireOne(jdbc.update(sql, "time-payment-date-java-v1", VERSION, "payment-date", "缴款日期",
                "按 operatorDate 统计实收。", "transaction-date",
                json.write(Map.of("payment", "operatorDate")),
                json.write(Map.of("cubeDimension", "FinancePayments.paymentDate")),
                "month", at(now), at(now)), "实收时间语义");
    }

    private void insertEvidenceTypes(Instant now) {
        String sql = """
                insert into platform.ontology_evidence_type_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,evidence_category,
                   renderer_config,data_source_config,default_priority,is_interactive,template_schema,
                   validation_rules,metadata,created_at,updated_at)
                values (?,?,?,?,?,'approved',?,cast(? as jsonb),cast(? as jsonb),?,cast(? as jsonb),null,
                  cast(? as jsonb),'{}'::jsonb,?,?)
                """;
        evidence(sql, "evidence-erp-java-v1", "erp-fact-evidence", "ERP 事实证据", "授权范围内的业务事实。",
                "factual", Map.of("type", "data-table"), Map.of("adapter", "erp-staging-query"), "high", now);
        evidence(sql, "evidence-cube-java-v1", "cube-metric-evidence", "Cube 指标证据", "受治理的量化指标。",
                "quantitative", Map.of("type", "metric-table"), Map.of("adapter", "cube-semantic-query"), "high", now);
        evidence(sql, "evidence-neo4j-java-v1", "graph-relation-evidence", "图谱关系证据", "候选结构关系，不作为因果证明。",
                "relational", Map.of("type", "relation-table"), Map.of("adapter", "neo4j-graph-query"), "normal", now);
        evidence(sql, "evidence-llm-java-v1", "grounded-conclusion-evidence", "受控模型结论", "带真实证据引用的结构化结论。",
                "qualitative", Map.of("type", "markdown-block"), Map.of("adapter", "llm-structured-output"), "normal", now);
    }

    private void evidence(String sql, String id, String key, String name, String description, String category,
                          Map<String, Object> renderer, Map<String, Object> source, String priority, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, key, name, description, category, json.write(renderer),
                json.write(source), priority, json.write(false), json.write(List.of()), at(now), at(now)), "证据类型 " + key);
    }

    private static void requireOne(int changed, String target) {
        if (changed != 1) throw new BackendException("ONTOLOGY_BOOTSTRAP_WRITE_FAILED", target + "写入失败。");
    }

    private static Timestamp at(Instant instant) {
        return Timestamp.from(instant);
    }

    record CurrentVersion(String id, String semver) {}

    record RegistrySnapshot(Map<String, Long> counts) {
        boolean empty() { return counts.values().stream().allMatch(value -> value == 0); }
    }
}
