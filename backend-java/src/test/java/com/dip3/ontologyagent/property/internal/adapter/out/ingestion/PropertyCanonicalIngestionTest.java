package com.dip3.ontologyagent.property.internal.adapter.out.ingestion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.dip3.ontologyagent.auth.AccessScope;
import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.graphsync.GraphBatch;
import com.dip3.ontologyagent.graphsync.GraphProjection;
import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.DatasetVersionSetPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.IngestionPostgresPersistenceAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.ProductCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.SourceCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres.PostgresSourceConnector;
import com.dip3.ontologyagent.ingestion.internal.application.CanonicalProductTransformRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.DatasetReleasePublisher;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.ProductMaterializer;
import com.dip3.ontologyagent.ingestion.internal.application.SourceConnectorRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.SourceIngestionOrchestrator;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import com.dip3.ontologyagent.property.internal.adapter.out.erp.PostgresErpEvidenceAdapter;
import com.dip3.ontologyagent.property.internal.adapter.out.neo4j.PropertyGraphBatchBuilder;
import com.dip3.ontologyagent.property.internal.adapter.out.postgres.PropertyCanonicalScope;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.property.internal.domain.AnalysisRuntimeCapability;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;

@Testcontainers
class PropertyCanonicalIngestionTest {
  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

  private JdbcTemplate jdbc;
  private JdbcTransactionManager transactions;

  @BeforeAll
  static void migrate() {
    MigrationTestSupport.migrate(POSTGRES);
  }

  @BeforeEach
  void reset() {
    var dataSource = new DriverManagerDataSource(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    jdbc = new JdbcTemplate(dataSource);
    transactions = new JdbcTransactionManager(dataSource);
    jdbc.execute("""
        truncate facts.property_organization,facts.property_project,
          facts.property_charge_item,facts.property_receivable,facts.property_payment,
          facts.property_service_order,ingestion.dataset_version_set_items,
          ingestion.dataset_version_sets,ingestion.data_product_version_lineage,
          ingestion.data_product_versions,ingestion.product_materialization_runs,
          ingestion.dataset_cursors,ingestion.source_dataset_batches,
          ingestion.source_dataset_versions,ingestion.source_ingestion_runs,
          erp_staging.dw_datacenter_system_organization,erp_staging.dw_datacenter_precinct,
          erp_staging.dw_datacenter_chargeitem,erp_staging.dw_datacenter_charge,
          erp_staging.dw_datacenter_bill,erp_staging.dw_datacenter_services cascade
        """);
    seedStaging();
  }

  @Test
  void publishesPropertyPackAndReadsOnlyTheExecutionPinnedFacts() {
    JsonCodec json = new JsonCodec();
    RowPackV1Codec codec = new RowPackV1Codec();
    IngestionPersistencePort persistence = new IngestionPostgresPersistenceAdapter(
        jdbc, json, transactions);
    SourceCatalogPostgresAdapter sources = new SourceCatalogPostgresAdapter(jdbc, json);
    ProductCatalogPostgresAdapter products = new ProductCatalogPostgresAdapter(jdbc, json, sources);
    PostgresSourceConnectionProvider connection = ref -> {
      assertEquals("property-staging-source", ref);
      return new PostgresSourceConnectionProvider.ResolvedConnection(
          jdbc.getDataSource(), transactions, 30);
    };
    SourceIngestionOrchestrator sourceIngestion = new SourceIngestionOrchestrator(
        sources, new SourceConnectorRegistry(List.of(new PostgresSourceConnector(connection))),
        codec, persistence);
    List<CanonicalProductTransform> transforms = Arrays.stream(PropertyCanonicalTransform.Kind.values())
        .map(kind -> (CanonicalProductTransform) new PropertyCanonicalTransform(kind, jdbc))
        .toList();
    ProductMaterializer materializer = new ProductMaterializer(
        products, new CanonicalProductTransformRegistry(transforms), codec, persistence);
    DatasetReleasePublisher.Result release = new DatasetReleasePublisher(
        sourceIngestion, sources, products, materializer, persistence).publish(
        new DatasetReleasePublisher.Command(
            "property-set-1", "property", PropertyDataProducts.REQUIRED,
            IngestionRun.Mode.FULL, IngestionRun.TriggerType.BOOTSTRAP,
            "test", "property-trace-1", 2));

    assertEquals(PropertyDataProducts.REQUIRED, release.productVersions().keySet());
    assertEquals(6L, count("ingestion.data_product_versions"));
    assertEquals(9L, count("ingestion.data_product_version_lineage"));
    assertEquals(1L, count("facts.property_receivable"));
    assertEquals(2L, count("facts.property_payment"));
    assertEquals(new BigDecimal("-10"), jdbc.queryForObject(
        "select min(paid_amount) from facts.property_payment", BigDecimal.class));

    DatasetVersionSetPostgresAdapter versionSets = new DatasetVersionSetPostgresAdapter(jdbc, json);
    PropertyGraphBatchBuilder graph = new PropertyGraphBatchBuilder(jdbc, versionSets, transactions);
    GraphProjection projection = graph.latestProjection();
    assertEquals("property-set-1", projection.datasetVersionSetId());
    assertEquals(List.of("1"), graph.activeOrganizationIds(projection));
    GraphBatch graphBatch = graph.build("1", "graph-run-1", projection);
    assertEquals(8L, graphBatch.nodes().stream()
        .filter(node -> "property-set-1".equals(node.get("datasetVersionSetId"))).count());
    assertEquals(9L, graphBatch.edges().stream()
        .filter(edge -> "property-set-1".equals(edge.get("datasetVersionSetId"))).count());

    PropertyCanonicalScope scope = new PropertyCanonicalScope(jdbc, versionSets, transactions);
    PostgresErpEvidenceAdapter adapter = new PostgresErpEvidenceAdapter(jdbc, scope, transactions);
    AuthSession owner = new AuthSession("auth-1", "user-1", "用户",
        new AccessScope("1", List.of(), List.of("area-1"), List.of("analyst")), Instant.MAX);
    WorkflowRequest request = request("property-set-1", List.of("project-1"));

    Map<String, Object> row = adapter.collect(owner, request).rows().getFirst();

    assertEquals("project-1", row.get("projectId"));
    assertEquals("项目一", row.get("projectName"));
    assertEquals(new BigDecimal("100"), row.get("receivableAmount"));
    assertEquals(new BigDecimal("70"), row.get("paidAmount"));
    assertEquals(new BigDecimal("20"), row.get("arrearsAmount"));
    assertThrows(DataAccessException.class, () -> jdbc.update(
        "update facts.property_receivable set project_name='changed'"));

    BackendException unbound = assertThrows(BackendException.class,
        () -> adapter.collect(owner, request(null, List.of("project-1"))));
    assertEquals("DATASET_VERSION_SET_MISSING", unbound.code());
  }

  private WorkflowRequest request(String setId, List<String> projectIds) {
    return new WorkflowRequest(
        "execution-1", "session-1", "ontology-1", setId, "分析项目收缴率",
        AnalysisRuntimeCapability.ENTITY_KEY,
        AnalysisRuntimeCapability.METRIC_DEFINITION_KEY,
        AnalysisRuntimeCapability.METRIC_VARIANT_KEY,
        AnalysisRuntimeCapability.TIME_SEMANTIC_KEY,
        projectIds, LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), "worker-1",
        "java-initial-v1", null, null, Map.of(), Map.of());
  }

