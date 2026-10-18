package com.dip3.ontologyagent.easyv.internal.domain;

import com.dip3.ontologyagent.easyv.internal.domain.PrototypeStructureParser.MetricBinding;
import com.dip3.ontologyagent.support.BackendException;
import java.util.*;

/** 块内重组提案。语义判断来自模型；这里仅校验真实绑定与空间约束，不执行源系统写入。 */
public final class BlockImprovement {
  private BlockImprovement() {}

  public record Metric(String componentId, String metricId, String name, String description,
      String insight, String unit, String aggregationRule, String chartFamily) {}
  public record Context(String title, String purpose, List<Metric> metrics,
      SchemeAdaptation.Input input, List<SchemeAdaptation.Candidate> schemes) {}
  public record Choice(String componentId, String chartFamily, int slotIndex, String reason) {}
  public record Diagnosis(String themeFit, String metricChartFit, String composition) {}
  public record Proposal(String schemeId, List<Choice> choices, Diagnosis diagnosis, List<String> limitations,
                         String title, String purpose) {
    public Proposal(String schemeId, List<Choice> choices, Diagnosis diagnosis, List<String> limitations) {
      this(schemeId, choices, diagnosis, limitations, null, null);
    }
  }
  public record TextChange(String beforeTitle, String afterTitle, String beforePurpose, String afterPurpose) {}
  public record Change(String componentId, String metricId, String name, String beforeChart,
      String afterChart, int beforeSlot, int afterSlot, String reason) {}
  public record Preview(String status, String title, String purpose, Diagnosis diagnosis, List<Change> changes,
      SchemeAdaptation.Assessment placement, List<String> pendingChecks, TextChange textChange) {}

