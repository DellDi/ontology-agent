package com.dip3.ontologyagent.easyv.internal.domain;

import java.util.*;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeComponentGeometry.Box;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeLayoutGeometry.Rect;
import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.MetricBinding;
import com.dip3.ontologyagent.easyv.internal.domain.SchemeLibraryParser.Slot;

/** 固定指标、固定区域的方案适配评估。规则是显式启发式，不是生成器评分或最优性证明。 */
public final class SchemeAdaptation {
  private SchemeAdaptation() {}
  public record Minimum(double width, double height) {}
  public record Rules(String version, String calibration, String normalization, int maxMetrics,
      int readabilityWeight, int roleWeight, int positionWeight, double inset, double titleReserve,
      double gap, Map<String, Minimum> minimums) {}
  public static final Rules RULES = new Rules("easyv-adaptation-v1", "heuristic_pending_real_data_calibration",
      "0..100; feasible assignments only; mean of per-metric weighted terms", 7,
      50, 30, 20, 13, 52, 16, Map.of("indicator", new Minimum(120,64), "chart", new Minimum(240,160),
          "table", new Minimum(320,180), "map", new Minimum(400,240)));
  public record Component(String componentId, PrototypeComponentGeometry.Parsed geometry) {}
  public record Input(String blockTypeId, String schemeId, Rect bounds, Boolean titlePresent,
      String metricBindingStatus, List<MetricBinding> metrics, List<Component> components) {}
  public record Candidate(String schemeId, String blockTypeId, int chartCount, String parseStatus,
      String parseErrorCode, List<Slot> slots) {}
  public record Finding(String code, String message, Integer slotIndex, String componentId) {}
  public record Assignment(int slotIndex, String componentId, String metricId, String chartFamily,
      Rect bounds, Minimum minimum, double readability, double role, double position) {}
  public record Assessment(String schemeId, String status, Double score, List<Assignment> assignments,
      List<Finding> findings) {}
  public record Comparison(Rules rules, Input input, Assessment current, List<Assessment> candidates) {}
  private record Chart(String category, String preferredRole, Minimum minimum) {}

