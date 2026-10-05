package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.*;
import com.dip3.ontologyagent.ingestion.internal.application.*;
import com.dip3.ontologyagent.support.JsonCodec;
import com.dip3.ontologyagent.support.MigrationTestSupport;
import java.util.*;
import javax.sql.DataSource;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.junit.jupiter.api.Assertions.*;

@Testcontainers
class EasyVSchemeCanonicalTransformTest {
  @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
  private JdbcTemplate jdbc;
  private IngestionPersistencePort persistence;
  private SourceCatalogPort sourceCatalog;
  private RowPackV1Codec codec;
  private ProductMaterializer materializer;
  private static final String SLOTS = """
      [{"block_internal_id":"1","role":"main","weight":1,"name":"不保留","bindMetric":"private_metric",
        "position":{"col":1,"row":1,"colSpan":12,"rowSpan":12},
        "config":{"x":"0%","y":"0%","width":"100%","height":"100%"}}]
      """;

  @BeforeAll static void migrate() { MigrationTestSupport.migrate(POSTGRES); }
  @BeforeEach void setup() {
    DataSource dataSource = new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());
    jdbc = new JdbcTemplate(dataSource);
    jdbc.execute("truncate ingestion.dataset_version_sets, ingestion.data_product_versions, ingestion.product_materialization_runs, ingestion.source_ingestion_runs cascade");
    JsonCodec json = new JsonCodec();
    persistence = new IngestionPostgresPersistenceAdapter(jdbc,json,new JdbcTransactionManager(dataSource));
    sourceCatalog = new SourceCatalogPostgresAdapter(jdbc,json);
    codec = new RowPackV1Codec();
    materializer = new ProductMaterializer(new ProductCatalogPostgresAdapter(jdbc,json,sourceCatalog),
        new CanonicalProductTransformRegistry(List.of(new EasyVSchemeCanonicalTransform(jdbc,json))),codec,persistence);
  }

  @Test void actualVarcharAndInt4SourceContractsPublishThroughTheReleaseOrchestrator() {
    jdbc.execute("create schema if not exists easyv_saas");
    jdbc.execute("drop table if exists easyv_saas.ai_block_data,easyv_saas.ai_block_internal_data");
    // 与源仓库 20260604-1-tables.sql 的实际 JDBC 类型一致。
    jdbc.execute("create table easyv_saas.ai_block_data(id int4 not null, chat_count int4 not null, block_type_id varchar not null, block_slots_data varchar not null, pattern_tag varchar)");
    jdbc.execute("create table easyv_saas.ai_block_internal_data(id int4 not null, recommend_type varchar not null, allowed_chart_categories varchar)");
    jdbc.update("insert into easyv_saas.ai_block_data values (39,1,'3',?,'stacked_main')",SLOTS);
    jdbc.update("insert into easyv_saas.ai_block_internal_data values (1,'[\"基础图表类\"]','[\"basic\"]')");
    SourceCatalogPort scopedCatalog = key -> {
      var catalog=sourceCatalog.loadActiveSource(key);
      var selected=Set.of("easyv-block-scheme","easyv-slot-type");
      return new SourceCatalogPort.SourceCatalog(catalog.source(),catalog.datasets().stream().filter(d->selected.contains(d.datasetKey())).toList(),
          catalog.committedCursors().stream().filter(c->selected.contains(c.datasetKey())).toList());
    };
    var sourceDataSource=jdbc.getDataSource();
    var connector = new com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres.PostgresSourceConnector(
        ref -> new com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider.ResolvedConnection(
            sourceDataSource,new JdbcTransactionManager(sourceDataSource),5));
    var orchestrator=new SourceIngestionOrchestrator(scopedCatalog,new SourceConnectorRegistry(List.of(connector)),codec,persistence);
    var publisher=new DatasetReleasePublisher(orchestrator,scopedCatalog,new ProductCatalogPostgresAdapter(jdbc,new JsonCodec(),scopedCatalog),materializer,persistence);
    var first=publisher.publish(new DatasetReleasePublisher.Command("scheme-release","easyv",Set.of(EasyVSchemeCanonicalTransform.PRODUCT_KEY),IngestionRun.Mode.FULL,IngestionRun.TriggerType.MANUAL,"test","trace-real-contract",1));
    assertEquals(2,first.sourceVersions().size());
    assertEquals("available",status(first.productVersions().get(EasyVSchemeCanonicalTransform.PRODUCT_KEY).id()));
    jdbc.update("update easyv_saas.ai_block_internal_data set allowed_chart_categories='[\"table\"]' where id=1");
    var next=publisher.publish(new DatasetReleasePublisher.Command("scheme-reconcile","easyv",Set.of(EasyVSchemeCanonicalTransform.PRODUCT_KEY),IngestionRun.Mode.RECONCILE,IngestionRun.TriggerType.MANUAL,"test","trace-reconcile",1));
    assertNotEquals(first.productVersions().get(EasyVSchemeCanonicalTransform.PRODUCT_KEY).contentHash(),next.productVersions().get(EasyVSchemeCanonicalTransform.PRODUCT_KEY).contentHash());
    assertEquals("basic",jdbc.queryForObject("select slots #>> '{0,allowedChartCategories,0}' from facts.easyv_scheme_library where product_version_id=?",String.class,first.productVersions().get(EasyVSchemeCanonicalTransform.PRODUCT_KEY).id()));
    assertEquals(1,jdbc.queryForObject("select count(*) from easyv_saas.ai_block_data",Integer.class));
  }

  @Test void materializesTwoFrozenSourcesAndRetainsBothVersionsInLineage() {
    Map<String,String> inputs = publish("first", SLOTS, "[\"basic\"]");
    String version = materialize("first",inputs);
    assertEquals(2, jdbc.queryForObject("select count(*) from ingestion.data_product_version_lineage where product_version_id=?",Integer.class,version));
    assertEquals(Set.copyOf(inputs.values()), Set.copyOf(jdbc.queryForList("select source_dataset_version_id from ingestion.data_product_version_lineage where product_version_id=?",String.class,version)));
    assertEquals("available",status(version));
    String projected = jdbc.queryForObject("select slots::text from facts.easyv_scheme_library where product_version_id=?",String.class,version);
    assertTrue(projected.contains("basic")); assertTrue(projected.contains("基础图表类"));
    assertFalse(projected.contains("不保留")); assertFalse(projected.contains("private_metric"));
    assertEquals(hash(version),hash(materialize("repeat",inputs)));
    var set = persistence.freezeVersionSet(new IngestionPersistencePort.VersionSetPublication("scheme-set",Map.of(EasyVSchemeCanonicalTransform.PRODUCT_KEY,version),java.time.Instant.now(),"test"));
    assertEquals(version,set.productVersionIds().get(EasyVSchemeCanonicalTransform.PRODUCT_KEY));
    assertThrows(DataAccessException.class,()->jdbc.update("update facts.easyv_scheme_library set slots=null where product_version_id=?",version));
    assertThrows(DataAccessException.class,()->jdbc.update("delete from facts.easyv_scheme_library where product_version_id=?",version));
    var insertError=assertThrows(DataAccessException.class,()->jdbc.update("""
        insert into facts.easyv_scheme_library
          (product_version_id,source_dataset_key,source_dataset_version_id,source_id,block_type_id,
           chart_count,pattern_tag,parse_status,parse_error_code,slots)
        select product_version_id,source_dataset_key,source_dataset_version_id,source_id+9000,block_type_id,
           chart_count,pattern_tag,parse_status,parse_error_code,slots
        from facts.easyv_scheme_library where product_version_id=?
        """,version));
    assertTrue(insertError.getMessage().contains("canonical fact requires BUILDING product version"));
  }

  @Test void changedConstraintChangesContentWithoutRewritingOldSchemeFacts() {
    String first=materialize("first",publish("first",SLOTS,"[\"basic\"]"));
    String changed=materialize("changed",publish("changed",SLOTS,"[\"table\"]"));
    assertNotEquals(hash(first),hash(changed));
    assertEquals("basic",jdbc.queryForObject("select slots #>> '{0,allowedChartCategories,0}' from facts.easyv_scheme_library where product_version_id=?",String.class,first));
    assertEquals("table",jdbc.queryForObject("select slots #>> '{0,allowedChartCategories,0}' from facts.easyv_scheme_library where product_version_id=?",String.class,changed));
    var reader=new com.dip3.ontologyagent.easyv.internal.adapter.out.postgres.SchemeAssessmentPostgresAdapter(jdbc,new JsonCodec());
    assertEquals(List.of("basic"),reader.candidates(first,"3").getFirst().slots().getFirst().allowedChartCategories());
    assertEquals(List.of("table"),reader.candidates(changed,"3").getFirst().slots().getFirst().allowedChartCategories());
    assertEquals("39",reader.candidates(first,"3").getFirst().schemeId());
    assertTrue(reader.candidates(first,"other").isEmpty());
    assertTrue(reader.candidates(first,"3' OR TRUE --").isEmpty());
  }

  @Test void missingOrInvalidReferencedConstraintKeepsLocatableSchemeFacts() {
    String missing=materialize("missing",publish("missing",SLOTS.replace("\"1\"","\"7\""),"[]"));
    assertEquals("missing",status(missing));
    assertEquals("SCHEME_CONSTRAINT_MISSING",error(missing));
    String malformed=materialize("malformed",publish("malformed",SLOTS,"{"));
    assertEquals("invalid",status(malformed)); assertEquals("SCHEME_JSON_MALFORMED",error(malformed));
    String badSlots=materialize("slots",publish("slots","[]","[]"));
    assertEquals("SCHEME_COUNT_MISMATCH",error(badSlots));
    assertEquals(3,jdbc.queryForObject("select count(*) from facts.easyv_scheme_library",Integer.class));
    assertEquals(0,jdbc.queryForObject("select count(*) from facts.easyv_scheme_library where slots is not null",Integer.class));
  }

  @Test void materializationRejectsMissingRequiredInputBeforeCreatingFacts() {
    Map<String,String> inputs=publish("first",SLOTS,"[]");
    var error=assertThrows(com.dip3.ontologyagent.support.BackendException.class,()->materialize("missing-input",Map.of("source",inputs.get("source"))));
    assertEquals("INGESTION_PRODUCT_INPUT_REQUIRED",error.code());
    assertEquals(0,jdbc.queryForObject("select count(*) from facts.easyv_scheme_library",Integer.class));
  }

  private String status(String version) {return jdbc.queryForObject("select parse_status from facts.easyv_scheme_library where product_version_id=?",String.class,version);}
  private String error(String version) {return jdbc.queryForObject("select parse_error_code from facts.easyv_scheme_library where product_version_id=?",String.class,version);}
  private String hash(String version) {return jdbc.queryForObject("select content_hash from ingestion.data_product_versions where id=?",String.class,version);}
  private String materialize(String suffix,Map<String,String> inputs) {
    return materializer.materialize(new ProductMaterializer.Command("product-run-"+suffix,EasyVSchemeCanonicalTransform.PRODUCT_KEY,"product-"+suffix,
        ProductMaterializationRun.Mode.FULL,ProductMaterializationRun.TriggerType.BOOTSTRAP,"test","trace-"+suffix,inputs)).id();
  }
  private Map<String,String> publish(String suffix,String slots,String categories) {
    String run="source-run-"+suffix;
    Map<String,SourceRow> rows=Map.of("easyv-block-scheme",new SourceRow(Arrays.asList(39L,1,"3",slots,"stacked_main")),
        "easyv-slot-type",new SourceRow(Arrays.asList(1L,"[\"基础图表类\"]",categories)));
    var datasets=sourceCatalog.loadActiveSource("easyv").datasets().stream().filter(d->rows.containsKey(d.datasetKey())).toList();
    persistence.createSourceRun(new IngestionPersistencePort.SourceRunRequest(run,"easyv",IngestionRun.Mode.RECONCILE,IngestionRun.TriggerType.BOOTSTRAP,"test","trace-"+suffix,Map.of("snapshot",suffix)));
    persistence.startSourceRun(run);
    Map<String,String> versions=new LinkedHashMap<>();
    persistence.reserveSourceVersions(new IngestionPersistencePort.SourceVersionReservation(run,datasets.stream().map(d->{
      String version="source-"+d.datasetKey()+"-"+suffix;versions.put(d.datasetKey(),version);
      return new IngestionPersistencePort.SourceDatasetReservation(version,d.datasetKey(),null,Map.of("snapshot",suffix),d.schemaVersion());
    }).toList()));
    List<IngestionPersistencePort.SourceDatasetPublication> publications=new ArrayList<>();
    for (var d:datasets) {
      var receipt=persistence.appendSourceBatch(new IngestionPersistencePort.SourceBatchAppend(versions.get(d.datasetKey()),1,1,codec.encode(d,List.of(rows.get(d.datasetKey())))));
      publications.add(new IngestionPersistencePort.SourceDatasetPublication(d.datasetKey(),1,1,SourceBatchManifest.aggregate(List.of(receipt)).contentHash(),Map.of("complete",true)));
    }
    persistence.publishSourceSnapshot(new IngestionPersistencePort.SourcePublication(run,publications));
    return Map.of("source",versions.get("easyv-block-scheme"),"slot-types",versions.get("easyv-slot-type"));
  }
}
