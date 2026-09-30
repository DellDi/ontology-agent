package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.DatasetDefinition;
import com.dip3.ontologyagent.ingestion.api.IngestionRun;
import com.dip3.ontologyagent.ingestion.api.ProductMaterializationRun;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.IngestionPostgresPersistenceAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.ProductCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.SourceCatalogPostgresAdapter;
import com.dip3.ontologyagent.ingestion.internal.application.CanonicalProductTransformRegistry;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.ProductMaterializer;
import com.dip3.ontologyagent.ingestion.internal.application.SourceBatchManifest;
import com.dip3.ontologyagent.ingestion.internal.application.SourceCatalogPort;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import javax.sql.DataSource;
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

/** 原型结构三个数据产品从同一源数据集物化：成功、解析失败可定位、重跑一致、版本不可变。 */
@Testcontainers
class EasyVPrototypeStructureIngestionTest {
  private static final String DATASET = "easyv-prototype-task";
  private static final List<String> PRODUCTS =
      List.of("easyv-prototype-layout", "easyv-prototype-block", "easyv-prototype-component");
  private static final String XML = """
      <Pages><Page id="page-1">
        <Layout block-count="3" grid-direction="horizontal" type="凹形">
          <Sider gap="24" grid-direction="vertical" id="left" span="3/12">
            <Block blockSize="medium" block_type_id="1" id="page-1__left_1" span="4/12" weight="92"/>
            <Block blockSize="medium" block_type_id="1" id="page-1__left_2" span="4/12" weight="90"/>
          </Sider>
          <Footer gap="24" id="foot" span="4/12" grid-direction="horizontal">
            <Block block_type_id="3" id="page-1__foot_1" span="12/12" weight="70"/>
          </Footer>
        </Layout>
      </Page></Pages>
      """;

  @Container
  static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");

  private JdbcTemplate jdbc;
  private IngestionPersistencePort persistence;
  private RowPackV1Codec codec;
  private SourceCatalogPort sourceCatalog;
  private ProductMaterializer materializer;

  @BeforeAll
  static void migrate() {
    MigrationTestSupport.migrate(POSTGRES);
  }

