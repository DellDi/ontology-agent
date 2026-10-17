package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import java.util.function.Function;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
import com.dip3.ontologyagent.semantic.api.ObjectQueryPort;
import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@ConditionalOnProperty(prefix="dip3.easyv", name="enabled", havingValue="true")
public class EasyVSchemeAssessmentService {
  private final EasyVObjectReadService objects;
  private final DatasetVersionSetRegistry datasets;
  private final SchemeAssessmentPort facts;
  private static final ObjectMapper JSON=new ObjectMapper();
  public EasyVSchemeAssessmentService(EasyVObjectReadService objects,DatasetVersionSetRegistry datasets,SchemeAssessmentPort facts) {
    this.objects=objects;this.datasets=datasets;this.facts=facts;
  }
  public record Result(String assessmentId,ObjectSelection selection,String ontologyVersionId,
      Map<String,String> productVersionIds,String status,String reason,
      PrototypeLayoutGeometry.Result geometry,List<SchemeAdaptation.Candidate> candidateInputs,
      SchemeAdaptation.Comparison comparison) {}

  @Transactional
  public Result assess(String sessionId,AuthSession viewer,ObjectSelection selection) {
    return assess(sessionId, viewer, selection, request -> objects.read(sessionId, viewer, request));
  }

  @Transactional(timeout = 30)
  public Result assessDuringExecution(CapabilityExecutionContext context, ResolvedScopeSnapshot scope, ObjectSelection selection) {
    return assess(context.turn().sessionId(), context.principal(), selection,
        request -> objects.readDuringExecution(context, scope, request));
  }

  public record ImprovementContext(ObjectSelection selection, String ontologyVersionId,
      Map<String,String> productVersionIds, String assessmentId, BlockImprovement.Context block,
      Map<String,String> chartTypes, List<ObjectQueryPort.Reference> references) {}

  @Transactional(timeout = 30)
  public ImprovementContext inspectImprovementDuringExecution(CapabilityExecutionContext context,
      ResolvedScopeSnapshot scope, ObjectSelection selection) {
    var assessment = assessDuringExecution(context, scope, selection);
    if (assessment.comparison() == null || assessment.comparison().input().metrics() == null
        || assessment.geometry() == null || assessment.geometry().bounds() == null)
      throw new BackendException("BLOCK_IMPROVEMENT_EVIDENCE_MISSING", "当前块缺少方案库、指标绑定或可评估的布局尺寸。");
    if (assessment.comparison().input().metrics().isEmpty() || assessment.comparison().input().metrics().size() > SchemeAdaptation.RULES.maxMetrics())
      throw new BackendException("BLOCK_IMPROVEMENT_EVIDENCE_MISSING", "当前块的指标数量超出已支持的普通内容块范围。");
    var block = improvementRead(context, scope, selection.reference().objectKey(), selection.reference().objectId(), null, assessment.productVersionIds());
    var properties = block.page().rows().getFirst().properties();
    var components = improvementRead(context, scope, selection.reference().objectKey(), selection.reference().objectId(), "components", assessment.productVersionIds());
    var bindings = assessment.comparison().input().metrics();
    if (components.page().hasMore() || components.page().rows().size() != bindings.size())
      throw new BackendException("BLOCK_IMPROVEMENT_EVIDENCE_MISSING", "组件集合与当前块的完整指标绑定不一致。");
    Map<String,ObjectQueryPort.Row> rows = new LinkedHashMap<>();
    for (var row : components.page().rows()) {
      var detail = improvementRead(context, scope, row.reference().objectKey(), row.reference().objectId(), null, assessment.productVersionIds())
          .page().rows().getFirst();
      if (!detail.reference().equals(row.reference()) || !selection.reference().objectId().equals(detail.properties().get("blockKey"))
          || rows.put(property(detail.properties(), "componentId"), detail) != null)
        throw new BackendException("OBJECT_VERSION_MISMATCH", "指标详情不属于当前块或包含重复组件。");
    }
    List<BlockImprovement.Metric> metrics = new ArrayList<>();
    for (var binding : bindings) {
      var row = rows.get(binding.componentId());
      if (row == null || !Objects.equals(binding.chartFamily(), row.properties().get("chartFamily")))
        throw new BackendException("OBJECT_VERSION_MISMATCH", "组件详情与冻结指标绑定不一致。");
      var values = row.properties();
      metrics.add(new BlockImprovement.Metric(binding.componentId(), binding.metricId(), optionalText(values,"metricName"),
          optionalText(values,"metricDescription"), optionalText(values,"metricInsight"), optionalText(values,"metricUnit"),
          optionalText(values,"aggregationRule"), binding.chartFamily()));
    }
    String title = optionalText(properties,"businessModule");
    if (title == null) title = optionalText(properties,"blockTitle");
    var schemes = assessment.candidateInputs().stream().filter(item -> item.chartCount() == metrics.size()).toList();
    var description = new BlockImprovement.Context(title, optionalText(properties,"moduleDescription"), List.copyOf(metrics),
        assessment.comparison().input(), schemes);
    List<ObjectQueryPort.Reference> references = new ArrayList<>();
    references.add(selection.reference()); rows.values().forEach(row -> references.add(row.reference()));
    return new ImprovementContext(selection, assessment.ontologyVersionId(), assessment.productVersionIds(), assessment.assessmentId(), description,
        EasyVOntologyModel.PROTOTYPE_COMPONENT.requireProperty("chartFamily").valueLabels(), List.copyOf(references));
  }

