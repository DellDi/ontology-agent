package com.dip3.ontologyagent.easyv.internal.adapter.out.writeback;

import com.dip3.ontologyagent.easyv.internal.application.EasyVBlockActionPort;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeBlockWriteback.*;
import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import io.lettuce.core.api.sync.RedisCommands;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 固定的 EasyV 写回适配器；仅接收已校验方案，不接受任意 SQL 或任意表名。 */
public final class EasyVBlockActionDatabaseAdapter implements EasyVBlockActionPort {
  private static final Logger log = LoggerFactory.getLogger(EasyVBlockActionDatabaseAdapter.class);
  private final ObjectMapper json = new ObjectMapper();
  private final JdbcTemplate jdbc;
  private final RedisCommands<String,String> redis;
  private final String schema;
  private record Live(String name, JsonNode snapshot, long prototypeId, Object updatedAt, long contextId, JsonNode output) {}
  public EasyVBlockActionDatabaseAdapter(JdbcTemplate jdbc, RedisCommands<String,String> redis, String schema) {
    if (!schema.matches("[A-Za-z_][A-Za-z0-9_]*")) throw new IllegalArgumentException("Invalid EasyV schema");
    this.jdbc=jdbc; this.redis=redis; this.schema="\""+schema+"\".";
  }

  public Map<String,Object> prepare(Map<String,Object> plan, String user, String space, String team) {
    configured();
    try {
      return transaction(true, () -> {
        Plan typed = json.convertValue(plan, Plan.class);
        Live live = read(typed.appId(),user,space,team,false);
        Map<String,Chart> charts = charts(false);
        ObjectNode after = PrototypeBlockWriteback.transform(live.snapshot(),typed,candidate(typed),charts(true));
        ObjectNode beforeBlock = PrototypeBlockWriteback.block(live.snapshot().get("prototype"),typed.blockId());
        ObjectNode block = PrototypeBlockWriteback.block(after.get("prototype"),typed.blockId());
        PrototypeBlockWriteback.editingOutput(live.output(),typed.blockId(),beforeBlock,block,charts);
        var result = new LinkedHashMap<String,Object>();
        result.put("plan",plan); result.put("actorUserId",user); result.put("spaceId",space); result.put("teamId",team);
        result.put("applicationName",live.name()); result.put("before",map(live.snapshot())); result.put("after",map(after)); result.put("block",map(block));
        return result;
      });
    } catch (BackendException error) { throw error; }
      catch (RuntimeException error) { throw unavailable(false,error); }
  }

  public Map<String,Object> apply(Map<String,Object> prepared, String user, String space, String team) {
    configured();
    String task;
    JsonNode after = json.valueToTree(prepared.get("after"));
    Plan plan = json.convertValue(prepared.get("plan"),Plan.class);
    try {
      task = transaction(false, () -> {
        if (!Objects.equals(user,String.valueOf(prepared.get("actorUserId")))
            || !Objects.equals(space,String.valueOf(prepared.get("spaceId"))) || !Objects.equals(team,String.valueOf(prepared.get("teamId"))))
          throw new BackendException("EASYV_ACTION_FORBIDDEN","确认身份或空间已改变");
        Live live = read(plan.appId(),user,space,team,true);
        JsonNode before = json.valueToTree(prepared.get("before"));
        ObjectNode target = PrototypeBlockWriteback.block(after.path("prototype"),plan.blockId());
        if (!target.equals(json.valueToTree(prepared.get("block")))) throw rejected("待保存块与确认结果不同");
        if (!live.snapshot().equals(after)) {
          if (!live.snapshot().equals(before)) throw rejected("原型已被其他编辑修改，请重新准备");
          if (!PrototypeBlockWriteback.transform(before,plan,candidate(plan),charts(true)).equals(after))
            throw rejected("实时方案库与已确认结果不同，请重新准备");
        }
        JsonNode output = PrototypeBlockWriteback.editingOutput(live.output(),plan.blockId(),
            PrototypeBlockWriteback.block(live.snapshot().path("prototype"),plan.blockId()),target,charts(false));
        if (!live.snapshot().equals(after)) {
          int changed = jdbc.update("UPDATE "+schema+"ai_screen_prototype SET screen_prototype_json=?::jsonb, update_time=clock_timestamp() WHERE id=? AND update_time IS NOT DISTINCT FROM ?",
              encode(after.get("prototype")),live.prototypeId(),live.updatedAt());
          if (changed!=1) throw rejected("保存时原型已被其他编辑更新");
        }
        if (!output.equals(live.output())) {
          int changed = jdbc.update("UPDATE "+schema+"ai_pipeline_node_record SET output=?::jsonb WHERE id=? AND output=?::jsonb",
              encode(output),live.contextId(),encode(live.output()));
          if (changed!=1) throw rejected("保存时编辑上下文已更新");
        }
        Live saved = read(plan.appId(),user,space,team,true);
        if (!saved.snapshot().equals(after) || !saved.output().equals(output)) throw rejected("保存后读回不一致");
        return saved.snapshot().path("generationTaskId").asText();
      });
    } catch (BackendException error) { throw error; }
      catch (RuntimeException error) { throw unavailable(true,error); }
    // 数据库事务已提交。源端现有 load() 会从最新持久快照恢复；无需修改源项目。
    try { redis.del("ai:screen:regen:"+task); }
    catch (RuntimeException error) {
      log.warn("easyv_action_cache_invalidation_pending appId={} blockId={}",plan.appId(),plan.blockId(),error);
      return Map.of("status","applied_context_pending","prototype",map(after.path("prototype")),"contextStatus","原型和编辑快照已保存，源缓存待失效");
    }
    return Map.of("status","verified","prototype",map(after.path("prototype")),"contextStatus","已同步");
  }

