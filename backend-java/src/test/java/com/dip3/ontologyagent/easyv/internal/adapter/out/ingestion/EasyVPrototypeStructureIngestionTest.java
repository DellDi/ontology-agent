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
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.semantic.api.QueryIntent;
import com.dip3.ontologyagent.semantic.api.SemanticModel;
import com.dip3.ontologyagent.semantic.api.SemanticQueryPort;
import com.dip3.ontologyagent.semantic.internal.adapter.out.postgres.PostgresObjectQueryAdapter;
import com.dip3.ontologyagent.easyv.internal.adapter.out.postgres.PrototypeStructurePostgresAdapter;
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
        new EasyVCanonicalTransform(EasyVCanonicalTransform.Kind.APPLICATION, jdbc, json),
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
    assertEquals("page-1__left_2", jdbc.queryForObject("""
        select layout_structure #>> '{children,0,children,0,children,0,children,1,attributes,id}'
        from facts.easyv_prototype_layout where app_id='app-1'
        """, String.class));
    assertEquals(2, jdbc.queryForObject(
        "select schema_version from ingestion.data_product_versions where id=?", Integer.class,
        versions.get("easyv-prototype-layout")));
    assertEquals(0L, jdbc.queryForObject("""
        select count(*) from facts.easyv_prototype_layout
        where parse_status <> 'ok' and layout_structure is not null
        """, Long.class));

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
  void metricBindingsAreWhitelistedAndVersionedWithoutChangingStatisticalSignatures() {
    Map<String, Object> missing = validJson("4");
    var old = materializeAll(publish("binding-missing", rows(missing)), "binding-missing");
    Map<String, Object> bound = validJson("4");
    Map<String, Object> blocks = (Map<String, Object>) ((Map<String, Object>) bound.get("page-1")).get("blocks");
    Map<String, Object> left = new LinkedHashMap<>((Map<String, Object>) blocks.get("page-1__left_1"));
    left.put("boundMetricIds", List.of("metric-a"));
    left.put("boundMetrics", List.of(Map.of("metricId", "metric-a", "name", "不应保留的指标名称",
        "sourceColumns", List.of("不应保留的源列"))));
    blocks.put("page-1__left_1", left);
    var first = materializeAll(publish("binding-first", rows(bound)), "binding-first");
    String statusSql = "select metric_binding_status from facts.easyv_prototype_block "
        + "where product_version_id=? and block_id='page-1__left_1'";
    String bindingsSql = "select metric_bindings::text from facts.easyv_prototype_block "
        + "where product_version_id=? and block_id='page-1__left_1'";
    assertEquals("not_retained", jdbc.queryForObject(statusSql, String.class, old.get(PRODUCTS.get(1))));
    assertNull(jdbc.queryForObject(bindingsSql, String.class, old.get(PRODUCTS.get(1))));
    assertEquals("available", jdbc.queryForObject(statusSql, String.class, first.get(PRODUCTS.get(1))));
    var bindings = new JsonCodec().list(jdbc.queryForObject(bindingsSql, String.class, first.get(PRODUCTS.get(1))));
    assertEquals(List.of(Map.of("slotIndex", 0, "componentId", "c1", "metricId", "metric-a",
        "chartFamily", "line", "sceneType", "总览指标", "sourceType", "AI")), bindings);
    assertEquals(3, jdbc.queryForObject("select schema_version from ingestion.data_product_versions where id=?",
        Integer.class, first.get(PRODUCTS.get(1))));
    left.put("boundMetricIds", List.of("metric-b"));
    var changed = materializeAll(publish("binding-changed", rows(bound)), "binding-changed");
    assertNotEquals(contentHash(first.get(PRODUCTS.get(1))), contentHash(changed.get(PRODUCTS.get(1))));
    for (String product : List.of(PRODUCTS.get(0), PRODUCTS.get(2))) {
      assertEquals(contentHash(first.get(product)), contentHash(changed.get(product)));
    }
    assertEquals("metric-a", jdbc.queryForObject("""
        select metric_bindings #>> '{0,metricId}' from facts.easyv_prototype_block
        where product_version_id=? and block_id='page-1__left_1'
        """, String.class, first.get(PRODUCTS.get(1))));
    assertThrows(DataAccessException.class, () -> jdbc.update(
        "update facts.easyv_prototype_block set metric_bindings=null where product_version_id=?", first.get(PRODUCTS.get(1))));
  }

  @Test
  void freezesSourcePercentageGeometryAndTitlePresenceAndReadsExactVersionsForAssessment() {
    Map<String,Object> value=validJson("4");
    Map<String,Object> blocks=(Map<String,Object>)((Map<String,Object>)value.get("page-1")).get("blocks");
    Map<String,Object> left=new LinkedHashMap<>((Map<String,Object>)blocks.get("page-1__left_1"));
    left.put("boundMetricIds",List.of("metric-a"));
    Map<String,Object> component=new LinkedHashMap<>((Map<String,Object>)((List<?>)left.get("components")).getFirst());
    component.put("config",Map.of("relativeX","0%","relativeY","0%","width","100%","height","100%"));
    left.put("components",List.of(component));blocks.put("page-1__left_1",left);
    var first=materializeAll(publish("component-geometry-old",rows(value)),"component-geometry-old");
    var reader=new com.dip3.ontologyagent.easyv.internal.adapter.out.postgres.SchemeAssessmentPostgresAdapter(jdbc,new JsonCodec());
    var original=reader.block(first.get(PRODUCTS.get(1)),first.get(PRODUCTS.get(2)),"app-1","page-1__left_1");
    assertEquals(true,original.titlePresent());assertEquals("available",original.components().getFirst().geometry().status());
    assertEquals(100,original.components().getFirst().geometry().box().width());
    component.put("config",Map.of("relativeX","0%","relativeY","0%","width","40%","height","100%"));
    left.put("title","  ");
    var changed=materializeAll(publish("component-geometry-new",rows(value)),"component-geometry-new");
    var newer=reader.block(changed.get(PRODUCTS.get(1)),changed.get(PRODUCTS.get(2)),"app-1","page-1__left_1");
    assertEquals(false,newer.titlePresent());assertEquals(40,newer.components().getFirst().geometry().box().width());
    assertEquals(original,reader.block(first.get(PRODUCTS.get(1)),first.get(PRODUCTS.get(2)),"app-1","page-1__left_1"));
    assertNotEquals(contentHash(first.get(PRODUCTS.get(1))),contentHash(changed.get(PRODUCTS.get(1))));
    assertNotEquals(contentHash(first.get(PRODUCTS.get(2))),contentHash(changed.get(PRODUCTS.get(2))));
    assertEquals(signatureOf(first.get(PRODUCTS.get(0)),"chart_signature"),signatureOf(changed.get(PRODUCTS.get(0)),"chart_signature"));
    assertEquals(2,jdbc.queryForObject("select schema_version from ingestion.data_product_versions where id=?",Integer.class,changed.get(PRODUCTS.get(2))));
    var viewer=new com.dip3.ontologyagent.auth.AuthSession("test","1","用户",new com.dip3.ontologyagent.auth.AccessScope("org",List.of(),List.of(),List.of("PLATFORM_ADMIN")),java.time.Instant.MAX);
    reader.audit("assessment-evidence","session-test",viewer,Map.of("input",original,"ruleVersion","easyv-adaptation-v1"));
    assertEquals("easyv-adaptation-v1",jdbc.queryForObject("select payload->>'ruleVersion' from platform.audit_events where id='assessment-evidence'",String.class));
    assertEquals("1",jdbc.queryForObject("select user_id from platform.audit_events where id='assessment-evidence'",String.class));
    assertEquals(180,jdbc.queryForObject("select extract(day from retention_until-created_at)::int from platform.audit_events where id='assessment-evidence'",Integer.class));
  }

  @Test
  void malformedMetricBindingRemainsVisibleAlongsideValidStructure() {
    Map<String, Object> value = validJson("4");
    Map<String, Object> blocks = (Map<String, Object>) ((Map<String, Object>) value.get("page-1")).get("blocks");
    Map<String, Object> left = new LinkedHashMap<>((Map<String, Object>) blocks.get("page-1__left_1"));
    left.put("boundMetricIds", List.of("metric-a", "metric-b"));
    blocks.put("page-1__left_1", left);
    var versions = materializeAll(publish("binding-invalid", rows(value)), "binding-invalid");
    assertEquals("invalid", jdbc.queryForObject("""
        select metric_binding_status from facts.easyv_prototype_block
        where product_version_id=? and block_id='page-1__left_1'
        """, String.class, versions.get(PRODUCTS.get(1))));
    assertNull(jdbc.queryForObject("""
        select metric_bindings from facts.easyv_prototype_block
        where product_version_id=? and block_id='page-1__left_1'
        """, String.class, versions.get(PRODUCTS.get(1))));
    assertEquals(3L, count("facts.easyv_prototype_component", versions.get(PRODUCTS.get(2))));
    assertEquals("ok", jdbc.queryForObject("select parse_status from facts.easyv_prototype_layout "
        + "where product_version_id=? and app_id='app-1'", String.class, versions.get(PRODUCTS.get(0))));
  }

  @Test
  void geometryChangesAreVersionedWithoutRewritingOlderFactsOrStatisticalSignatures() {
    List<SourceRow> originalRows = rows(validJson("4"));
    Map<String, String> first = materializeAll(publish("geometry-1", originalRows), "geometry-1");
    List<SourceRow> changedRows = new ArrayList<>(originalRows);
    List<Object> changedValues = new ArrayList<>(originalRows.get(0).values());
    changedValues.set(2, XML.replace("gap=\"24\"", "gap=\"32\""));
    changedRows.set(0, new SourceRow(changedValues));
    Map<String, String> second = materializeAll(publish("geometry-2", changedRows), "geometry-2");
    assertNotEquals(contentHash(first.get("easyv-prototype-layout")), contentHash(second.get("easyv-prototype-layout")));
    assertEquals(signatureOf(first.get("easyv-prototype-layout"), "layout_signature"),
        signatureOf(second.get("easyv-prototype-layout"), "layout_signature"));
    String gapSql = "select layout_structure #>> '{children,0,children,0,children,0,attributes,gap}' "
        + "from facts.easyv_prototype_layout where app_id='app-1' and product_version_id=?";
    assertEquals("24", jdbc.queryForObject(gapSql, String.class, first.get("easyv-prototype-layout")));
    assertEquals("32", jdbc.queryForObject(gapSql, String.class, second.get("easyv-prototype-layout")));
    assertThrows(DataAccessException.class, () -> jdbc.update(
        "update facts.easyv_prototype_layout set layout_structure=null where product_version_id=?",
        first.get("easyv-prototype-layout")));
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

  @Test
  void objectReadsUseFrozenScopeStablePagesAndDeclaredRelations() {
    var time = LocalDateTime.parse("2026-09-04T09:00:00");
    var input = new ArrayList<>(rows(validJson("4")));
    input.add(row(5L, "app-5", XML, validJson("4"), time, time));
    var versions = materializeAll(publish("object-source", input), "objects");
    versions.put("easyv-ai-application", applicationVersion("objects", false));
    var reader = new PostgresObjectQueryAdapter(jdbc, SemanticModel.discover());
    var all = new SemanticQueryPort.AccessContext(versions, SemanticQueryPort.Scope.everything());
    var scoped = new SemanticQueryPort.AccessContext(versions,
        SemanticQueryPort.Scope.restricted(Map.of("userId", List.of("16"))));
    var first = reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(),
        List.of(new QueryIntent.Order("createdAt", QueryIntent.Direction.ASC)), 2, 0), all);
    assertEquals(List.of("app-1", "app-2"), first.rows().stream().map(r -> r.reference().objectId()).toList());
    assertTrue(first.hasMore());
    var next = reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(),
        List.of(new QueryIntent.Order("createdAt", QueryIntent.Direction.ASC)), 2, 2), all);
    assertEquals(List.of("app-4", "app-5"), next.rows().stream().map(r -> r.reference().objectId()).toList());
    assertTrue(!next.hasMore()); // deleted app-3 excluded by required application membership
    assertEquals(3, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), null, null, 50, 0), scoped).rows().size());
    assertEquals(2, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(
        new QueryIntent.Filter("blockCount", QueryIntent.Operator.GTE, List.of("3")),
        new QueryIntent.Filter("createdAt", QueryIntent.Operator.GTE, List.of("2026-09-03T00:00:00Z"))), null, 50, 0), all).rows().size());
    assertEquals(2, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(
        new QueryIntent.Filter("parseErrorCode", QueryIntent.Operator.SET, null)), null, 50, 0), all).rows().size());
    assertEquals(0, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(
        new QueryIntent.Filter("appId", QueryIntent.Operator.CONTAINS, List.of("%"))), null, 50, 0), all).rows().size());
    assertEquals(0, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), null, null, 50, 10), all).rows().size());
    assertEquals("OBJECT_NOT_FOUND", assertThrows(BackendException.class,
        () -> reader.require(PRODUCTS.get(0), "app-5", scoped)).code());
    var blocks = reader.related(PRODUCTS.get(0), "app-1", "blocks",
        new ObjectQueryPort.Query(PRODUCTS.get(1), null, null, 50, 0), scoped);
    assertEquals(3, blocks.rows().size());
    assertTrue(blocks.rows().stream().allMatch(r -> "app-1".equals(r.properties().get("appId"))));
    var components = reader.related(PRODUCTS.get(1), "1:page-1__left_1", "components",
        new ObjectQueryPort.Query(PRODUCTS.get(2), null, null, 50, 0), all);
    assertEquals(List.of("1:c1"), components.rows().stream().map(r -> r.reference().objectId()).toList());
    assertEquals(1, components.rows().getFirst().properties().get("gridCol"));
    assertEquals("1:page-1__left_1", reader.related(PRODUCTS.get(2), "1:c1", "block",
        new ObjectQueryPort.Query(PRODUCTS.get(1), null, null, 50, 0), all).rows().getFirst().reference().objectId());
    assertEquals(0, reader.related(PRODUCTS.get(0), "app-2", "blocks",
        new ObjectQueryPort.Query(PRODUCTS.get(1), null, null, 50, 0), all).rows().size());
    assertEquals("invalid_xml", reader.require(PRODUCTS.get(0), "app-2", all).properties().get("parseStatus"));
    var structures = new PrototypeStructurePostgresAdapter(jdbc, new JsonCodec());
    assertEquals("Pages", structures.structure(versions.get(PRODUCTS.get(0)), "app-1").get("tag"));
    assertNull(structures.structure(versions.get(PRODUCTS.get(0)), "app-2"));
  }

  @Test
  void objectReadsNeverSwitchVersionsAndRejectUntrustedQueryMembers() {
    var first = materializeAll(publish("read-old", rows(validJson("4"))), "read-old");
    first.put("easyv-ai-application", applicationVersion("read-old", false));
    var second = new LinkedHashMap<>(first);
    second.put("easyv-ai-application", applicationVersion("read-new", true));
    var reader = new PostgresObjectQueryAdapter(jdbc, SemanticModel.discover());
    var old = new SemanticQueryPort.AccessContext(first, SemanticQueryPort.Scope.everything());
    var newer = new SemanticQueryPort.AccessContext(second, SemanticQueryPort.Scope.everything());
    assertEquals("app-1", reader.require(PRODUCTS.get(0), "app-1", old).reference().objectId());
    assertEquals("OBJECT_NOT_FOUND", assertThrows(BackendException.class,
        () -> reader.require(PRODUCTS.get(0), "app-1", newer)).code());
    assertEquals(0, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(1), null, null, 50, 0), newer).rows().size());
    assertEquals(0, reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(
        new QueryIntent.Filter("appId", QueryIntent.Operator.EQUALS, List.of("app-1' OR TRUE --"))), null, 50, 0), old).rows().size());
    assertThrows(BackendException.class, () -> reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(
        new QueryIntent.Filter("app_id); DROP TABLE facts.easyv_prototype_layout; --", QueryIntent.Operator.SET, null)), null, 50, 0), old));
    assertEquals("OBJECT_QUERY_INVALID", assertThrows(BackendException.class,
        () -> reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), null, null, 201, 0), old)).code());
    assertEquals("OBJECT_QUERY_INVALID", assertThrows(BackendException.class,
        () -> reader.query(new ObjectQueryPort.Query(PRODUCTS.get(0), List.of(
            new QueryIntent.Filter("blockCount", QueryIntent.Operator.GT, List.of("NaN"))), null, 50, 0), old)).code());
    var missing = new LinkedHashMap<>(first); missing.remove("easyv-ai-application");
    assertEquals("DATASET_VERSION_SET_INCOMPLETE", assertThrows(BackendException.class, () -> reader.require(
        PRODUCTS.get(0), "app-1", new SemanticQueryPort.AccessContext(missing, SemanticQueryPort.Scope.everything()))).code());
  }

  private String applicationVersion(String suffix, boolean deleteFirst) {
    var time = LocalDateTime.parse("2026-09-04T09:00:00");
    List<SourceRow> rows = List.of(
        row(1L, "app-1", null, 16L, 1L, 1L, "USER", time, time, deleteFirst ? "1" : "0"),
        row(2L, "app-2", null, 16L, 1L, 1L, "USER", time, time, "0"),
        row(3L, "app-3", null, 16L, 1L, 1L, "USER", time, time, "1"),
        row(4L, "app-4", null, 16L, 1L, 1L, "USER", time, time, "0"),
        row(5L, "app-5", null, 17L, 1L, 1L, "USER", time, time, "0"));
    String source = publishDataset("app-" + suffix, rows, IngestionRun.Mode.FULL, null, 1, "easyv-ai-application");
    return materializer.materialize(new ProductMaterializer.Command("app-product-run-" + suffix,
        "easyv-ai-application", "app-product-version-" + suffix, ProductMaterializationRun.Mode.FULL,
        ProductMaterializationRun.TriggerType.BOOTSTRAP, "test", "trace-app-" + suffix,
        Map.of("source", source))).id();
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
    return publishDataset(runId, rows, mode, parentVersion, schemaVersion, DATASET);
  }

  private String publishDataset(String runId, List<SourceRow> rows, IngestionRun.Mode mode,
      String parentVersion, int schemaVersion, String datasetKey) {
    DatasetDefinition dataset = sourceCatalog.loadActiveSource("easyv").datasets().stream()
        .filter(candidate -> datasetKey.equals(candidate.datasetKey())).findFirst().orElseThrow();
    persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(
        runId, "easyv", mode, IngestionRun.TriggerType.BOOTSTRAP, "test",
        "trace-" + runId, Map.of("connector", "test")));
    persistence.startSourceRun(runId);
    String versionId = "source-version-" + runId;
    persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(
        runId, List.of(new IngestionPersistencePort.SourceDatasetReservation(
            versionId, datasetKey, parentVersion, Map.of("snapshot", runId), schemaVersion))));
    var receipts = rows.isEmpty() ? List.<IngestionPersistencePort.SourceBatchReceipt>of()
        : List.of(persistence.appendSourceBatch(new IngestionPersistencePort.SourceBatchAppend(
            versionId, 1, rows.size(), codec.encode(dataset, rows))));
    persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(runId, List.of(
        new IngestionPersistencePort.SourceDatasetPublication(datasetKey, receipts.size(), rows.size(),
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
