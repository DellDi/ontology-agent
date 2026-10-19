package com.dip3.ontologyagent.easyv.internal.adapter.out.writeback;

import com.dip3.ontologyagent.config.EasyVActionProperties;
import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.sync.RedisCommands;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@Testcontainers
class EasyVBlockActionDatabaseAdapterTest {
  @Container static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer("postgres:17.8-alpine");
  @Container static final GenericContainer<?> REDIS = new GenericContainer<>("redis:8-alpine").withExposedPorts(6379);
  static final ObjectMapper JSON = new ObjectMapper();
  static JdbcTemplate jdbc;
  RedisCommands<String,String> cache;
  EasyVBlockActionDatabaseAdapter adapter;
  Map<String,Object> plan;
  String original, output;
  static final String XML = """
      <Pages><Page id="page-1" width="1920" height="1080"><Layout type="test" grid-direction="horizontal">
        <Sider id="left" span="12/12" grid-direction="vertical">
          <Block id="b" block_type_id="1" span="6/12"/><Block id="other" block_type_id="1" span="6/12"/>
        </Sider></Layout></Page></Pages>
      """;
  @BeforeAll static void database() {
    jdbc = new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()));
    jdbc.execute("CREATE SCHEMA easyv_saas");
    jdbc.execute("CREATE TABLE easyv_saas.ai_screen_app (app_id text PRIMARY KEY, app_name text, generation_task_id text, user_id bigint, space_id bigint, team_id bigint, is_delete text)");
    jdbc.execute("CREATE TABLE easyv_saas.ai_screen_prototype (id bigint PRIMARY KEY, app_id text UNIQUE, screen_structure_xml text, screen_template_json jsonb, screen_prototype_json jsonb, screen_app_json jsonb, update_time timestamp)");
    jdbc.execute("CREATE TABLE easyv_saas.ai_pipeline_node_record (id bigint PRIMARY KEY, task_id text, step_name text, output jsonb)");
    jdbc.execute("CREATE TABLE easyv_saas.ai_block_data (id int PRIMARY KEY, block_type_id text, chat_count int, block_slots_data text)");
    jdbc.execute("CREATE TABLE easyv_saas.ai_block_internal_data (id int PRIMARY KEY, allowed_chart_categories text, recommend_type text)");
    jdbc.execute("CREATE TABLE easyv_saas.ai_chart_type_mapping (id int PRIMARY KEY, chart_type text, chart_family text, scene_tag text, status text, sort_order int)");
  }
  @BeforeEach @SuppressWarnings("unchecked") void fixture() throws Exception {
    jdbc.execute("DROP TRIGGER IF EXISTS reject_context ON easyv_saas.ai_pipeline_node_record");
    jdbc.execute("TRUNCATE easyv_saas.ai_screen_app, easyv_saas.ai_screen_prototype, easyv_saas.ai_pipeline_node_record, easyv_saas.ai_block_data, easyv_saas.ai_block_internal_data, easyv_saas.ai_chart_type_mapping");
    cache=mock(RedisCommands.class); adapter=new EasyVBlockActionDatabaseAdapter(jdbc,cache,"easyv_saas");
    ObjectNode block=JSON.createObjectNode();
    block.put("id","b"); block.put("businessModule","处置情况"); block.put("title","处置情况"); block.put("moduleName","处置情况");
    block.put("moduleDescription","先关注积压再看响应"); block.put("blockTypeId","1"); block.put("schemeId","1"); block.put("titlePresent",true);
    ArrayNode components=block.putArray("components"), ids=block.putArray("boundMetricIds"), metrics=block.putArray("boundMetrics");
    ArrayNode bindings=JSON.createArrayNode();
    for (int i=0;i<2;i++) {
      components.add(JSON.createObjectNode().put("id","c"+i).put("componentId","library"+i).put("metricName","指标"+i)
          .put("desc","定义"+i).put("chartFamily",i==0?"bar":"donut").put("sceneTag","保留来源")
          .set("config",JSON.readTree("{\"relativeX\":\"0%\",\"relativeY\":\""+(i*50)+"%\",\"width\":\"100%\",\"height\":\"50%\"}")));
      ids.add("m"+i); metrics.add(JSON.createObjectNode().put("metricId","m"+i).put("name","指标"+i).put("unit","个").put("aggregationRule","求和"));
      bindings.add(JSON.createObjectNode().put("slotIndex",i).put("chartType",i==0?"柱状图":"环形占比图").put("desc","定义"+i)
          .set("boundMetric",JSON.createObjectNode().put("metricId","m"+i).put("sourceId","actual-source").set("sourceColumns",JSON.valueToTree(List.of("real_column")))));
    }
    ObjectNode prototype=JSON.createObjectNode();
    var page=prototype.putObject("page-1"); page.put("title","业务屏"); page.putArray("contents"); page.putObject("blocks").set("b",block);
    page.withObject("/blocks").putObject("other").put("schemeId","other").putArray("components");
    original=JSON.writeValueAsString(prototype);
    var context=JSON.createObjectNode().put("blockId","b").put("businessModule","处置情况").put("moduleDescription","先关注积压再看响应").put("untouched","retain");
    context.set("selectedScheme",JSON.createObjectNode().put("schemeId","1").put("chartCount",2)); context.set("slotBindings",bindings);
    var event=JSON.createObjectNode().put("summary","原生成记录");
    var snapshot=event.putObject("output").putObject("raw").putObject("regenContextSnapshot"); snapshot.put("unrelated","keep"); snapshot.putArray("currentFilledBlocks").add(context);
    output=event.toString();
    jdbc.update("INSERT INTO easyv_saas.ai_screen_app VALUES ('app','业务屏','task',3,4,0,'0')");
    jdbc.update("INSERT INTO easyv_saas.ai_screen_prototype VALUES (1,'app',?,?::jsonb,?::jsonb,'{\"legacy\":true}',CURRENT_TIMESTAMP)",XML,"{\"template\":true}",original);
    jdbc.update("INSERT INTO easyv_saas.ai_pipeline_node_record VALUES (1,'task','PipelineCompleted',?::jsonb)",output);
    jdbc.update("INSERT INTO easyv_saas.ai_block_internal_data VALUES (1,'[\"chart\",\"indicator\"]','[]')");
    jdbc.update("INSERT INTO easyv_saas.ai_block_data VALUES (2,'1',2,?)", """
        [{"block_internal_id":1,"role":"main","weight":1,"position":{"col":1,"row":1,"colSpan":6,"rowSpan":12},"config":{"x":"0%","y":"0%","width":"50%","height":"100%"}},
         {"block_internal_id":1,"role":"summary","weight":1,"position":{"col":7,"row":1,"colSpan":6,"rowSpan":12},"config":{"x":"50%","y":"0%","width":"50%","height":"100%"}}]
        """);
    jdbc.update("INSERT INTO easyv_saas.ai_chart_type_mapping VALUES (1,'柱状图','bar','对比','0',1),(2,'条形图','horizontal-bar','对比','0',2),(3,'环形占比图','donut','占比','0',3)");
    plan=JSON.convertValue(JSON.readTree("""
        {"appId":"app","blockId":"b","title":"处置情况","purpose":"先关注积压再看响应","blockTypeId":"1","schemeId":"2",
         "choices":[{"componentId":"c1","metricId":"m1","name":"指标1","beforeChart":"donut","afterChart":"donut","slotIndex":0,"description":"定义1","unit":"个","aggregationRule":"求和"},
                    {"componentId":"c0","metricId":"m0","name":"指标0","beforeChart":"bar","afterChart":"horizontal-bar","slotIndex":1,"description":"定义0","unit":"个","aggregationRule":"求和"}]}
        """),Map.class);
  }
  @Test void preparationReadsLiveStateWithoutWritingOrInvalidatingCache() throws Exception {
    var prepared=prepare();
    assertEquals(JSON.readTree(original),prototype()); assertEquals(JSON.readTree(output),context());
    assertEquals("业务屏",prepared.get("applicationName")); assertNotEquals(prepared.get("before"),prepared.get("after")); verifyNoInteractions(cache);
  }
  @Test void commitsExactPrototypeAndEditingSnapshotAtomicallyAndPreservesOtherState() throws Exception {
    var prepared=prepare(); var result=adapter.apply(prepared,"3","4","0");
    assertEquals("verified",result.get("status")); assertEquals(JSON.valueToTree(prepared.get("after")).get("prototype"),prototype());
    assertEquals("c1",prototype().at("/page-1/blocks/b/components/0/id").asText());
    assertEquals("library1",prototype().at("/page-1/blocks/b/components/0/componentId").asText());
    assertEquals("horizontal-bar",prototype().at("/page-1/blocks/b/components/1/chartFamily").asText());
    assertEquals("50%",prototype().at("/page-1/blocks/b/components/1/config/relativeX").asText());
    assertEquals(JSON.readTree(original).at("/page-1/blocks/other"),prototype().at("/page-1/blocks/other"));
    assertEquals("real_column",context().at("/output/raw/regenContextSnapshot/currentFilledBlocks/0/slotBindings/0/boundMetric/sourceColumns/0").asText());
    assertEquals("m1",context().at("/output/raw/regenContextSnapshot/currentFilledBlocks/0/slotBindings/0/boundMetric/metricId").asText());
    assertEquals("keep",context().at("/output/raw/regenContextSnapshot/unrelated").asText());
    assertEquals("原生成记录",context().path("summary").asText());
    assertEquals(XML,jdbc.queryForObject("SELECT screen_structure_xml FROM easyv_saas.ai_screen_prototype",String.class));
    assertEquals("{\"legacy\": true}",jdbc.queryForObject("SELECT screen_app_json::text FROM easyv_saas.ai_screen_prototype",String.class));
    verify(cache).del("ai:screen:regen:task");
  }
  @Test void realRedisInvalidationRemovesStaleCacheAndKeepsNewPersistentSnapshot() {
    try (var client=RedisClient.create("redis://"+REDIS.getHost()+":"+REDIS.getMappedPort(6379)); var connection=client.connect()) {
      connection.sync().set("ai:screen:regen:task","old editing state");
      var actual=new EasyVBlockActionDatabaseAdapter(jdbc,connection.sync(),"easyv_saas");
      assertEquals("verified",actual.apply(prepare(),"3","4","0").get("status"));
      assertNull(connection.sync().get("ai:screen:regen:task"));
      assertEquals("2",context().at("/output/raw/regenContextSnapshot/currentFilledBlocks/0/selectedScheme/schemeId").asText());
    }
  }
  @Test void repeatedConfirmationDoesNotRewritePrototypeOrContext() {
    var prepared=prepare(); adapter.apply(prepared,"3","4","0");
    var time=jdbc.queryForObject("SELECT update_time FROM easyv_saas.ai_screen_prototype",Object.class); var saved=context();
    adapter.apply(prepared,"3","4","0");
    assertEquals(time,jdbc.queryForObject("SELECT update_time FROM easyv_saas.ai_screen_prototype",Object.class)); assertEquals(saved,context());
  }
  @Test void cacheFailureIsPendingAndSamePreparedActionRecoversWithoutRewritingDatabase() {
    var prepared=prepare(); when(cache.del(anyString())).thenThrow(new IllegalStateException("cache unavailable"));
    assertEquals("applied_context_pending",adapter.apply(prepared,"3","4","0").get("status"));
    var saved=prototype(); var time=jdbc.queryForObject("SELECT update_time FROM easyv_saas.ai_screen_prototype",Object.class);
    reset(cache); assertEquals("verified",adapter.apply(prepared,"3","4","0").get("status"));
    assertEquals(saved,prototype()); assertEquals(time,jdbc.queryForObject("SELECT update_time FROM easyv_saas.ai_screen_prototype",Object.class));
  }
  @Test void failedContextWriteRollsBackThePrototype() throws Exception {
    var prepared=prepare();
    jdbc.execute("CREATE OR REPLACE FUNCTION easyv_saas.reject_context_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'reject context write'; END $$");
    jdbc.execute("CREATE TRIGGER reject_context BEFORE UPDATE ON easyv_saas.ai_pipeline_node_record FOR EACH ROW EXECUTE FUNCTION easyv_saas.reject_context_write()");
    assertEquals("EASYV_ACTION_RESULT_UNKNOWN",failure(()->adapter.apply(prepared,"3","4","0")));
    assertEquals(JSON.readTree(original),prototype()); assertEquals(JSON.readTree(output),context()); verifyNoInteractions(cache);
  }
  @Test void rechecksLiveOwnershipEvenWhenTheFrozenPlatformRecordStillBelongsToTheViewer() {
    var prepared=prepare(); jdbc.update("UPDATE easyv_saas.ai_screen_app SET user_id=99");
    assertEquals("EASYV_ACTION_FORBIDDEN",failure(()->adapter.apply(prepared,"3","4","0"))); verifyNoInteractions(cache);
  }
  @Test void changedPrototypeOrSchemeCannotOverwriteAConfirmedResult() {
    var prepared=prepare(); jdbc.update("UPDATE easyv_saas.ai_screen_prototype SET screen_prototype_json=jsonb_set(screen_prototype_json,'{page-1,blocks,other,title}','\"人工调整\"')");
    assertEquals("EASYV_ACTION_REJECTED",failure(()->adapter.apply(prepared,"3","4","0"))); verifyNoInteractions(cache);
  }
  @Test void changedSchemeAfterPreparationRequiresReconfirmation() throws Exception {
    var prepared=prepare(); jdbc.update("UPDATE easyv_saas.ai_block_data SET block_type_id='different'");
    assertEquals("EASYV_ACTION_REJECTED",failure(()->adapter.apply(prepared,"3","4","0"))); assertEquals(JSON.readTree(original),prototype());
  }
  @Test void missingEditingSnapshotAndDisabledChartAreRejectedBeforeWriting() {
    jdbc.update("UPDATE easyv_saas.ai_chart_type_mapping SET status='1' WHERE chart_family='horizontal-bar'");
    assertEquals("EASYV_ACTION_REJECTED",failure(this::prepare));
    jdbc.update("UPDATE easyv_saas.ai_chart_type_mapping SET status='0'");
    jdbc.update("DELETE FROM easyv_saas.ai_pipeline_node_record"); assertEquals("EASYV_ACTION_REJECTED",failure(this::prepare)); verifyNoInteractions(cache);
  }
  @Test void textOnlyChangesPreserveAllComponentsAndRefreshThePersistedNames() throws Exception {
    plan.put("schemeId",null); plan.put("choices",List.of()); plan.put("targetTitle","积压与响应"); plan.put("targetPurpose","判断待处置积压和响应效率");
    adapter.apply(prepare(),"3","4","0");
    for (String field:List.of("title","moduleName","businessModule")) assertEquals("积压与响应",prototype().at("/page-1/blocks/b/"+field).asText());
    assertEquals(JSON.readTree(original).at("/page-1/blocks/b/components"),prototype().at("/page-1/blocks/b/components"));
    assertEquals("积压与响应",context().at("/output/raw/regenContextSnapshot/currentFilledBlocks/0/businessModule").asText());
  }
  @Test void invalidSchemaCannotBecomeAnSqlIdentifierAndDisabledAdapterDoesNotConnect() {
    assertThrows(IllegalArgumentException.class,()->new EasyVBlockActionDatabaseAdapter(jdbc,cache,"bad;DROP TABLE x"));
    assertEquals("EASYV_ACTION_NOT_CONFIGURED",failure(()->new EasyVBlockActionDatabaseAdapter(null,null,"easyv_saas").prepare(plan,"3","4","0")));
    var config=new EasyVActionProperties(false,"","","secret","easyv_saas","redis://:secret@localhost");
    assertFalse(config.toString().contains("secret"));
    assertThrows(IllegalArgumentException.class,()->new EasyVActionProperties(true,"","","","easyv_saas",""));
  }
  @Test void crossBlockChoicesAndCoreOrDynamicBlocksNeverBecomePrepared() {
    var choice=(Map<String,Object>)((List<?>)plan.get("choices")).getFirst(); choice.put("componentId","outside");
    assertEquals("EASYV_ACTION_REJECTED",failure(this::prepare)); choice.put("componentId","c1");
    jdbc.update("UPDATE easyv_saas.ai_screen_prototype SET screen_structure_xml=replace(screen_structure_xml,'id=\"b\"','id=\"b\" metric_role=\"core\"')");
    assertEquals("EASYV_ACTION_REJECTED",failure(this::prepare));
    jdbc.update("UPDATE easyv_saas.ai_screen_prototype SET screen_structure_xml=?, screen_prototype_json=jsonb_set(screen_prototype_json,'{page-1,blocks,b,controls}','[]')",XML);
    assertEquals("EASYV_ACTION_REJECTED",failure(this::prepare)); verifyNoInteractions(cache);
  }
  @Test void enabledWritebackDoesNotReplaceThePlatformJdbcOrRedisBeans() {
    var mainJdbc=mock(JdbcTemplate.class);
    var mainRedis=mock(org.springframework.data.redis.core.StringRedisTemplate.class);
    new org.springframework.boot.test.context.runner.ApplicationContextRunner()
        .withUserConfiguration(EasyVActionConfiguration.class)
        .withBean("jdbcTemplate",JdbcTemplate.class,()->mainJdbc)
        .withBean("stringRedisTemplate",org.springframework.data.redis.core.StringRedisTemplate.class,()->mainRedis)
        .withPropertyValues("dip3.easyv.enabled=true","dip3.easyv.action.enabled=true",
            "dip3.easyv.action.jdbc-url="+POSTGRES.getJdbcUrl(), "dip3.easyv.action.username="+POSTGRES.getUsername(),
            "dip3.easyv.action.password="+POSTGRES.getPassword(),
            "dip3.easyv.action.redis-url=redis://"+REDIS.getHost()+":"+REDIS.getMappedPort(6379))
        .run(context->{
          assertNull(context.getStartupFailure()); assertSame(mainJdbc,context.getBean(JdbcTemplate.class));
          assertSame(mainRedis,context.getBean(org.springframework.data.redis.core.StringRedisTemplate.class));
          assertEquals(1,context.getBeansOfType(com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionPort.class).size());
        });
  }
  @Test void concurrentDifferentConfirmationsCannotBothOverwriteTheSamePrototype() throws Exception {
    plan.put("schemeId",null); plan.put("choices",List.of()); plan.put("targetTitle","方案甲");
    var first=prepare(); plan.put("targetTitle","方案乙"); var second=prepare();
    var barrier=new java.util.concurrent.CyclicBarrier(2);
    try(var pool=java.util.concurrent.Executors.newFixedThreadPool(2)) {
      java.util.function.Function<Map<String,Object>,String> apply=prepared->{
        try { barrier.await(); return String.valueOf(adapter.apply(prepared,"3","4","0").get("status")); }
        catch(BackendException error) { return error.code(); }
        catch(Exception error) { throw new RuntimeException(error); }
      };
      var a=pool.submit(()->apply.apply(first)); var b=pool.submit(()->apply.apply(second));
      var results=List.of(a.get(),b.get());
      assertEquals(1,results.stream().filter("verified"::equals).count());
      assertTrue(results.stream().filter(s->!s.equals("verified")).allMatch(s->Set.of("EASYV_ACTION_REJECTED","EASYV_ACTION_RESULT_UNKNOWN").contains(s)));
      assertTrue(Set.of("方案甲","方案乙").contains(prototype().at("/page-1/blocks/b/title").asText()));
    }
  }
  Map<String,Object> prepare() { return adapter.prepare(new LinkedHashMap<>(plan),"3","4","0"); }
  JsonNode prototype() { return read("SELECT screen_prototype_json::text FROM easyv_saas.ai_screen_prototype"); }
  JsonNode context() { return read("SELECT output::text FROM easyv_saas.ai_pipeline_node_record ORDER BY id DESC LIMIT 1"); }
  JsonNode read(String sql) { try { return JSON.readTree(jdbc.queryForObject(sql,String.class)); } catch(Exception error) { throw new AssertionError(error); } }
  String failure(Runnable operation) { return assertThrows(BackendException.class,operation::run).code(); }
}