  public static Preview preview(Context context, Proposal proposal, Set<String> chartFamilies) {
    if (context == null || context.input() == null || context.metrics() == null || context.metrics().isEmpty()
        || context.metrics().size() > SchemeAdaptation.RULES.maxMetrics()) throw invalid("缺少完整的当前块指标与布局");
    requireText(context.title(), "源模块名称", 500);
    requireText(context.purpose(), "源模块目的", 4000);
    if (proposal == null || proposal.diagnosis() == null) throw invalid("缺少主题、指标图形与组合诊断");
    requireText(proposal.diagnosis().themeFit(), "主题契合依据", 2000);
    requireText(proposal.diagnosis().metricChartFit(), "指标与图形依据", 2000);
    requireText(proposal.diagnosis().composition(), "组合依据", 2000);
    if (proposal.limitations() == null || proposal.limitations().size() > 10) throw invalid("信息缺口必须为最多十项的列表");
    proposal.limitations().forEach(item -> requireText(item, "信息缺口", 1000));
    if (proposal.title() != null) requireText(proposal.title(), "建议模块标题", 500);
    if (proposal.purpose() != null) requireText(proposal.purpose(), "建议模块用途", 4000);
    var textChange = new TextChange(context.title(), proposal.title() == null ? context.title() : proposal.title(),
        context.purpose(), proposal.purpose() == null ? context.purpose() : proposal.purpose());
    boolean textChanged = !textChange.beforeTitle().equals(textChange.afterTitle())
        || !textChange.beforePurpose().equals(textChange.afterPurpose());
    if (proposal.schemeId() == null && proposal.choices() != null && proposal.choices().isEmpty()) {
      if (!textChanged) throw new BackendException("BLOCK_IMPROVEMENT_NO_CHANGE", "标题、用途与当前内容一致，无需修改。");
      return new Preview("proposal", context.title(), context.purpose(), proposal.diagnosis(), List.of(), null,
          List.copyOf(proposal.limitations()), textChange);
    }
    if (proposal.choices() == null || proposal.choices().size() != context.metrics().size())
      throw invalid("本阶段必须保留当前块的全部指标，每个组件恰好出现一次");
    var candidate = context.schemes().stream().filter(item -> Objects.equals(item.schemeId(), proposal.schemeId()))
        .findFirst().orElseThrow(() -> invalid("方案不属于本轮冻结候选"));
    Map<String, Metric> metrics = new LinkedHashMap<>();
    for (var metric : context.metrics()) {
      requireText(metric.name(), "源指标名称", 500);
      requireText(metric.description(), "源指标含义", 4000);
      if (metrics.put(metric.componentId(), metric) != null) throw invalid("源组件绑定重复");
    }
    Map<String, Choice> choices = new LinkedHashMap<>();
    Set<Integer> slots = new HashSet<>();
    for (var choice : proposal.choices()) {
      if (choice == null || !metrics.containsKey(choice.componentId()) || choices.put(choice.componentId(), choice) != null)
        throw invalid("提案包含跨块、虚构或重复组件");
      if (choice.chartFamily() == null || !chartFamilies.contains(choice.chartFamily())) throw invalid("图形不属于已声明类型");
      if (choice.slotIndex() < 0 || choice.slotIndex() >= metrics.size() || !slots.add(choice.slotIndex()))
        throw invalid("每个指标必须分配到一个不同的有效槽位");
      requireText(choice.reason(), "逐项调整依据", 1500);
    }
    var source = context.input();
    if (source.metrics() == null || source.metrics().size() != metrics.size()) throw invalid("源指标绑定不完整");
    for (var binding : source.metrics()) {
      var metric = metrics.get(binding.componentId());
      if (metric == null || !Objects.equals(metric.metricId(), binding.metricId())
          || !Objects.equals(metric.chartFamily(), binding.chartFamily())) throw invalid("指标语义与源绑定不一致");
    }
    if (candidate.slots() == null || candidate.slots().size() != metrics.size()) throw invalid("候选方案缺少完整槽位");
    var ordered = choices.values().stream().sorted(Comparator.comparingInt(Choice::slotIndex)).toList();
    List<MetricBinding> bindings = new ArrayList<>();
    List<SchemeAdaptation.Component> components = new ArrayList<>();
    for (var choice : ordered) {
      var original = source.metrics().stream().filter(item -> item.componentId().equals(choice.componentId())).findFirst().orElseThrow();
      bindings.add(new MetricBinding(choice.slotIndex(), original.componentId(), original.metricId(), choice.chartFamily(), original.sceneType(), original.sourceType()));
      var config = candidate.slots().get(choice.slotIndex()).config();
      Map<String,Object> geometry = new HashMap<>();
      if (config != null) {
        geometry.put("relativeX", config.x()); geometry.put("relativeY", config.y());
        geometry.put("width", config.width()); geometry.put("height", config.height());
      }
      components.add(new SchemeAdaptation.Component(choice.componentId(), PrototypeComponentGeometry.parse(config == null ? null : geometry)));
    }
    var input = new SchemeAdaptation.Input(source.blockTypeId(), proposal.schemeId(), source.bounds(), source.titlePresent(),
        source.metricBindingStatus(), bindings, components);
    // 使用 current 的固定槽位校验路径；禁止候选匹配算法重排模型已经明确给出的主次安排。
    var placement = SchemeAdaptation.compare(input, List.of(candidate)).current();
    if (!"feasible".equals(placement.status())) throw new BackendException("BLOCK_IMPROVEMENT_INFEASIBLE",
        "建议组合不可行：" + String.join("；", placement.findings().stream().map(SchemeAdaptation.Finding::message).distinct().toList()));
    List<Change> changes = new ArrayList<>();
    for (var assignment : placement.assignments()) {
      var metric = metrics.get(assignment.componentId());
      int previous = source.metrics().stream().filter(item -> item.componentId().equals(metric.componentId())).findFirst().orElseThrow().slotIndex();
      changes.add(new Change(metric.componentId(), metric.metricId(), metric.name(), metric.chartFamily(),
          assignment.chartFamily(), previous, assignment.slotIndex(), choices.get(metric.componentId()).reason()));
    }
    boolean changed = textChanged || !Objects.equals(source.schemeId(), proposal.schemeId()) || changes.stream()
        .anyMatch(item -> !item.beforeChart().equals(item.afterChart()) || item.beforeSlot() != item.afterSlot());
    if (!changed) {
      var before = SchemeAdaptation.compare(source, List.of(candidate)).current();
      changed = "infeasible".equals(before.status()) || ("feasible".equals(before.status())
          && !before.assignments().stream().map(SchemeAdaptation.Assignment::bounds).toList()
              .equals(placement.assignments().stream().map(SchemeAdaptation.Assignment::bounds).toList()));
    }
    if (!changed) throw new BackendException("BLOCK_IMPROVEMENT_NO_CHANGE", "提案没有改变图形、分配或布局，无需执行改造。");
    List<String> pending = new ArrayList<>(proposal.limitations());
    pending.add("尚未应用到 EasyV；应用前须核对当前原型、业务权限及具体组件支持。");
    pending.add("冻结语义不能证明实际数据字段、维度和数值分布；图形变更须在 EasyV 执行前核验。");
    pending.add("空间检查使用待业务校准的适配规则；结构可行不代表实际渲染或业务质量通过。");
    return new Preview("proposal", context.title(), context.purpose(), proposal.diagnosis(), List.copyOf(changes), placement, List.copyOf(pending), textChanged ? textChange : null);
  }

  private static void requireText(String value, String field, int max) {
    if (value == null || value.isBlank() || value.length() > max) throw invalid(field + "缺失或过长");
  }
  private static BackendException invalid(String message) { return new BackendException("BLOCK_IMPROVEMENT_INVALID", message + "。"); }
}