  private EasyVObjectReadService.Result improvementRead(CapabilityExecutionContext context, ResolvedScopeSnapshot scope,
      String key, String id, String relation, Map<String,String> versions) {
    var result = objects.readDuringExecution(context, scope, new EasyVObjectReadService.Request(context.executionId(),
        context.datasetVersionSetId(), key, id, relation, List.of(), List.of(), relation == null ? 1 : 50, 0));
    String resultKey = relation == null ? key : EasyVOntologyModel.PROTOTYPE_COMPONENT.key();
    String version = versions.get(resultKey);
    if (!context.executionId().equals(result.executionId()) || !context.datasetVersionSetId().equals(result.datasetVersionSetId())
        || !context.ontology().versionId().equals(result.ontologyVersionId()) || !resultKey.equals(result.page().objectKey())
        || result.page().rows().stream().anyMatch(row -> !resultKey.equals(row.reference().objectKey())
            || !Objects.equals(version, row.reference().productVersionId()))
        || (relation == null && (result.page().rows().size() != 1 || !id.equals(result.page().rows().getFirst().reference().objectId()))))
      throw new BackendException("OBJECT_VERSION_MISMATCH", "改造输入与本轮冻结执行不一致。");
    return result;
  }

  private static String optionalText(Map<String,Object> values, String key) {
    Object value = values.get(key);
    return value instanceof String text && !text.isBlank() ? text : null;
  }

  private Result assess(String sessionId, AuthSession viewer, ObjectSelection selection,
      Function<EasyVObjectReadService.Request, EasyVObjectReadService.Result> reader) {
    if(selection==null || !EasyVOntologyModel.PROTOTYPE_BLOCK.key().equals(selection.reference().objectKey()))
      throw new BackendException("SCHEME_ASSESSMENT_INVALID","方案评估需要冻结区域对象引用。");
    var selected=reader.apply(new EasyVObjectReadService.Request(selection.executionId(),selection.datasetVersionSetId(),
        selection.reference().objectKey(),selection.reference().objectId(),null,null,null,1,0));
    var row=selected.page().rows().getFirst();
    if(!row.reference().equals(selection.reference())) throw new BackendException("OBJECT_VERSION_MISMATCH","选中区域与冻结对象版本不一致。");
    String appId=property(row.properties(),"appId"),blockId=property(row.properties(),"blockId");
    var manifest=datasets.requireFrozen(selected.datasetVersionSetId(),Set.of("easyv-prototype-layout","easyv-prototype-block","easyv-prototype-component"));
    var versions=manifest.productVersionIds();
    if(!Objects.equals(row.reference().productVersionId(),versions.get("easyv-prototype-block")))
      throw new BackendException("OBJECT_VERSION_MISMATCH","区域产品版本与冻结集合不一致。");
    String id=UUID.randomUUID().toString();
    Result result;
    if(!versions.containsKey("easyv-scheme-library")) result=new Result(id,selection,selected.ontologyVersionId(),versions,
        "unassessable","SCHEME_LIBRARY_NOT_RETAINED",null,List.of(),null);
    else {
      var layout=reader.apply(new EasyVObjectReadService.Request(selection.executionId(),selection.datasetVersionSetId(),
          EasyVOntologyModel.PROTOTYPE_LAYOUT.key(),appId,null,null,null,1,0));
      PrototypeStructureParser.LayoutNode tree=null;
      if(layout.structure()!=null && "available".equals(layout.structure().status())) {
        try { tree=JSON.convertValue(layout.structure().layout(),PrototypeStructureParser.LayoutNode.class); }
        catch(IllegalArgumentException failure) { throw new BackendException("DATABASE_JSON_INVALID","冻结版式树无效。",failure); }
      }
      var geometry=PrototypeLayoutGeometry.block(tree,blockId);
      var block=facts.block(versions.get("easyv-prototype-block"),versions.get("easyv-prototype-component"),appId,blockId);
      var candidates=facts.candidates(versions.get("easyv-scheme-library"),block.blockTypeId());
      var input=new SchemeAdaptation.Input(block.blockTypeId(),block.schemeId(),geometry.bounds(),block.titlePresent(),
          block.metricBindingStatus(),block.metrics(),block.components());
      var comparison=SchemeAdaptation.compare(input,candidates);
      result=new Result(id,selection,selected.ontologyVersionId(),versions,candidates.isEmpty()?"unassessable":"evaluated",
          candidates.isEmpty()?"SCHEME_CANDIDATES_NOT_RETAINED":null,geometry,candidates,comparison);
    }
    facts.audit(id,sessionId,viewer,result);
    return result;
  }
  private static String property(Map<String,Object> values,String key) {
    Object value=values.get(key);
    if(!(value instanceof String text) || text.isBlank()) throw new BackendException("SCHEME_ASSESSMENT_INVALID","区域缺少属性："+key);
    return text;
  }
}
