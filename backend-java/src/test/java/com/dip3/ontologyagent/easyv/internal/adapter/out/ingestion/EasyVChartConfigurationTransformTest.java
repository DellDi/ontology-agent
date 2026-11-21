package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.codec.RowPackV1Codec;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence.*;
import com.dip3.ontologyagent.ingestion.internal.adapter.out.postgres.PostgresSourceConnector;
import com.dip3.ontologyagent.ingestion.internal.application.*;
import com.dip3.ontologyagent.ingestion.spi.PostgresSourceConnectionProvider;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.semantic.internal.adapter.out.postgres.PostgresObjectQueryAdapter;
import com.dip3.ontologyagent.support.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.JdbcTransactionManager;
import org.testcontainers.junit.jupiter.*;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.junit.jupiter.api.Assertions.*;

/** 独立测试容器：按源 v8.22 JDBC 类型走真实采集、发布、冻结与权限链路。 */
@Testcontainers
class EasyVChartConfigurationTransformTest {
  @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
  private static final Set<String> KEYS = Set.of("easyv-chart-type","easyv-chart-category","easyv-chart-priority","easyv-config-audit");
  private JdbcTemplate jdbc;
  private DatasetReleasePublisher publisher;
  @BeforeAll static void migrate() { MigrationTestSupport.migrate(POSTGRES); }
  @BeforeEach void setup() {
    var ds=new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword());
    jdbc=new JdbcTemplate(ds);
    jdbc.execute("truncate ingestion.dataset_version_sets,ingestion.data_product_versions,ingestion.product_materialization_runs,ingestion.source_ingestion_runs cascade");
    jdbc.execute("create schema if not exists easyv_saas");
    jdbc.execute("drop table if exists easyv_saas.ai_chart_type_mapping,easyv_saas.ai_chart_category,easyv_saas.ai_scene_chart_priority,easyv_saas.ai_block_admin_audit");
    jdbc.execute("create table easyv_saas.ai_chart_type_mapping(id int4 not null,chart_type varchar not null,chart_family varchar not null,scene_tag varchar not null,description_terms varchar,data_requirement varchar,suitable_for varchar,is_fallback int2 not null,status varchar(1) not null,sort_order int4 not null)");
    jdbc.execute("create table easyv_saas.ai_chart_category(id int4 not null,category_name varchar not null,chart_types varchar not null,sort_order int4 not null)");
    jdbc.execute("create table easyv_saas.ai_scene_chart_priority(id int4 not null,scene_type varchar not null,primary_charts varchar not null,secondary_charts varchar not null,tertiary_charts varchar not null,fallback_chart varchar,sort_order int4 not null)");
    jdbc.execute("create table easyv_saas.ai_block_admin_audit(id int8 not null,table_name varchar not null,row_key varchar not null,action varchar not null,before_json text,after_json text,operator varchar,created_at timestamptz not null)");
    jdbc.update("insert into easyv_saas.ai_chart_type_mapping values (1,'折线图','line','趋势','[\"变化\"]',null,null,0,'0',1),(2,'旧图','legacy','趋势',null,null,null,1,'1',2)");
    jdbc.update("insert into easyv_saas.ai_chart_category values (1,'趋势','[\"折线图\",\"旧图\"]',1),(2,'空分类','[]',2)");
    jdbc.update("insert into easyv_saas.ai_scene_chart_priority values (1,'趋势','[\"折线图\"]','[]','[]','旧图',1),(2,'未配置','[]','[]','[]',null,2)");
    jdbc.update("insert into easyv_saas.ai_block_admin_audit values (1,'ai_chart_type_mapping','1','STATUS',null,'{\"status\":\"0\"}','secret-not-to-ingest','2026-10-22T10:00:00+08:00'),(2,'ai_chart_category','1','UPDATE','{\"chartTypes\":[]}','{\"chartTypes\":[\"折线图\"]}',null,'2026-10-22T11:00:00+08:00')");
    var json=new JsonCodec();
    var persistence=new IngestionPostgresPersistenceAdapter(jdbc,json,new JdbcTransactionManager(ds));
    var catalog=new SourceCatalogPostgresAdapter(jdbc,json);
    SourceCatalogPort scoped=key->{
      var source=catalog.loadActiveSource(key);
      return new SourceCatalogPort.SourceCatalog(source.source(),source.datasets().stream().filter(d->KEYS.contains(d.datasetKey())).toList(),
          source.committedCursors().stream().filter(c->KEYS.contains(c.datasetKey())).toList());
    };
    var products=new ProductCatalogPostgresAdapter(jdbc,json,scoped);
    var codec=new RowPackV1Codec();
    var transforms=Arrays.stream(EasyVChartConfigurationTransform.Kind.values())
        .map(kind->(CanonicalProductTransform)new EasyVChartConfigurationTransform(kind,jdbc,json)).toList();
    var materializer=new ProductMaterializer(products,new CanonicalProductTransformRegistry(transforms),codec,persistence);
    var connector=new PostgresSourceConnector(ref->new PostgresSourceConnectionProvider.ResolvedConnection(ds,new JdbcTransactionManager(ds),5));
    var orchestrator=new SourceIngestionOrchestrator(scoped,new SourceConnectorRegistry(List.of(connector)),codec,persistence);
    publisher=new DatasetReleasePublisher(orchestrator,scoped,products,materializer,persistence);
  }
  private Map<String,String> publish(String id) {
    var result=publisher.publish(new DatasetReleasePublisher.Command(id,"easyv",KEYS,IngestionRun.Mode.RECONCILE,IngestionRun.TriggerType.MANUAL,"test",id,1));
    var versions=new HashMap<String,String>();
    result.productVersions().forEach((key,value)->versions.put(key,value.id()));
    return Map.copyOf(versions);
  }
  @Test void freezesListsAuditCoverageAndConfigurationChangesWithoutMutatingHistory() {
    var first=publish("first");
    assertEquals(3,jdbc.queryForObject("select count(*) from facts.easyv_chart_category",Integer.class));
    assertEquals(List.of("折线图","旧图"),jdbc.queryForList("select chart_type from facts.easyv_chart_category where chart_type is not null order by position",String.class));
    assertEquals(2,jdbc.queryForObject("select count(*) from ingestion.data_product_version_lineage where product_version_id=?",Integer.class,first.get("easyv-chart-priority")));
    assertEquals(false,jdbc.queryForObject("select has_before from facts.easyv_config_audit where source_id=1",Boolean.class));
    assertEquals("2026-10-22T02:00:00Z",jdbc.queryForObject("select created_at from facts.easyv_config_audit where source_id=1",java.sql.Timestamp.class).toInstant().toString());
    assertEquals(0,jdbc.queryForObject("select count(*) from information_schema.columns where table_schema='facts' and table_name='easyv_config_audit' and column_name='operator'",Integer.class));
    jdbc.update("update easyv_saas.ai_chart_type_mapping set status='1' where id=1");
    jdbc.update("update easyv_saas.ai_chart_category set chart_types='[]' where id=1");
    var next=publish("next");
    assertEquals("0",jdbc.queryForObject("select status from facts.easyv_chart_type where product_version_id=? and source_id=1",String.class,first.get("easyv-chart-type")));
    assertEquals("1",jdbc.queryForObject("select status from facts.easyv_chart_type where product_version_id=? and source_id=1",String.class,next.get("easyv-chart-type")));
    assertThrows(DataAccessException.class,()->jdbc.update("update facts.easyv_chart_type set status='0'"));
    var reader=new PostgresObjectQueryAdapter(jdbc,SemanticModel.discover());
    var access=new SemanticQueryPort.AccessContext(first,SemanticQueryPort.Scope.restricted(Map.of("userId",List.of("3"))));
    assertEquals(2,reader.query(new ObjectQueryPort.Query("easyv-chart-type",List.of(),List.of(),20,0),access).rows().size());
    var chart=reader.query(new ObjectQueryPort.Query("easyv-chart-type",List.of(),List.of(),20,0),access).rows().getFirst();
    assertEquals(1,reader.related(chart.reference().objectKey(),chart.reference().objectId(),"categories",new ObjectQueryPort.Query("easyv-chart-category",List.of(),List.of(),20,0),access).rows().size());
    assertThrows(BackendException.class,()->reader.query(new ObjectQueryPort.Query("easyv-config-audit",List.of(),List.of(),20,0),access));
    assertEquals(2,reader.query(new ObjectQueryPort.Query("easyv-config-audit",List.of(),List.of(),20,0),new SemanticQueryPort.AccessContext(first,SemanticQueryPort.Scope.everything())).rows().size());
    assertThrows(BackendException.class,()->reader.query(new ObjectQueryPort.Query("easyv-chart-type",List.of(),List.of(),20,0),new SemanticQueryPort.AccessContext(Map.of(),access.scope())));
  }
  @Test void invalidListsOrUnknownChartReferencesFailPublication() {
    jdbc.update("update easyv_saas.ai_chart_category set chart_types='[\"不存在\"]' where id=1");
    assertThrows(RuntimeException.class,()->publish("unknown"));
    assertEquals(0,jdbc.queryForObject("select count(*) from ingestion.dataset_version_sets",Integer.class));
    jdbc.update("update easyv_saas.ai_chart_category set chart_types='{}' where id=1");
    assertThrows(RuntimeException.class,()->publish("malformed"));
  }
  @Test void malformedAuditCannotBecomeAnApparentlyCompleteSnapshot() {
    jdbc.update("update easyv_saas.ai_block_admin_audit set before_json='[]' where id=1");
    assertThrows(RuntimeException.class,()->publish("bad-audit"));
    assertEquals(0,jdbc.queryForObject("select count(*) from ingestion.dataset_version_sets",Integer.class));
  }
}
