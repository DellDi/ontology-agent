package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.capability.api.CapabilityExecutionContext;
import com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot;
import java.util.function.Function;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.semantic.api.ObjectSelection;
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

  private Result assess(String sessionId, AuthSession viewer, ObjectSelection selection,
      Function<EasyVObjectReadService.Request, EasyVObjectReadService.Result> reader) {
    if(selection==null || !EasyVOntologyModel.PROTOTYPE_BLOCK.key().equals(selection.reference().objectKey()))
      throw new BackendException("SCHEME_ASSESSMENT_INVALID","方案评估需要冻结区域对象引用。");
    var selected=reader.apply(new EasyVObjectReadService.Request(selection.executionId(),selection.datasetVersionSetId(),
        selection.reference().objectKey(),selection.reference().objectId(),null,null,null,1,0));
    var row=selected.page().rows().getFirst();
    if(!row.reference().equals(selection.reference())) throw new BackendException("OBJECT_VERSION_MISMATCH","选中区域与冻结对象版本不一致。");
    String appId=property(row.properties(),"appId"),blockId=property(row.properties(),"blockId");
    var manifest=datasets.requireFrozen(selection.datasetVersionSetId(),Set.of("easyv-prototype-layout","easyv-prototype-block","easyv-prototype-component"));
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