  private Live read(String app, String user, String space, String team, boolean lock) {
    List<Map<String,Object>> apps = jdbc.queryForList("SELECT app_name, generation_task_id, scope_type, user_id::text AS user_id, space_id::text AS space_id, team_id::text AS team_id FROM "+schema+"ai_screen_app WHERE app_id=? AND is_delete='0'"+(lock?" FOR UPDATE":""),app);
    if (apps.size()!=1) throw rejected("目标应用不存在或已删除");
    Map<String,Object> owner = apps.getFirst();
    if (!"USER".equals(owner.get("scope_type")) && !"TEAM".equals(owner.get("scope_type")))
      throw new BackendException("EASYV_ACTION_FORBIDDEN","应用权限范围异常，请先在 EasyV 核对。");
    if (!Objects.equals(user,owner.get("user_id")) || !Objects.equals(space,owner.get("space_id")) || !Objects.equals(team,owner.get("team_id")))
      throw new BackendException("EASYV_ACTION_FORBIDDEN","当前业务身份不是实时应用的所有者，或归属已改变");
    List<Map<String,Object>> rows = jdbc.queryForList("SELECT id, screen_structure_xml, screen_template_json::text, screen_prototype_json::text, update_time FROM "+schema+"ai_screen_prototype WHERE app_id=?"+(lock?" FOR UPDATE":""),app);
    if (rows.size()!=1) throw rejected("实时原型不存在或不唯一");
    Map<String,Object> row = rows.getFirst();
    List<Map<String,Object>> records = jdbc.queryForList("SELECT id, output::text FROM "+schema+"ai_pipeline_node_record WHERE task_id=? AND step_name='PipelineCompleted' ORDER BY id DESC LIMIT 1"+(lock?" FOR UPDATE":""),owner.get("generation_task_id"));
    if (records.size()!=1) throw rejected("缺少持久编辑快照");
    ObjectNode snapshot = json.createObjectNode();
    snapshot.put("xml",(String)row.get("screen_structure_xml")); snapshot.put("generationTaskId",(String)owner.get("generation_task_id"));
    snapshot.set("template",decode(row.get("screen_template_json"))); snapshot.set("prototype",decode(row.get("screen_prototype_json")));
    Map<String,Object> record = records.getFirst();
    return new Live((String)owner.get("app_name"),snapshot,((Number)row.get("id")).longValue(),row.get("update_time"),
        ((Number)record.get("id")).longValue(),decode(record.get("output")));
  }
  private SchemeAdaptation.Candidate candidate(Plan plan) {
    if (plan.schemeId()==null) return null;
    List<Map<String,Object>> schemes = jdbc.queryForList("SELECT id, block_type_id, chat_count, block_slots_data FROM "+schema+"ai_block_data WHERE id=?",positiveId(plan.schemeId()));
    if (schemes.size()!=1) throw rejected("实时方案不存在");
    Map<String,Object> scheme = schemes.getFirst();
    Map<String,SchemeLibraryParser.Constraint> constraints = new HashMap<>();
    var slots = decode(scheme.get("block_slots_data"));
    for (JsonNode slot : slots) {
      String id = slot.path("block_internal_id").asText();
      List<Map<String,Object>> rows = jdbc.queryForList("SELECT allowed_chart_categories, recommend_type FROM "+schema+"ai_block_internal_data WHERE id=?",positiveId(id));
      if (rows.size()!=1) throw rejected("实时方案槽位类型不存在");
      Map<String,Object> row = rows.getFirst();
      constraints.put(id,SchemeLibraryParser.constraint(row.get("allowed_chart_categories"),row.get("recommend_type")));
    }
    int count = ((Number)scheme.get("chat_count")).intValue();
    var parsed = SchemeLibraryParser.parse(count,mapValue(slots),constraints);
    return new SchemeAdaptation.Candidate(plan.schemeId(),String.valueOf(scheme.get("block_type_id")),count,parsed.status(),parsed.errorCode(),parsed.slots());
  }
  private Map<String,Chart> charts(boolean enabledOnly) {
    Map<String,Chart> result = new LinkedHashMap<>();
    jdbc.queryForList("SELECT chart_type, chart_family, scene_tag FROM "+schema+"ai_chart_type_mapping"+(enabledOnly?" WHERE status='0'":"")+" ORDER BY sort_order, id")
        .forEach(row -> result.putIfAbsent((String)row.get("chart_family"),new Chart((String)row.get("chart_type"),(String)row.get("chart_family"),(String)row.get("scene_tag"))));
    return result;
  }
  private <T> T transaction(boolean readOnly, java.util.function.Supplier<T> operation) {
    var tx = new TransactionTemplate(new DataSourceTransactionManager(Objects.requireNonNull(jdbc.getDataSource())));
    tx.setReadOnly(readOnly); tx.setIsolationLevel(org.springframework.transaction.TransactionDefinition.ISOLATION_REPEATABLE_READ);
    return tx.execute(status -> { jdbc.execute("SET LOCAL statement_timeout='15s'"); jdbc.execute("SET LOCAL lock_timeout='3s'"); return operation.get(); });
  }
  private void configured() { if (jdbc==null || redis==null) throw new BackendException("EASYV_ACTION_NOT_CONFIGURED","尚未配置业务源写回连接，已有提案已保留。"); }
  private BackendException unavailable(boolean applying, RuntimeException error) {
    log.warn("easyv_database_action_unavailable operation={}",applying?"apply":"prepare",error);
    return new BackendException(applying?"EASYV_ACTION_RESULT_UNKNOWN":"EASYV_ACTION_PREPARE_UNAVAILABLE",
        applying?"保存结果尚未确认，请核查同一方案。":"未取得改造准备结果，尚未提交保存。",error);
  }
  private int positiveId(String value) { try { int id=Integer.parseInt(value); if(id>0)return id; } catch(NumberFormatException ignored) {} throw rejected("方案或槽位标识无效"); }
  private JsonNode decode(Object value) { try { return json.readTree(value==null?"null":value.toString()); } catch(Exception error) { throw new BackendException("EASYV_ACTION_REJECTED","源数据 JSON 损坏",error); } }
  private String encode(JsonNode value) { try { return json.writeValueAsString(value); } catch(Exception error) { throw new IllegalArgumentException("Cannot encode EasyV action",error); } }
  @SuppressWarnings("unchecked") private Map<String,Object> map(JsonNode value) { return json.convertValue(value,Map.class); }
  private Object mapValue(JsonNode value) { return json.convertValue(value,Object.class); }
  private BackendException rejected(String message) { return new BackendException("EASYV_ACTION_REJECTED",message); }
}
