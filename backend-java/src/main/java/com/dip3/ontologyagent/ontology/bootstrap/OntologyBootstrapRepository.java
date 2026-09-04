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

    boolean versionExists(String versionId) {
        Boolean exists = jdbc.queryForObject(
                "select exists(select 1 from platform.ontology_versions where id=?)", Boolean.class, versionId);
        return Boolean.TRUE.equals(exists);
    }

    void insertBaseline(String actorId, Instant now) {
        insertVersion(VERSION, CanonicalOntologyBaseline.SEMVER, actorId, now);
        insertDefinitions(actorId, now);
    }

    void insertLegacyUpgrade(String actorId, Instant now) {
        insertVersion(VERSION, CanonicalOntologyBaseline.SEMVER, actorId, now);
        copyLegacyDefinitions(now);
        insertEasyvDefinitions(actorId, now);
    }

    private void copyLegacyDefinitions(Instant now) {
        copyLegacy("ontology_entity_definitions",
                "id,ontology_version_id,business_key,display_name,description,status,synonyms,parent_business_key,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,synonyms,parent_business_key,metadata,created_at,updated_at");
        copyLegacy("ontology_metric_definitions",
                "id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,default_aggregation,unit,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,applicable_subject_keys,default_aggregation,unit,metadata,created_at,updated_at");
        copyLegacy("ontology_metric_variants",
                "id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at",
                "id,?,case when exists (select 1 from platform.ontology_metric_definitions d "
                        + "where d.ontology_version_id='ontology-java-baseline-v1' and d.id=parent_metric_definition_id) "
                        + "then concat('v2-',parent_metric_definition_id) else parent_metric_definition_id end,"
                        + "business_key,display_name,description,status,semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at");
        copyLegacy("ontology_factor_definitions",
                "id,ontology_version_id,business_key,display_name,description,status,category,related_metric_keys,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,category,related_metric_keys,metadata,created_at,updated_at");
        copyLegacy("ontology_causality_edges",
                "id,ontology_version_id,business_key,display_name,description,status,source_entity_key,target_entity_key,causality_type,is_attribution_path_enabled,default_weight,neo4j_relationship_types,temporal_constraints,filter_conditions,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,source_entity_key,target_entity_key,causality_type,is_attribution_path_enabled,default_weight,neo4j_relationship_types,temporal_constraints,filter_conditions,metadata,created_at,updated_at");
        copyLegacy("ontology_plan_step_templates",
                "id,ontology_version_id,business_key,display_name,description,status,intent_types,required_capabilities,sort_order,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,intent_types,required_capabilities,sort_order,metadata,created_at,updated_at");
        copyLegacy("ontology_tool_capability_bindings",
                "id,ontology_version_id,bound_step_template_key,bound_capability_tag,tool_name,activation_conditions,description,status,priority,created_at,updated_at,created_by",
                "id,?,bound_step_template_key,bound_capability_tag,tool_name,activation_conditions,description,status,priority,created_at,updated_at,created_by");
        copyLegacy("ontology_time_semantics",
                "id,ontology_version_id,business_key,display_name,description,status,semantic_type,entity_date_field_mapping,cube_time_dimension_mapping,calculation_rule,default_granularity,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,semantic_type,entity_date_field_mapping,cube_time_dimension_mapping,calculation_rule,default_granularity,metadata,created_at,updated_at");
        copyLegacy("ontology_evidence_type_definitions",
                "id,ontology_version_id,business_key,display_name,description,status,evidence_category,renderer_config,data_source_config,default_priority,is_interactive,template_schema,validation_rules,metadata,created_at,updated_at",
                "id,?,business_key,display_name,description,status,evidence_category,renderer_config,data_source_config,default_priority,is_interactive,template_schema,validation_rules,metadata,created_at,updated_at");
    }

    private void copyLegacy(String table, String columns, String selectedColumns) {
        String sourceId = CanonicalOntologyBaseline.LEGACY_VERSION_ID;
        String targetId = CanonicalOntologyBaseline.VERSION_ID;
        String select = selectedColumns.replaceFirst("^id", "concat('v2-',id)");
        int copied = jdbc.update("insert into platform." + table + " (" + columns + ") "
                + "select " + select + " from platform." + table + " where ontology_version_id=?", targetId, sourceId);
        if (copied == 0) {
            throw new BackendException("ONTOLOGY_BOOTSTRAP_WRITE_FAILED", "复制旧本体定义失败：" + table);
        }
    }

    void publishBaseline(String previousVersionId, String actorId, Instant now) {
        if (previousVersionId != null) {
            requireOne(jdbc.update("""
                    update platform.ontology_versions
                    set status='deprecated',deprecated_at=?,updated_at=?
                    where id=? and status='approved' and published_at is not null
                    """, at(now), at(now), previousVersionId), "旧本体版本退役");
        }
        requireOne(jdbc.update("""
                update platform.ontology_versions
                set published_at=?,updated_at=?
                where id=? and status='approved' and published_at is null
                """, at(now), at(now), VERSION), "新本体版本发布");
        requireOne(jdbc.update("""
                insert into platform.ontology_publish_records
                  (id,ontology_version_id,published_by,previous_version_id,change_request_ids,publish_note,created_at)
                values ('publish-ontology-java-multidomain-v2',?, ?,?,array[]::text[],
                  'Java multidomain catalog baseline bootstrap',?)
                """, VERSION, actorId, previousVersionId, at(now)), "发布记录");
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

    private void insertVersion(String versionId, String semver, String actorId, Instant now) {
        requireOne(jdbc.update("""
                insert into platform.ontology_versions
                  (id,semver,display_name,status,description,created_by,created_at,updated_at)
                values (?,?,'Java 分析运行时基线','approved',
                  'Java Main Agent 与 Workflow 的受治理固定语义版本。',?,?,?)
                """, versionId, semver, actorId, at(now), at(now)), "本体版本");
    }

    private void insertDefinitions(String actorId, Instant now) {
        requireOne(jdbc.update("""
                insert into platform.ontology_entity_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,synonyms,parent_business_key,metadata,created_at,updated_at)
                values ('entity-project-java-v2',?,'project','项目','物业分析的授权项目实体。','approved',
                  array['小区'],null,'{"isPrimarySubject":true,"intentTypes":["fee-analysis"]}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "实体定义");
        requireOne(jdbc.update("""
                insert into platform.ontology_metric_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,default_aggregation,unit,metadata,created_at,updated_at)
                values ('metric-collection-rate-java-v2',?,'collection-rate','收缴率','项目实收除以项目应收并乘以 100。',
                  'approved',array['project'],'ratio','%','{"intentTypes":["fee-analysis"],"hasVariants":true}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "指标定义");
        insertMetricVariants(now);
        requireOne(jdbc.update("""
                insert into platform.ontology_factor_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,category,related_metric_keys,metadata,created_at,updated_at)
                values ('factor-charge-item-java-v2',?,'charge-item-structure','收费项目结构','收费项目与应收、实收事实的结构关系。',
                  'approved','structure',array['collection-rate'],'{"intentTypes":["fee-analysis"]}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "因素定义");
        requireOne(jdbc.update("""
                insert into platform.ontology_causality_edges
                  (id,ontology_version_id,business_key,display_name,description,status,source_entity_key,target_entity_key,
                   causality_type,is_attribution_path_enabled,default_weight,neo4j_relationship_types,temporal_constraints,
                   filter_conditions,metadata,created_at,updated_at)
                values ('edge-charge-item-collection-rate-java-v2',?,'charge-item-structure-collection-rate',
                  '收费项目结构到收缴率','仅表示可查证的候选关系，不作为因果证明。','approved','charge-item-structure',
                  'collection-rate','candidate-influence',true,'{"type":"fixed","value":1}'::jsonb,array['GRAPH_EDGE'],
                  null,null,'{"intentTypes":["fee-analysis"]}'::jsonb,?,?)
                """, VERSION, at(now), at(now)), "因果边");
        insertPlanSteps(now);
        insertToolBindings(actorId, now);
        insertTimeSemantics(now);
        insertEvidenceTypes(now);
        insertEasyvDefinitions(actorId, now);
    }

    private void insertMetricVariants(Instant now) {
        String sql = """
                insert into platform.ontology_metric_variants
                  (id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,
                   semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at)
                values (?,?, 'collection-rate',?,?,?,?, 'project-scope',cast(? as jsonb),null,'{}'::jsonb,?,?)
                """;
        requireOne(jdbc.update(sql, "variant-project-collection-rate-java-v2", VERSION,
                "project-collection-rate", "项目口径收缴率", "项目实收 / 项目应收 × 100。", "approved",
                json.write(Map.of("numeratorMetricKey", "project-paid-amount",
                        "denominatorMetricKey", "project-receivable-amount",
                        "formula", "project-paid-amount / project-receivable-amount * 100")), at(now), at(now)), "收缴率变体");
        requireOne(jdbc.update(sql, "variant-project-paid-amount-java-v2", VERSION,
                "project-paid-amount", "项目口径实收金额", "按缴款日期统计项目实收。", "approved",
                json.write(Map.of("cubeMeasure", "FinancePayments.paidAmount")), at(now), at(now)), "实收变体");
        requireOne(jdbc.update(sql, "variant-project-receivable-amount-java-v2", VERSION,
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
        requireOne(jdbc.update(sql, "step-confirm-analysis-scope-java-v2", VERSION, "confirm-analysis-scope",
                "确认分析范围", "校验权限范围与本体绑定。", "capability-status", 1, at(now), at(now)), "计划步骤 1");
        requireOne(jdbc.update(sql, "step-inspect-metric-change-java-v2", VERSION, "inspect-metric-change",
                "校验指标波动", "读取受治理 Cube 指标。", "semantic-query", 2, at(now), at(now)), "计划步骤 2");
        requireOne(jdbc.update(sql, "step-validate-candidate-factors-java-v2", VERSION,
                "validate-candidate-factors", "查证候选因素", "读取 ERP 与 Neo4j 关系证据。",
                "semantic-query,graph-query,erp-read", 3, at(now), at(now)), "计划步骤 3");
        requireOne(jdbc.update(sql, "step-synthesize-attribution-java-v2", VERSION, "synthesize-attribution",
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
        requireOne(jdbc.update(sql, "binding-erp-java-v2", VERSION, "validate-candidate-factors", "erp-read",
                "erp.read-model", "受范围约束的 ERP 事实读取。", timestamp, timestamp, actorId), "ERP 工具绑定");
        requireOne(jdbc.update(sql, "binding-cube-java-v2", VERSION, "inspect-metric-change", "semantic-query",
                "cube.semantic-query", "受治理 Cube 语义查询。", timestamp, timestamp, actorId), "Cube 工具绑定");
        requireOne(jdbc.update(sql, "binding-neo4j-java-v2", VERSION, "validate-candidate-factors", "graph-query",
                "neo4j.graph-query", "组织隔离的图谱关系查询。", timestamp, timestamp, actorId), "Neo4j 工具绑定");
        requireOne(jdbc.update(sql, "binding-llm-java-v2", VERSION, "synthesize-attribution", "llm-analysis",
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
        requireOne(jdbc.update(sql, "time-receivable-accounting-period-java-v2", VERSION,
                "receivable-accounting-period", "应收账期", "按 shouldAccountBook 圈定应收。", "accounting-period",
                json.write(Map.of("receivable", "shouldAccountBook")),
                json.write(Map.of("cubeDimension", "FinanceReceivables.receivableAccountingPeriod")),
                "year", at(now), at(now)), "应收时间语义");
        requireOne(jdbc.update(sql, "time-payment-date-java-v2", VERSION, "payment-date", "缴款日期",
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
        evidence(sql, "evidence-erp-java-v2", "erp-fact-evidence", "ERP 事实证据", "授权范围内的业务事实。",
                "factual", Map.of("type", "data-table"), Map.of("adapter", "erp-staging-query"), "high", now);
        evidence(sql, "evidence-cube-java-v2", "cube-metric-evidence", "Cube 指标证据", "受治理的量化指标。",
                "quantitative", Map.of("type", "metric-table"), Map.of("adapter", "cube-semantic-query"), "high", now);
        evidence(sql, "evidence-neo4j-java-v2", "graph-relation-evidence", "图谱关系证据", "候选结构关系，不作为因果证明。",
                "relational", Map.of("type", "relation-table"), Map.of("adapter", "neo4j-graph-query"), "normal", now);
        evidence(sql, "evidence-llm-java-v2", "grounded-conclusion-evidence", "受控模型结论", "带真实证据引用的结构化结论。",
                "qualitative", Map.of("type", "markdown-block"), Map.of("adapter", "llm-structured-output"), "normal", now);
    }

    private void evidence(String sql, String id, String key, String name, String description, String category,
                          Map<String, Object> renderer, Map<String, Object> source, String priority, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, key, name, description, category, json.write(renderer),
                json.write(source), priority, json.write(false), json.write(List.of()), at(now), at(now)), "证据类型 " + key);
    }

    private void insertEasyvDefinitions(String actorId, Instant now) {
        insertEasyvEntities(now);
        insertEasyvMetrics(now);
        insertEasyvMetricVariants(now);
        insertEasyvPlanSteps(now);
        insertEasyvToolBindings(actorId, now);
        insertEasyvTimeSemantics(now);
        insertEasyvEvidenceTypes(now);
    }

    private void insertEasyvEntities(Instant now) {
        String sql = """
                insert into platform.ontology_entity_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,synonyms,parent_business_key,
                   metadata,created_at,updated_at)
                values (?,?,?, ?,?,'approved',array[]::text[],null,cast(? as jsonb),?,?)
                """;
        easyvEntity(sql, "entity-easyv-ai-application-v1", "easyv-ai-application", "AI 应用",
                "一次可持续编辑、生成和评价的 AI 大屏工作对象，以 appId 标识。",
                Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY, "primaryKey", "app_id",
                        "sourceTable", "easyv_saas.ai_screen_app", "scopeFields", List.of("space_id", "team_id", "user_id")), now);
        easyvEntity(sql, "entity-easyv-prototype-generation-task-v1", "prototype-generation-task", "原型生成任务",
                "Java 上游将输入转为屏幕原型的一次执行，以 taskId 和 appId 归并。",
                Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY, "primaryKey", "task_id",
                        "sourceTable", "easyv_saas.ai_pipeline_node_record", "correlationKey", "app_id"), now);
        easyvEntity(sql, "entity-easyv-pipeline-node-execution-v1", "pipeline-node-execution", "流水线节点执行",
                "原型流水线某个 step 或 branch 的一次可审计记录。",
                Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY, "primaryKey", "id",
                        "sourceTable", "easyv_saas.ai_pipeline_node_record", "durationField", "duration_ms"), now);
        easyvEntity(sql, "entity-easyv-application-generation-task-v1", "application-generation-task", "应用生成任务",
                "Forge 将原型物化为页面组件的一次任务。",
                Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY, "primaryKey", "task_id",
                        "sourceTable", "easyv_saas.generation_tasks", "correlationKey", "app_id"), now);
        easyvEntity(sql, "entity-easyv-generation-feedback-v1", "generation-feedback", "生成反馈",
                "用户对 AI 操作的评分、评价或另存行为标记。",
                Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY, "primaryKey", "id",
                        "sourceTable", "easyv_saas.dt_ai_operation_log", "correlationKey", "app_id"), now);
    }

    private void easyvEntity(String sql, String id, String key, String name, String description,
                             Map<String, Object> metadata, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, key, name, description, json.write(metadata), at(now), at(now)),
                "EasyV 实体 " + key);
    }

    private void insertEasyvMetrics(Instant now) {
        String sql = """
                insert into platform.ontology_metric_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,applicable_subject_keys,
                   default_aggregation,unit,metadata,created_at,updated_at)
                values (?,?,?, ?,?,'approved',array['easyv-ai-application'],?,?,cast(? as jsonb),?,?)
                """;
        easyvMetric(sql, "metric-easyv-generation-quality-v1", "easyv-generation-quality", "AI 大屏生成质量",
                "按原型、Forge 物化、阶段和反馈分层呈现生成质量，不能折叠为单一模型成功率。", "ratio", "%",
                Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY, "capabilityKey", EasyvCatalogBaseline.CAPABILITY_KEY,
                        "readOnly", true, "requiresEvidence", true), now);
        easyvMetric(sql, "metric-forge-task-completion-rate-v1", "forge-task-completion-rate", "Forge 任务完成率",
                "completed / (completed + failed)，未终态与 cancelled 不进入终态分母。", "ratio", "%",
                Map.of("sourceTable", "easyv_saas.generation_tasks", "terminalStatuses", List.of("completed", "failed")), now);
        easyvMetric(sql, "metric-forge-task-failure-rate-v1", "forge-task-failure-rate", "Forge 任务失败率",
                "failed / (completed + failed)，未终态单列 incomplete/unknown。", "ratio", "%",
                Map.of("sourceTable", "easyv_saas.generation_tasks", "terminalStatuses", List.of("completed", "failed")), now);
        easyvMetric(sql, "metric-forge-task-terminal-duration-v1", "forge-task-terminal-duration", "Forge 终态任务耗时",
                "completed/failed 任务的 finished_at - started_at，按 P50/P95 展示。", "percentile", "ms",
                Map.of("sourceTable", "easyv_saas.generation_tasks", "startField", "started_at", "endField", "finished_at"), now);
        easyvMetric(sql, "metric-pipeline-stage-duration-v1", "pipeline-stage-duration", "原型阶段耗时",
                "按 stepName、branch 聚合节点 duration_ms，按 P50/P95 展示。", "percentile", "ms",
                Map.of("sourceTable", "easyv_saas.ai_pipeline_node_record", "durationField", "duration_ms"), now);
        easyvMetric(sql, "metric-pipeline-stage-failure-count-v1", "pipeline-stage-failure-count", "原型阶段失败数",
                "按主链路 task 终态失败节点的 stepName 分布，旁路 branch 不得混入。", "count", "tasks",
                Map.of("sourceTable", "easyv_saas.ai_pipeline_node_record", "failureField", "status"), now);
        easyvMetric(sql, "metric-rating-coverage-v1", "rating-coverage", "评分覆盖率",
                "有有效 rating 的可评价操作数 / 可评价操作总数；eligible 分母必须由事实层定义。", "ratio", "%",
                Map.of("sourceTable", "easyv_saas.dt_ai_operation_log", "ratingField", "rating", "requiresEligibleDenominator", true), now);
        easyvMetric(sql, "metric-rating-average-v1", "rating-average", "平均评分",
                "仅对 1..5 的有效 rating 求平均，并返回样本数与分布。", "average", "stars",
                Map.of("sourceTable", "easyv_saas.dt_ai_operation_log", "ratingField", "rating", "validRange", List.of(1, 5)), now);
        easyvMetric(sql, "metric-save-as-behavior-rate-v1", "save-as-behavior-rate", "AI 另存行为率",
                "is_save_as_edit=true 的 eligible AI 应用 / eligible AI 应用总数，不等于 Screen 转化率。", "ratio", "%",
                Map.of("sourceTable", "easyv_saas.dt_ai_operation_log", "flagField", "is_save_as_edit", "requiresEligibleDenominator", true), now);
        easyvMetric(sql, "metric-operation-settlement-success-rate-v1", "operation-settlement-success-rate", "操作结算成功率",
                "execute_result=1 的操作比例；该字段同时受业务结果与积分结算结果影响，不是纯模型成功率。", "ratio", "%",
                Map.of("sourceTable", "easyv_saas.dt_ai_operation_log", "resultField", "execute_result",
                        "combinedOutcome", true, "doNotInterpretAs", "model-only-success"), now);
    }

    private void easyvMetric(String sql, String id, String key, String name, String description,
                             String aggregation, String unit, Map<String, Object> metadata, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, key, name, description, aggregation, unit, json.write(metadata),
                at(now), at(now)), "EasyV 指标 " + key);
    }

    private void insertEasyvMetricVariants(Instant now) {
        easyvVariant("metric-forge-task-completion-rate-v1", "variant-forge-task-completed-count-v1",
                "forge-task-completed-count", "Forge completed 任务数", "completed 状态的终态任务数。", "completed-count",
                Map.of("status", "completed"), now);
        easyvVariant("metric-forge-task-completion-rate-v1", "variant-forge-task-terminal-count-v1",
                "forge-task-terminal-count", "Forge 终态任务数", "completed + failed 任务数。", "terminal-count",
                Map.of("statuses", List.of("completed", "failed")), now);
        easyvVariant("metric-forge-task-failure-rate-v1", "variant-forge-task-failed-count-v1",
                "forge-task-failed-count", "Forge failed 任务数", "failed 状态的终态任务数。", "failed-count",
                Map.of("status", "failed"), now);
        easyvVariant("metric-forge-task-terminal-duration-v1", "variant-forge-task-duration-p50-v1",
                "forge-task-duration-p50", "Forge 终态耗时 P50", "终态任务执行耗时的 P50。", "p50",
                Map.of("startField", "started_at", "endField", "finished_at"), now);
        easyvVariant("metric-forge-task-terminal-duration-v1", "variant-forge-task-duration-p95-v1",
                "forge-task-duration-p95", "Forge 终态耗时 P95", "终态任务执行耗时的 P95。", "p95",
                Map.of("startField", "started_at", "endField", "finished_at"), now);
        easyvVariant("metric-pipeline-stage-duration-v1", "variant-pipeline-stage-duration-p50-v1",
                "pipeline-stage-duration-p50", "阶段耗时 P50", "节点 duration_ms 按 step/branch 的 P50。", "p50",
                Map.of("durationField", "duration_ms"), now);
        easyvVariant("metric-pipeline-stage-duration-v1", "variant-pipeline-stage-duration-p95-v1",
                "pipeline-stage-duration-p95", "阶段耗时 P95", "节点 duration_ms 按 step/branch 的 P95。", "p95",
                Map.of("durationField", "duration_ms"), now);
        easyvVariant("metric-pipeline-stage-failure-count-v1", "variant-pipeline-stage-failure-total-v1",
                "pipeline-stage-failure-total", "阶段失败任务数", "主链路中按失败节点阶段归并的任务数。", "failed-task-count",
                Map.of("branch", "MAIN", "status", "FAILED"), now);
        easyvVariant("metric-rating-coverage-v1", "variant-rating-covered-operation-count-v1",
                "rating-covered-operation-count", "有效评分操作数", "rating 在 1..5 的操作数。", "rated-count",
                Map.of("ratingRange", List.of(1, 5)), now);
        easyvVariant("metric-rating-coverage-v1", "variant-rating-eligible-operation-count-v1",
                "rating-eligible-operation-count", "可评价操作数", "由事实层定义的可评价操作分母。", "eligible-count",
                Map.of("requiresFactDefinition", true), now);
        easyvVariant("metric-rating-average-v1", "variant-rating-average-score-v1",
                "rating-average-score", "平均评分分数", "有效评分的平均值。", "average",
                Map.of("ratingRange", List.of(1, 5)), now);
        easyvVariant("metric-save-as-behavior-rate-v1", "variant-save-as-edit-count-v1",
                "save-as-edit-count", "另存编辑应用数", "is_save_as_edit=true 的应用数。", "save-as-count",
                Map.of("flagField", "is_save_as_edit", "flagValue", true), now);
        easyvVariant("metric-save-as-behavior-rate-v1", "variant-save-as-eligible-application-count-v1",
                "save-as-eligible-application-count", "可另存应用数", "由事实层定义的可另存应用分母。", "eligible-count",
                Map.of("requiresFactDefinition", true), now);
        easyvVariant("metric-operation-settlement-success-rate-v1", "variant-operation-success-count-v1",
                "operation-success-count", "操作结算成功数", "execute_result=1 的操作数。", "success-count",
                Map.of("resultField", "execute_result", "resultValue", 1, "combinedOutcome", true), now);
        easyvVariant("metric-operation-settlement-success-rate-v1", "variant-operation-attempt-count-v1",
                "operation-attempt-count", "操作尝试数", "操作结算成功率的尝试总数。", "attempt-count",
                Map.of("resultField", "execute_result", "combinedOutcome", true), now);
    }

    private void easyvVariant(String parentId, String id, String key, String name, String description,
                              String discriminator, Map<String, Object> mapping, Instant now) {
        String sql = """
                insert into platform.ontology_metric_variants
                  (id,ontology_version_id,parent_metric_definition_id,business_key,display_name,description,status,
                   semantic_discriminator,cube_view_mapping,filter_template,metadata,created_at,updated_at)
                values (?,?,?,?,?,?,'approved',?,cast(? as jsonb),null,cast(? as jsonb),?,?)
                """;
        requireOne(jdbc.update(sql, id, VERSION, parentId, key, name, description, discriminator,
                json.write(mapping), json.write(Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY)), at(now), at(now)),
                "EasyV 指标变体 " + key);
    }

    private void insertEasyvPlanSteps(Instant now) {
        String sql = """
                insert into platform.ontology_plan_step_templates
                  (id,ontology_version_id,business_key,display_name,description,status,intent_types,required_capabilities,
                   sort_order,metadata,created_at,updated_at)
                values (?,?,?, ?,?,'approved',array['easyv-generation-quality-analysis'],string_to_array(?,','),?,cast(? as jsonb),?,?)
                """;
        easyvPlan(sql, "step-easyv-validate-scope-and-time-v1", "easyv-validate-scope-and-time", "校验 EasyV 范围与时间",
                "固定已授权的 space/team/user snapshot 与 source event/create time。", "easyv-scope-resolver", 1, now);
        easyvPlan(sql, "step-easyv-read-generation-quality-facts-v1", "easyv-read-generation-quality-facts", "读取生成质量事实",
                "仅读取应用、原型节点、Forge 任务和反馈事实。", "easyv-generation-facts-read", 2, now);
        easyvPlan(sql, "step-easyv-validate-fact-completeness-v1", "easyv-validate-fact-completeness", "校验事实完整性",
                "校验终态、耗时、失败原因、分子分母和 freshness；缺失时 fail loud。", "easyv-evidence-validator", 3, now);
        easyvPlan(sql, "step-easyv-render-evidence-grounded-result-v1", "easyv-render-evidence-grounded-result", "渲染证据化结果",
                "只组织结构化事实与证据，不生成 Screen lineage 或写操作。", "easyv-structured-analysis", 4, now);
    }

    private void easyvPlan(String sql, String id, String key, String name, String description,
                           String capability, int order, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, key, name, description, capability, order,
                json.write(Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY)), at(now), at(now)), "EasyV 计划步骤 " + key);
    }

    private void insertEasyvToolBindings(String actorId, Instant now) {
        String sql = """
                insert into platform.ontology_tool_capability_bindings
                  (id,ontology_version_id,bound_step_template_key,bound_capability_tag,tool_name,activation_conditions,
                   description,status,priority,created_at,updated_at,created_by)
                values (?,?,?,?,?,cast(? as jsonb),?,'approved',100,?,?,?)
                """;
        easyvTool(sql, "binding-easyv-scope-resolver-v1", "easyv-validate-scope-and-time", "easyv-scope-resolver",
                "easyv.scope-resolver", "解析并固定可信 principal 的 EasyV scope。", actorId, now);
        easyvTool(sql, "binding-easyv-generation-facts-read-v1", "easyv-read-generation-quality-facts", "easyv-generation-facts-read",
                "easyv.generation-facts-read", "读取 allowlist 内的只读生成事实。", actorId, now);
        easyvTool(sql, "binding-easyv-evidence-validator-v1", "easyv-validate-fact-completeness", "easyv-evidence-validator",
                "easyv.evidence-validator", "校验 scope、time range、分子分母和 freshness。", actorId, now);
        easyvTool(sql, "binding-easyv-structured-analysis-v1", "easyv-render-evidence-grounded-result", "easyv-structured-analysis",
                "easyv.structured-analysis", "组织证据化结构结论，不执行写动作。", actorId, now);
    }

    private void easyvTool(String sql, String id, String step, String capability, String tool,
                           String description, String actorId, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, step, capability,
                tool, json.write(List.of(Map.of("type", "readOnly", "value", true))), description,
                at(now), at(now), actorId), "EasyV 工具绑定 " + capability);
    }

    private void insertEasyvTimeSemantics(Instant now) {
        String sql = """
                insert into platform.ontology_time_semantics
                  (id,ontology_version_id,business_key,display_name,description,status,semantic_type,
                   entity_date_field_mapping,cube_time_dimension_mapping,calculation_rule,default_granularity,
                   metadata,created_at,updated_at)
                values (?,?,?, ?,?,'approved',?,cast(? as jsonb),null,null,?,cast(? as jsonb),?,?)
                """;
        requireOne(jdbc.update(sql, "time-easyv-generation-time-v1", VERSION, "easyv-generation-time", "EasyV 生成时间",
                "按 source event/create time 选择 cohort；不同来源保留各自时间语义。", "source-event-or-create-time",
                json.write(Map.of("aiApplication", "create_time", "prototype", "create_time",
                        "pipelineNode", "create_time", "forgeTask", "create_time", "feedback", "operate_time")),
                "day", json.write(Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY,
                        "cohortTime", "source event/create time")), at(now), at(now)), "EasyV 时间语义");
    }

    private void insertEasyvEvidenceTypes(Instant now) {
        String sql = """
                insert into platform.ontology_evidence_type_definitions
                  (id,ontology_version_id,business_key,display_name,description,status,evidence_category,
                   renderer_config,data_source_config,default_priority,is_interactive,template_schema,
                   validation_rules,metadata,created_at,updated_at)
                values (?,?,?, ?,?,'approved',?,cast(? as jsonb),cast(? as jsonb),?,cast(? as jsonb),null,
                  cast(? as jsonb),cast(? as jsonb),?,?)
                """;
        easyvEvidence(sql, "evidence-easyv-ai-application-v1", "easyv-ai-application", "AI 应用证据", "应用归属、模板与 cohort。", "factual", "easyv_saas.ai_screen_app", now);
        easyvEvidence(sql, "evidence-easyv-prototype-task-v1", "easyv-prototype-task", "原型任务证据", "任务终态与时间。", "factual", "easyv_saas.ai_pipeline_node_record", now);
        easyvEvidence(sql, "evidence-easyv-pipeline-node-v1", "easyv-pipeline-node", "流水线节点证据", "阶段状态、耗时与失败摘要。", "diagnostic", "easyv_saas.ai_pipeline_node_record", now);
        easyvEvidence(sql, "evidence-easyv-forge-task-v1", "easyv-forge-task", "Forge 任务证据", "Forge 状态、进度、失败与时长。", "factual", "easyv_saas.generation_tasks", now);
        easyvEvidence(sql, "evidence-easyv-generated-artifact-v1", "easyv-generated-artifact", "生成产物证据", "当前页面/组件结构化摘要；不表示正式 Screen lineage。", "structural", "easyv_saas.ai_screen", now);
        easyvEvidence(sql, "evidence-easyv-generation-feedback-v1", "easyv-generation-feedback", "生成反馈证据", "评分、评价和另存行为标记。", "behavioral", "easyv_saas.dt_ai_operation_log", now);
    }

    private void easyvEvidence(String sql, String id, String key, String name, String description,
                               String category, String sourceTable, Instant now) {
        requireOne(jdbc.update(sql, id, VERSION, key, name, description, category,
                json.write(Map.of("type", "data-table")), json.write(Map.of("adapter", "easyv-readonly-facts",
                        "sourceTable", sourceTable)), "normal", json.write(false),
                json.write(List.of("scope", "timeRange", "freshness", "sourceKey")),
                json.write(Map.of("domainKey", EasyvCatalogBaseline.DOMAIN_KEY)), at(now), at(now)),
                "EasyV 证据类型 " + key);
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