  @BeforeEach
  void reset() {
    DataSource dataSource = new DriverManagerDataSource(
        POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    jdbc = new JdbcTemplate(dataSource);
    jdbc.execute("""
        truncate ingestion.dataset_version_set_items, ingestion.dataset_version_sets,
          ingestion.data_product_version_lineage, ingestion.data_product_versions,
          ingestion.product_materialization_runs, ingestion.dataset_cursors,
          ingestion.source_dataset_batches, ingestion.source_dataset_versions,
          ingestion.source_ingestion_runs cascade
        """);
    JsonCodec json = new JsonCodec();
    persistence = new IngestionPostgresPersistenceAdapter(jdbc, json, new JdbcTransactionManager(dataSource));
    codec = new RowPackV1Codec();
    sourceCatalog = new SourceCatalogPostgresAdapter(jdbc, json);
    List<CanonicalProductTransform> transforms = List.of(
        new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE_LAYOUT, jdbc, json),
        new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE_BLOCK, jdbc, json),
        new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.PROTOTYPE_COMPONENT, jdbc, json));
    materializer = new ProductMaterializer(
        new ProductCatalogPostgresAdapter(jdbc, json, sourceCatalog),
        new CanonicalProductTransformRegistry(transforms), codec, persistence);
  }

  @Test
  void materializesStructureAndKeepsParseFailuresVisible() {
    String source = publish("run-1", rows(validJson("4")));
    Map<String, String> versions = materializeAll(source, "a");

    assertEquals(4L, count("facts.easyv_prototype_layout", versions.get("easyv-prototype-layout")));
    assertEquals(3L, count("facts.easyv_prototype_block", versions.get("easyv-prototype-block")));
    assertEquals(3L, count("facts.easyv_prototype_component", versions.get("easyv-prototype-component")));

    assertEquals("ok", jdbc.queryForObject(
        "select parse_status from facts.easyv_prototype_layout where app_id='app-1'", String.class));
    assertEquals(3, jdbc.queryForObject(
        "select block_count from facts.easyv_prototype_layout where app_id='app-1'", Integer.class));
    assertEquals(3, jdbc.queryForObject(
        "select component_count from facts.easyv_prototype_layout where app_id='app-1'", Integer.class));
    assertEquals("凹形", jdbc.queryForObject(
        "select layout_type from facts.easyv_prototype_layout where app_id='app-1'", String.class));

    Map<String, String> failures = new LinkedHashMap<>();
    jdbc.query("select app_id, parse_status || ':' || parse_error_code as v from facts.easyv_prototype_layout"
        + " where parse_status <> 'ok' order by app_id", result -> {
          failures.put(result.getString("app_id"), result.getString("v"));
        });
    assertEquals(Map.of(
        "app-2", "invalid_xml:XML_MALFORMED",
        "app-3", "inconsistent:BLOCK_SET_MISMATCH",
        "app-4", "invalid_json:JSON_MISSING"), failures);
    assertNull(jdbc.queryForObject(
        "select chart_signature from facts.easyv_prototype_layout where app_id='app-2'", String.class));
    assertEquals(0L, jdbc.queryForObject(
        "select count(*) from facts.easyv_prototype_block where app_id in ('app-2','app-3','app-4')", Long.class));

    assertEquals("Footer", jdbc.queryForObject(
        "select container_tag from facts.easyv_prototype_block where block_id='page-1__foot_1'", String.class));
    assertNull(jdbc.queryForObject(
        "select block_size from facts.easyv_prototype_block where block_id='page-1__foot_1'", String.class));
    assertEquals("line", jdbc.queryForObject(
        "select chart_family from facts.easyv_prototype_component where component_id='c1'", String.class));
    assertEquals(0L, jdbc.queryForObject("""
        select count(*) from information_schema.columns where table_schema='facts'
          and table_name like 'easyv_prototype_%'
          and column_name in ('title','name','description','desc','metric_name','files')
        """, Long.class), "facts 不应有自由文本列");
    assertThrows(DataAccessException.class, () -> jdbc.update(
        "update facts.easyv_prototype_block set scheme_id='changed'"));
  }

  @Test
  void rerunsAreDeterministicAndSourceChangesProduceANewImmutableVersion() {
    String first = publish("run-1", rows(validJson("4")));
    Map<String, String> firstVersions = materializeAll(first, "a");
    Map<String, String> repeatVersions = materializeAll(first, "b");
    for (String product : PRODUCTS) {
      assertEquals(contentHash(firstVersions.get(product)), contentHash(repeatVersions.get(product)),
          product + " 相同输入应得到相同内容哈希");
    }

    String changed = publish("run-2", rows(validJson("7")));
    Map<String, String> changedVersions = materializeAll(changed, "c");
    assertNotEquals(contentHash(firstVersions.get("easyv-prototype-block")),
        contentHash(changedVersions.get("easyv-prototype-block")));
    assertEquals("4", schemeOf(firstVersions.get("easyv-prototype-block")));
    assertEquals("7", schemeOf(changedVersions.get("easyv-prototype-block")));
    assertNotEquals(signatureOf(firstVersions.get("easyv-prototype-layout"), "scheme_signature"),
        signatureOf(changedVersions.get("easyv-prototype-layout"), "scheme_signature"));
    assertEquals(signatureOf(firstVersions.get("easyv-prototype-layout"), "layout_signature"),
        signatureOf(changedVersions.get("easyv-prototype-layout"), "layout_signature"));
  }

  @Test
  void componentOrderDoesNotChangeCanonicalContent() {
    Map<String, Object> firstJson = validJson("4");
    Map<String, Object> secondJson = validJson("4");
    Map<String, Object> firstBlocks = (Map<String, Object>) ((Map<String, Object>) firstJson.get("page-1")).get("blocks");
    Map<String, Object> secondBlocks = (Map<String, Object>) ((Map<String, Object>) secondJson.get("page-1")).get("blocks");
    Map<String, Object> component1 = Map.of("id", "c1", "chartFamily", "line");
    Map<String, Object> component2 = Map.of("id", "c9", "chartFamily", "donut");
    firstBlocks.put("page-1__left_1", Map.of("schemeId", "4", "components", List.of(component1, component2)));
    secondBlocks.put("page-1__left_1", Map.of("schemeId", "4", "components", List.of(component2, component1)));
    Map<String, String> first = materializeAll(publish("order-1", rows(firstJson)), "order-1");
    Map<String, String> second = materializeAll(publish("order-2", rows(secondJson)), "order-2");
    for (String product : PRODUCTS) assertEquals(contentHash(first.get(product)), contentHash(second.get(product)));
  }

  @Test
  void incrementalUpdatesReplaceChildrenAndReconcileRemovesDeletedPrototypes() {
    String first = publish("full", rows(validJson("4")));
    Map<String, String> original = materializeAll(first, "full");
    LocalDateTime time = LocalDateTime.parse("2026-09-04T09:05:00");
    Map<String, Object> changed = validJson("7");
    ((Map<String, Object>) ((Map<String, Object>) changed.get("page-1")).get("blocks"))
        .put("page-1__left_1", Map.of("schemeId", "7", "components", List.of()));
    SourceRow updated = row(1L, "app-1", XML, changed, time, time);
    String delta = publish("delta", List.of(updated), IngestionRun.Mode.INCREMENTAL, first, 2);
    Map<String, String> incremental = materializeAll(delta, "delta");
    assertEquals(4L, count("facts.easyv_prototype_layout", incremental.get(PRODUCTS.get(0))));
    assertEquals(2L, count("facts.easyv_prototype_component", incremental.get(PRODUCTS.get(2))));
    assertEquals(3L, count("facts.easyv_prototype_component", original.get(PRODUCTS.get(2))));
    assertEquals("7", schemeOf(incremental.get(PRODUCTS.get(1))));

    String reconciled = publish("reconcile", List.of(updated), IngestionRun.Mode.RECONCILE, null, 2);
    Map<String, String> rebuilt = materializeAll(reconciled, "reconcile");
    assertEquals(1L, count("facts.easyv_prototype_layout", rebuilt.get(PRODUCTS.get(0))));
    assertEquals(3L, count("facts.easyv_prototype_block", rebuilt.get(PRODUCTS.get(1))));
    assertEquals(2L, count("facts.easyv_prototype_component", rebuilt.get(PRODUCTS.get(2))));
  }

  @Test
  void rejectsAV1ParentUntilAFullV2SnapshotIsPublished() {
    jdbc.update("update ingestion.dataset_definitions set schema_version=1 where dataset_key=?", DATASET);
    String legacy = publish("legacy", List.of(), IngestionRun.Mode.FULL, null, 1);
    jdbc.update("update ingestion.dataset_definitions set schema_version=2 where dataset_key=?", DATASET);
    String delta = publish("delta", rows(validJson("4")), IngestionRun.Mode.INCREMENTAL, legacy, 2);
    IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
        () -> materializeAll(delta, "invalid"));
    assertEquals("source version chain does not match dataset contract", error.getMessage());
    assertEquals("PRODUCT_CONTRACT_INVALID", jdbc.queryForObject(
        "select error_code from ingestion.product_materialization_runs where status='failed'", String.class));
    assertEquals(3, materializeAll(publish("full-v2", rows(validJson("4"))), "valid").size());
  }

  private Map<String, String> materializeAll(String sourceVersion, String suffix) {
    Map<String, String> versions = new LinkedHashMap<>();
    for (String product : PRODUCTS) {
      var published = materializer.materialize(new ProductMaterializer.Command(
          "product-run-" + product + "-" + suffix, product, "product-version-" + product + "-" + suffix,
          ProductMaterializationRun.Mode.FULL, ProductMaterializationRun.TriggerType.BOOTSTRAP,
          "test", "trace-" + product + "-" + suffix, Map.of("source", sourceVersion)));
      versions.put(product, published.id());
    }
    return versions;
  }

  private String publish(String runId, List<SourceRow> rows) {
    return publish(runId, rows, IngestionRun.Mode.FULL, null, 2);
  }

  private String publish(String runId, List<SourceRow> rows, IngestionRun.Mode mode,
      String parentVersion, int schemaVersion) {
    DatasetDefinition dataset = sourceCatalog.loadActiveSource("easyv").datasets().stream()
        .filter(candidate -> DATASET.equals(candidate.datasetKey())).findFirst().orElseThrow();
    persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
        runId, "easyv", mode, IngestionRun.TriggerType.BOOTSTRAP, "test",
        "trace-" + runId, Map.of("connector", "test")));
    persistence.startSourceRun(runId);
    String versionId = "source-version-" + runId;
    persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(
        runId, List.of(new IngestionPersistencePort.SourceDatasetReservation(
            versionId, DATASET, parentVersion, Map.of("snapshot", runId), schemaVersion))));
    var receipts = rows.isEmpty() ? List.<IngestionPersistencePort.SourceBatchReceipt>of()
        : List.of(persistence.appendSourceBatch(new IngestionPersistencePort.SourceBatchAppend(
            versionId, 1, rows.size(), codec.encode(dataset, rows))));
    persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(runId, List.of(
        new IngestionPersistencePort.SourceDatasetPublication(DATASET, receipts.size(), rows.size(),
            SourceBatchManifest.aggregate(receipts).contentHash(), Map.of("complete", true)))));
    return versionId;
  }

  private static List<SourceRow> rows(Map<String, Object> valid) {
    LocalDateTime created = LocalDateTime.parse("2026-09-04T09:00:00");
    LocalDateTime updated = LocalDateTime.parse("2026-09-04T09:05:00");
    List<SourceRow> rows = new ArrayList<>();
    rows.add(row(1L, "app-1", XML, valid, created, updated));
    rows.add(row(2L, "app-2", "<Pages><Page>", valid, created, updated));
    rows.add(row(3L, "app-3", XML, json(Map.of("page-1__left_1", block("4", "c9", "line"))), created, updated));
    rows.add(row(4L, "app-4", XML, null, created, updated));
    return rows;
  }

  private static Map<String, Object> validJson(String leftScheme) {
    Map<String, Object> blocks = new LinkedHashMap<>();
    blocks.put("page-1__left_1", block(leftScheme, "c1", "line"));
    blocks.put("page-1__left_2", block("2", "c2", "donut"));
    blocks.put("page-1__foot_1", block("42", "c3", "horizontal-bar"));
    return json(blocks);
  }

  private static Map<String, Object> json(Map<String, Object> blocks) {
    return Map.of("page-1", Map.of("title", "不应入库的标题", "blocks", blocks, "contents", List.of()));
  }

  private static Map<String, Object> block(String scheme, String componentId, String family) {
    return Map.of("schemeId", scheme, "title", "不应入库的区域标题", "components", List.of(Map.of(
        "id", componentId, "name", "不应入库的指标名", "chartFamily", family, "componentId", "890846191921795072",
        "sceneType", "总览指标", "sourceType", "AI",
        "config", Map.of("gridPosition", Map.of("col", 1, "row", 1, "colSpan", 12, "rowSpan", 12)))));
  }

  private static SourceRow row(Object... values) {
    return new SourceRow(Collections.unmodifiableList(Arrays.asList(values)));
  }

  private long count(String relation, String productVersionId) {
    return jdbc.queryForObject("select count(*) from " + relation + " where product_version_id=?",
        Long.class, productVersionId);
  }

  private String contentHash(String productVersionId) {
    return jdbc.queryForObject(
        "select content_hash from ingestion.data_product_versions where id=?", String.class, productVersionId);
  }

  private String schemeOf(String productVersionId) {
    return jdbc.queryForObject("select scheme_id from facts.easyv_prototype_block"
        + " where product_version_id=? and block_id='page-1__left_1'", String.class, productVersionId);
  }

  private String signatureOf(String productVersionId, String column) {
    return jdbc.queryForObject("select " + column + " from facts.easyv_prototype_layout"
        + " where product_version_id=? and app_id='app-1'", String.class, productVersionId);
  }
}