  private void seedStaging() {
    jdbc.update("""
        insert into erp_staging.dw_datacenter_system_organization
          (source_id,organization_name,organization_path,is_deleted,create_time,update_time)
        values (1,'总部','/1/',0,'2026-01-01T00:00:00Z','2026-09-01T00:00:00Z')
        """);
    jdbc.update("""
        insert into erp_staging.dw_datacenter_precinct
          (precinct_id,precinct_name,org_id,area_id,is_delete,delete_flag,create_date,update_date)
        values ('project-1','项目一','1','area-1',0,0,
                '2026-01-01T00:00:00Z','2026-09-01T00:00:00Z')
        """);
    jdbc.update("""
        insert into erp_staging.dw_datacenter_chargeitem
          (charge_item_id,charge_item_name,charge_item_type,organization_id,delete_flag)
        values ('charge-item-1','物业费','1','1',0)
        """);
    jdbc.update("""
        insert into erp_staging.dw_datacenter_charge
          (record_id,organization_id,charge_detail_id,precinct_id,precinct_name,
           charge_item_id,charge_item_name,should_account_book,actual_charge_sum,arrears,
           is_check,is_delete,create_date,update_date)
        values (101,'1','detail-1','project-1','项目一','charge-item-1','物业费',
                202609,100,20,'审核通过',0,'2026-09-01T00:00:00Z','2026-09-01T00:00:00Z')
        """);
    jdbc.update("""
        insert into erp_staging.dw_datacenter_bill
          (record_id,organization_id,charge_detail_id,precinct_id,precinct_name,
           charge_item_id,charge_item_name,charge_paid,operator_date,is_enter_account,
           is_delete,subject_code,update_date)
        values
          (201,'1','detail-1','project-1','项目一','charge-item-1','物业费',80,
           '2026-09-10T01:00:00Z','1',0,'已缴款','2026-09-10T01:00:00Z'),
          (202,'1','detail-1','project-1','项目一','charge-item-1','物业费',-10,
           '2026-09-11T01:00:00Z','1',0,'退款','2026-09-11T01:00:00Z')
        """);
    jdbc.update("""
        insert into erp_staging.dw_datacenter_services
          (services_no,organization_id,precinct_id,precinct_name,service_type_name,
           service_style_name,is_delete,create_date_time,update_date_time)
        values ('service-1','1','project-1','项目一','报事','投诉',0,
                '2026-09-01T00:00:00Z','2026-09-01T01:00:00Z')
        """);
  }

  private long count(String relation) {
    return jdbc.queryForObject("select count(*) from " + relation, Long.class);
  }
}
