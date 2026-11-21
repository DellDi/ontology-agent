package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.semantic.api.*;
import java.util.List;
import java.util.Map;
import java.util.Set;
import static com.dip3.ontologyagent.semantic.api.OntologyProperty.Type.*;
import static com.dip3.ontologyagent.semantic.api.OntologyMetric.Aggregation.*;
import static com.dip3.ontologyagent.semantic.api.OntologyLink.Cardinality.*;

/** 全局图表参考配置与管理员配置审计；不表示生成时采用的历史规则或用户改屏事件。 */
public final class EasyVChartConfiguration {
  private EasyVChartConfiguration() {}
  public static final String CHART_KEY = "easyv-chart-type";
  public static final String CATEGORY_KEY = "easyv-chart-category";
  public static final String PRIORITY_KEY = "easyv-chart-priority";
  public static final String AUDIT_KEY = "easyv-config-audit";
  public static final Set<String> REFERENCES = Set.of(CHART_KEY, CATEGORY_KEY, PRIORITY_KEY);
  public static final OntologyObjectType CHART = new OntologyObjectType(CHART_KEY, "图表配置", "冻结采集时的全局图表规则；不证明历史生成时的规则或最终适配质量",
      "EasyvChartType", CHART_KEY, "facts.easyv_chart_type", null,
      List.of(new OntologyProperty("chartId", "图表配置 ID", null, STRING, "{CUBE}.source_id::text", true),
          p("chartType", "图表名称", "chart_type").display(true,true,Map.of()), p("chartFamily", "图表组件标识", "chart_family"),
          p("sceneType", "场景归类", "scene_tag"), p("status", "启停状态", "status").display(false,true,Map.of("0","启用","1","停用")),
          OntologyProperty.column("isFallback", "非场景推荐备选", "源 is_fallback 标记，不代表实际发生过降级", BOOLEAN,"is_fallback"),
          OntologyProperty.detailText("descriptionTerms", "选型措辞", "源配置词语列表", "{CUBE}.description_terms::text"),
          p("dataRequirement", "数据前提", "data_requirement"), p("suitableFor", "适用表达", "suitable_for")),
      List.of(new OntologyLink("categories",CATEGORY_KEY,"chartType","chartType",ONE_TO_MANY),
          new OntologyLink("priorities",PRIORITY_KEY,"chartType","chartType",ONE_TO_MANY)),
      List.of(count("count","图表配置数","去重配置 ID","source_id"), new OntologyMetric("enabledCount","启用图表数","源状态为启用的配置数",COUNT_DISTINCT,"{CUBE}.source_id","{CUBE}.status='0'")),
      null,List.of(),Map.of(),true);
  public static final OntologyObjectType CATEGORY = new OntologyObjectType(CATEGORY_KEY,"图表分类关系","图表大类与成员；关系数和分类数分别统计",
      "EasyvChartCategory",CATEGORY_KEY,"facts.easyv_chart_category",null,
      List.of(OntologyProperty.key("membershipId","分类成员 ID","membership_id"),p("categoryId","分类 ID","category_id"),
          p("categoryName","图表大类","category_name").display(true,true,Map.of()),p("chartType","成员图表","chart_type")),
      List.of(new OntologyLink("chart",CHART_KEY,"chartType","chartType",MANY_TO_ONE)),
      List.of(new OntologyMetric("count","分类成员关系数","不计空分类占位记录",COUNT_DISTINCT,"{CUBE}.membership_id","{CUBE}.chart_type IS NOT NULL"), count("categoryCount","图表分类数","去重分类 ID","category_id")),null,List.of(),Map.of(),true);
  public static final OntologyObjectType PRIORITY = new OntologyObjectType(PRIORITY_KEY,"场景图表推荐","配置推荐顺序，不代表实际使用、降级次数或选型正确率",
      "EasyvChartPriority",PRIORITY_KEY,"facts.easyv_chart_priority",null,
      List.of(OntologyProperty.key("recommendationId","推荐关系 ID","recommendation_id"),p("sceneId","场景配置 ID","scene_id"),
          p("sceneType","场景类型","scene_type").display(true,true,Map.of()),p("chartType","推荐图表","chart_type"),
          p("priority","推荐层级","priority").display(false,true,Map.of("primary","首选","secondary","次选","tertiary","备选","fallback","兜底")),
          OntologyProperty.column("position","层内顺序","从 1 开始，保留源配置顺序",NUMBER,"position")),
      List.of(new OntologyLink("chart",CHART_KEY,"chartType","chartType",MANY_TO_ONE)),
      List.of(new OntologyMetric("count","推荐关系数","不计空场景占位记录",COUNT_DISTINCT,"{CUBE}.recommendation_id","{CUBE}.chart_type IS NOT NULL"),count("sceneCount","场景数","去重场景 ID","scene_id")),null,List.of(),Map.of(),true);
  public static final OntologyObjectType AUDIT = new OntologyObjectType(AUDIT_KEY,"后台配置变更","仅管理员：后台配置管理日志，不是用户修改原型记录；缺前态不能还原差异",
      "EasyvConfigAudit",AUDIT_KEY,"facts.easyv_config_audit",null,
      List.of(new OntologyProperty("auditId","配置变更 ID",null,STRING,"{CUBE}.source_id::text",true),
          p("tableName","配置表","table_name").display(true,true,Map.of()),p("rowKey","配置行标识","row_key"),
          p("action","变更类型","action").display(false,true,Map.of("INSERT","新增","UPDATE","更新","DELETE","删除","STATUS","启停")),
          OntologyProperty.column("hasBefore","已留存前态","只有源 before_json 非空且可解析时为真",BOOLEAN,"has_before"),
          OntologyProperty.column("hasAfter","已留存后态","只有源 after_json 非空且可解析时为真",BOOLEAN,"has_after"),
          OntologyProperty.detailText("beforeSnapshot","配置前态","未留存时为空；不能补造", "{CUBE}.before_snapshot::text"),
          OntologyProperty.detailText("afterSnapshot","配置后态","源配置快照，不是原型快照", "{CUBE}.after_snapshot::text"),
          OntologyProperty.column("createdAt","记录时间","源 timestamptz，不是规则实际生效时刻",TIME,"created_at")),
      List.of(),List.of(count("count","后台配置变更数","配置日志数，不是实际改屏次数","source_id"),
          new OntologyMetric("completeDiffCount","前后态齐备记录数","前后快照均留存的记录数；不是变更成功率",COUNT_DISTINCT,"{CUBE}.source_id","{CUBE}.has_before and {CUBE}.has_after")),
      "createdAt",List.of(),Map.of());
  public static final List<OntologyObjectType> OBJECTS = List.of(CHART,CATEGORY,PRIORITY,AUDIT);
  private static OntologyProperty p(String key,String label,String column) { return OntologyProperty.column(key,label,label,STRING,column); }
  private static OntologyMetric count(String key,String label,String description,String column) { return new OntologyMetric(key,label,description,COUNT_DISTINCT,"{CUBE}."+column,null); }
}
