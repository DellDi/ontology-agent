package com.dip3.ontologyagent.easyv.internal.adapter.out.ingestion;

import com.dip3.ontologyagent.ingestion.api.CanonicalProductTransform;
import com.dip3.ontologyagent.ingestion.api.SourceRow;
import com.dip3.ontologyagent.support.JsonCodec;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;

/** v8.22 图表配置与后台审计的正式物化，原始配置列表展开为保序关系。 */
public final class EasyVChartConfigurationTransform implements CanonicalProductTransform {
  public enum Kind {
    CHART("easyv-chart-type","easyv_chart_type","source_id,chart_type,chart_family,scene_tag,description_terms,data_requirement,suitable_for,is_fallback,status,sort_order"),
    CATEGORY("easyv-chart-category","easyv_chart_category","membership_id,source_id,category_id,category_name,chart_type,position,sort_order"),
    PRIORITY("easyv-chart-priority","easyv_chart_priority","recommendation_id,source_id,scene_id,scene_type,chart_type,priority,position,sort_order"),
    AUDIT("easyv-config-audit","easyv_config_audit","source_id,table_name,row_key,action,before_snapshot,after_snapshot,has_before,has_after,created_at");
    final String key, table, columns;
    Kind(String key,String table,String columns) { this.key=key; this.table=table; this.columns=columns; }
  }
  private static final ObjectMapper JSON = new ObjectMapper();
  private final Kind kind;
  private final JdbcTemplate jdbc;
  private final JsonCodec json;
  public EasyVChartConfigurationTransform(Kind kind,JdbcTemplate jdbc,JsonCodec json) { this.kind=kind;this.jdbc=jdbc;this.json=json; }
  @Override public String transformRef() { return kind.key+"-v1"; }
  @Override public PreparedProduct prepare(Context context) {
    boolean relation=kind==Kind.CATEGORY || kind==Kind.PRIORITY;
    if (!kind.key.equals(context.product().productKey()) || !"easyv".equals(context.product().domainKey())
        || !"facts".equals(context.product().canonicalSchema()) || !kind.table.equals(context.product().canonicalRelation())
        || !transformRef().equals(context.product().transformRef()) || !context.inputs().keySet().equals(relation?Set.of("source","charts"):Set.of("source")))
      throw new IllegalArgumentException("图表配置产品与物化注册不一致："+kind.key);
    var source=context.inputs().get("source");
    if (!kind.key.equals(source.dataset().datasetKey())) throw new IllegalArgumentException("图表配置源与产品不一致");
    var values=new EasyVCanonicalTransform.Columns(source);
    Set<String> chartNames=new HashSet<>();
    if (relation) {
      var charts=context.inputs().get("charts");
      if (!"easyv-chart-type".equals(charts.dataset().datasetKey())) throw new IllegalArgumentException("缺少图表字典依赖");
      var columns=new EasyVCanonicalTransform.Columns(charts);
      for (var row:charts.rows()) chartNames.add(columns.text(row,"chart_type"));
    }
    List<List<Object>> rows=new ArrayList<>();
    for (var row:source.rows()) {
      long id=values.longValue(row,"id");
      var prefix=List.<Object>of(context.productVersionId(),source.dataset().datasetKey(),source.sourceVersionId());
      switch(kind) {
        case CHART -> {
          String status=values.text(row,"status"); int fallback=values.integer(row,"is_fallback");
          if (!Set.of("0","1").contains(status) || (fallback!=0 && fallback!=1)) throw invalid(id,"status/is_fallback");
          String terms=values.nullableText(row,"description_terms");
          if (terms!=null) array(terms,id,"description_terms");
          rows.add(join(prefix,id,values.text(row,"chart_type"),values.text(row,"chart_family"),values.text(row,"scene_tag"),terms,
              values.nullableText(row,"data_requirement"),values.nullableText(row,"suitable_for"),fallback==1,status,values.integer(row,"sort_order")));
        }
        case CATEGORY -> {
          var charts=array(values.text(row,"chart_types"),id,"chart_types");
          for (int index=0; index<charts.size(); index++) {
            String chart=charts.get(index);requireChart(chartNames,chart,id);
            rows.add(join(prefix,id+":"+chart,id,Long.toString(id),values.text(row,"category_name"),chart,index+1,values.integer(row,"sort_order")));
          }
          if (charts.isEmpty()) rows.add(join(prefix,id+":empty",id,Long.toString(id),values.text(row,"category_name"),null,null,values.integer(row,"sort_order")));
        }
        case PRIORITY -> {
          int start=rows.size();
          for (String priority:List.of("primary","secondary","tertiary","fallback")) {
            String field=priority.equals("fallback")?"fallback_chart":priority+"_charts";
            String raw=values.nullableText(row,field);
            var charts=priority.equals("fallback")?(raw==null?List.<String>of():List.of(raw)):array(raw,id,field);
            for (int index=0; index<charts.size(); index++) {
              String chart=charts.get(index);requireChart(chartNames,chart,id);
              rows.add(join(prefix,id+":"+priority+":"+chart,id,Long.toString(id),values.text(row,"scene_type"),chart,priority,index+1,values.integer(row,"sort_order")));
            }
          }
          if (rows.size()==start) rows.add(join(prefix,id+":empty",id,Long.toString(id),values.text(row,"scene_type"),null,null,null,values.integer(row,"sort_order")));
        }
        case AUDIT -> {
          String action=values.text(row,"action");
          if (!Set.of("INSERT","UPDATE","DELETE","STATUS").contains(action)) throw invalid(id,"action");
          String before=snapshot(values.nullableText(row,"before_json"),id,"before_json"),after=snapshot(values.nullableText(row,"after_json"),id,"after_json");
          var time=values.instant(row,"created_at");
          rows.add(join(prefix,id,values.text(row,"table_name"),values.text(row,"row_key"),action,before,after,before!=null,after!=null,time));
        }
      }
    }
    rows.sort(Comparator.comparing(row->row.get(3).toString()));
    String columns="product_version_id,source_dataset_key,source_dataset_version_id,"+kind.columns;
    var names=columns.split(",");var params=new ArrayList<String>();
    for(String name:names) params.add(Set.of("before_snapshot","after_snapshot").contains(name)?"?::jsonb":"?");
    String sql="INSERT INTO facts."+kind.table+" ("+columns+") VALUES ("+String.join(",",params)+")";
    return new PreparedProduct("facts://"+kind.table+"/"+context.productVersionId(),rows.size(),EasyVCanonicalTransform.contentHash(rows),
        ()->rows.forEach(row->jdbc.update(sql,row.toArray())));
  }
  private List<String> array(String raw,long id,String field) {
    JsonNode node;
    try { node=JSON.readTree(raw); } catch(java.io.IOException | RuntimeException error) { throw invalid(id,field); }
    if(node==null || !node.isArray()) throw invalid(id,field);
    var result=new ArrayList<String>();
    for(var item:node) { if(!item.isTextual() || item.asText().isBlank() || result.contains(item.asText())) throw invalid(id,field);result.add(item.asText()); }
    return List.copyOf(result);
  }
  private String snapshot(String raw,long id,String field) {
    if(raw==null) return null;
    JsonNode node;
    try { node=JSON.readTree(raw); } catch(java.io.IOException | RuntimeException error) { throw invalid(id,field); }
    if(node==null || node.isNull()) return null;
    if(!node.isObject()) throw invalid(id,field);
    return json.write(node);
  }
  private static void requireChart(Set<String> names,String chart,long id) { if(!names.contains(chart)) throw invalid(id,"未定义的图表引用"); }
  private static List<Object> join(List<Object> prefix,Object... values) { var result=new ArrayList<>(prefix);result.addAll(Arrays.asList(values));return Collections.unmodifiableList(result); }
  private static IllegalArgumentException invalid(long id,String field) { return new IllegalArgumentException("图表配置源记录 "+id+" 的 "+field+" 无效"); }
}