  public static Comparison compare(Input input, List<Candidate> candidates) {
    List<Finding> issues = inputIssues(input);
    Candidate current = candidates.stream().filter(c -> Objects.equals(c.schemeId(), input.schemeId())).findFirst().orElse(null);
    Assessment baseline;
    if (!issues.isEmpty()) baseline = unavailable(input.schemeId(), issues);
    else if (current == null) baseline = unavailable(input.schemeId(), List.of(finding("CURRENT_SCHEME_NOT_RETAINED", "冻结方案库没有当前方案。", null, null)));
    else {
      List<Box> boxes = new ArrayList<>();
      for (Component component : input.components() == null ? List.<Component>of() : input.components()) {
        if (component.geometry() == null || !"available".equals(component.geometry().status()) || component.geometry().box() == null) {
          issues.add(finding("CURRENT_COMPONENT_GEOMETRY_UNAVAILABLE", "当前组件没有可评估的源位置和尺寸。", null, component.componentId()));
        } else boxes.add(component.geometry().box());
      }
      baseline = issues.isEmpty() ? evaluate(input,current,boxes,true) : unavailable(input.schemeId(),issues);
    }
    // 当前组件缺失不阻止用同一指标和区域比较候选方案。
    List<Finding> common = inputIssues(input);
    List<Assessment> evaluated = new ArrayList<>();
    for (Candidate candidate : candidates) {
      if (!common.isEmpty()) { evaluated.add(unavailable(candidate.schemeId(),common)); continue; }
      List<Box> boxes = new ArrayList<>();
      List<Finding> failures = new ArrayList<>();
      if (candidate.slots() != null) for (Slot slot : candidate.slots()) {
        var config = slot.config();
        Map<String,Object> values = new HashMap<>();
        if (config != null) {
          values.put("relativeX",config.x()); values.put("relativeY",config.y());
          values.put("width",config.width()); values.put("height",config.height());
        }
        var geometry = PrototypeComponentGeometry.parse(config == null ? null : values);
        if (!"available".equals(geometry.status())) failures.add(finding(geometry.errorCode(),"候选槽位没有有效的百分比位置和尺寸。",slot.slotIndex(),null));
        else boxes.add(geometry.box());
      }
      evaluated.add(failures.isEmpty() ? evaluate(input,candidate,boxes,false) : unavailable(candidate.schemeId(),failures));
    }
    evaluated.sort(Comparator.comparing((Assessment a) -> a.score() == null ? -1.0 : a.score()).reversed()
        .thenComparing(Assessment::schemeId));
    return new Comparison(RULES,input,baseline,List.copyOf(evaluated));
  }
  private static List<Finding> inputIssues(Input input) {
    List<Finding> failures = new ArrayList<>();
    if (input.bounds() == null || !Double.isFinite(input.bounds().width()) || !Double.isFinite(input.bounds().height())
        || input.bounds().width() <= 0 || input.bounds().height() <= 0) failures.add(finding("BLOCK_GEOMETRY_UNAVAILABLE","区域外框无法从冻结版式解析。",null,null));
    if (input.titlePresent() == null) failures.add(finding("TITLE_PRESENCE_NOT_RETAINED","冻结输入没有保留区域标题状态。",null,null));
    if (!"available".equals(input.metricBindingStatus()) || input.metrics() == null || input.metrics().isEmpty())
      failures.add(finding("METRIC_BINDINGS_UNAVAILABLE","没有可评估的冻结指标绑定。",null,null));
    else {
      if (input.metrics().size() > RULES.maxMetrics()) failures.add(finding("METRIC_COUNT_UNSUPPORTED","当前规则支持每个区域 1 至 7 个指标。",null,null));
      Set<String> ids = new HashSet<>();
      for (int i=0;i<input.metrics().size();i++) {
        var metric=input.metrics().get(i);
        if (metric.slotIndex()!=i || metric.metricId()==null || metric.componentId()==null || !ids.add(metric.componentId()))
          failures.add(finding("METRIC_BINDING_ALIGNMENT_INVALID","指标实例与槽位顺序不一致。",i,metric.componentId()));
        if (chart(metric.chartFamily())==null) failures.add(finding("CHART_FAMILY_UNSUPPORTED","当前规则没有该图表类型的尺寸和类别定义。",i,metric.componentId()));
      }
    }
    return failures;
  }
  private static Assessment evaluate(Input input, Candidate candidate, List<Box> boxes, boolean baseline) {
    if (!"available".equals(candidate.parseStatus()) || candidate.slots()==null)
      return unavailable(candidate.schemeId(),List.of(finding(candidate.parseErrorCode()==null?"SCHEME_SLOTS_UNAVAILABLE":candidate.parseErrorCode(),"冻结方案配置不可评估。",null,null)));
    if (!Objects.equals(input.blockTypeId(),candidate.blockTypeId())) return infeasible(candidate.schemeId(),"BLOCK_TYPE_MISMATCH","候选方案的区域类型不匹配。");
    int count=input.metrics().size();
    if (candidate.chartCount()!=count || candidate.slots().size()!=count) return infeasible(candidate.schemeId(),"SLOT_COUNT_MISMATCH","槽位数量与固定指标数量不一致。");
    if (boxes.size()!=count || (baseline && (input.components()==null || input.components().size()!=count)))
      return unavailable(candidate.schemeId(),List.of(finding("COMPONENT_COUNT_MISMATCH","组件几何与指标数量不一致。",null,null)));
    for (int i=0;i<count;i++) {
      Slot slot=candidate.slots().get(i);
      if (slot.slotIndex()!=i || slot.allowedChartCategories()==null || !List.of("main","summary","table").contains(slot.role())
          || slot.allowedChartCategories().stream().anyMatch(c -> !List.of("chart","indicator","table").contains(c)))
        return unavailable(candidate.schemeId(),List.of(finding("SLOT_CONSTRAINT_UNSUPPORTED","槽位顺序、角色或类别约束未被当前规则识别。",i,null)));
      if (baseline && !Objects.equals(input.metrics().get(i).componentId(),input.components().get(i).componentId()))
        return unavailable(candidate.schemeId(),List.of(finding("COMPONENT_ALIGNMENT_INVALID","当前组件实例与指标绑定不一致。",i,null)));
      for (int j=0;j<i;j++) if (overlap(boxes.get(i),boxes.get(j)))
        return infeasible(candidate.schemeId(),"SLOT_OVERLAP","槽位覆盖区域相互重叠。");
    }
    List<Rect> rects=pixels(input,boxes);
    if (rects.stream().anyMatch(r -> r.width()<=0 || r.height()<=0)) return infeasible(candidate.schemeId(),"CONTENT_AREA_TOO_SMALL","扣除边距、标题和间距后没有可读区域。");
    List<List<Assignment>> edges=new ArrayList<>();
    List<Finding> findings=new ArrayList<>();
    for (int slot=0;slot<count;slot++) {
      List<Assignment> choices=new ArrayList<>();
      for (int metric=0;metric<count;metric++) {
        if (baseline && metric!=slot) continue;
        var binding=input.metrics().get(metric); Chart chart=chart(binding.chartFamily()); var rect=rects.get(slot);
        if (!candidate.slots().get(slot).allowedChartCategories().contains(chart.category())) {
          findings.add(finding("CHART_CATEGORY_REJECTED","槽位类别约束不允许该指标图表。",slot,binding.componentId())); continue;
        }
        if (rect.width()<chart.minimum().width() || rect.height()<chart.minimum().height()) {
          findings.add(finding("MINIMUM_SIZE_NOT_MET","槽位有效尺寸低于当前规则的可读阈值。",slot,binding.componentId())); continue;
        }
        double readable=Math.min(1,Math.min(rect.width()/chart.minimum().width(),rect.height()/chart.minimum().height())-1)*100;
        double role=chart.preferredRole().equals(candidate.slots().get(slot).role())?100:0;
        Box box=boxes.get(slot); double center=(box.y()+box.height()/2)/100;
        double position=("indicator".equals(chart.category())?1-center:"table".equals(chart.category())?center:1-Math.abs(center-.5)*2)*100;
        choices.add(new Assignment(slot,binding.componentId(),binding.metricId(),binding.chartFamily(),rect,chart.minimum(),readable,role,position));
      }
      edges.add(choices);
    }
    Best best=new Best(); match(edges,0,new HashSet<>(),new ArrayList<>(),0,best);
    if (best.assignments==null) {
      findings.add(finding("NO_FEASIBLE_ASSIGNMENT","不存在满足全部指标约束的一对一分配。",null,null));
      return new Assessment(candidate.schemeId(),"infeasible",null,List.of(),List.copyOf(findings));
    }
    return new Assessment(candidate.schemeId(),"feasible",best.score/count,List.copyOf(best.assignments),List.of());
  }
  private static List<Rect> pixels(Input input,List<Box> boxes) {
    double inset=RULES.inset(),width=input.bounds().width()-2*inset;
    double title=Boolean.TRUE.equals(input.titlePresent())?RULES.titleReserve():0;
    double height=input.bounds().height()-2*inset-title;
    double[] left=new double[boxes.size()],right=new double[boxes.size()],top=new double[boxes.size()],bottom=new double[boxes.size()];
    // 与原型画布同排/同列排序一致；存在前后组件的边各扣半个间距。
    for (int i=0;i<boxes.size();i++) for (int j=0;j<boxes.size();j++) if (i!=j) {
      Box a=boxes.get(i),b=boxes.get(j);
      if (interval(a.y(),a.height(),b.y(),b.height()) && b.x()>=a.x()+a.width()-.01) { right[i]=left[j]=RULES.gap()/2; }
      if (interval(a.x(),a.width(),b.x(),b.width()) && b.y()>=a.y()+a.height()-.01) { bottom[i]=top[j]=RULES.gap()/2; }
    }
    List<Rect> result=new ArrayList<>();
    for (int i=0;i<boxes.size();i++) { Box b=boxes.get(i);
      result.add(new Rect(input.bounds().x()+inset+width*b.x()/100+left[i],input.bounds().y()+inset+title+height*b.y()/100+top[i],
          width*b.width()/100-left[i]-right[i],height*b.height()/100-top[i]-bottom[i])); }
    return result;
  }
  private static boolean interval(double a,double sizeA,double b,double sizeB) { return Math.min(a+sizeA,b+sizeB)-Math.max(a,b)>.01; }
  private static boolean overlap(Box a,Box b) { return interval(a.x(),a.width(),b.x(),b.width()) && interval(a.y(),a.height(),b.y(),b.height()); }
  private static Chart chart(String family) {
    if (family==null) return null;
    if (List.of("single-value-metric","donut").contains(family)) return new Chart("indicator","summary",RULES.minimums().get("indicator"));
    if ("table".equals(family)) return new Chart("table","table",RULES.minimums().get("table"));
    if ("map".equals(family)) return new Chart("chart","main",RULES.minimums().get("map"));
    if (List.of("bubble","word-cloud","radar","bar","horizontal-bar","line","area","pie","gantt").contains(family))
      return new Chart("chart","main",RULES.minimums().get("chart"));
    return null;
  }
  private static void match(List<List<Assignment>> edges,int slot,Set<String> used,List<Assignment> path,double score,Best best) {
    if (slot==edges.size()) { if(score>best.score) { best.score=score;best.assignments=List.copyOf(path); } return; }
    for(Assignment a:edges.get(slot)) if(used.add(a.componentId())) {
      path.add(a); match(edges,slot+1,used,path,score+(a.readability()*RULES.readabilityWeight()+a.role()*RULES.roleWeight()+a.position()*RULES.positionWeight())/100,best);
      path.removeLast();used.remove(a.componentId());
    }
  }
  private static final class Best { double score=-1;List<Assignment> assignments; }
  private static Finding finding(String code,String message,Integer slot,String component) { return new Finding(code,message,slot,component); }
  private static Assessment unavailable(String id,List<Finding> findings) { return new Assessment(id,"unassessable",null,List.of(),List.copyOf(findings)); }
  private static Assessment infeasible(String id,String code,String message) { return new Assessment(id,"infeasible",null,List.of(),List.of(finding(code,message,null,null))); }
}
