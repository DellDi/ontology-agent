package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.analysis.AnalysisSessionRepository;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.execution.AgentInvocationRepository;
import com.dip3.ontologyagent.easyv.internal.domain.BlockImprovement;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import java.util.*;

@Service
@ConditionalOnProperty(prefix="dip3.easyv",name="enabled",havingValue="true")
public class EasyVBlockActionService {
  private final AnalysisSessionRepository sessions;
  private final AgentInvocationRepository invocations;
  private final EasyVObjectReadService objects;
  private final IdentityAccountService identities;
  private final EasyVScopeResolver scopes;
  private final EasyVBlockActionStore store;
  private final EasyVBlockActionPort source;
  private final ObjectMapper json = new ObjectMapper();
  public EasyVBlockActionService(AnalysisSessionRepository sessions,AgentInvocationRepository invocations,
      EasyVObjectReadService objects,IdentityAccountService identities,EasyVScopeResolver scopes,
      EasyVBlockActionStore store,EasyVBlockActionPort source){
    this.sessions=sessions;this.invocations=invocations;this.objects=objects;this.identities=identities;
    this.scopes=scopes;this.store=store;this.source=source;
  }
  public record View(String invocationId,String title,String applicationName,BlockImprovement.Preview proposal,Map<String,String> chartLabels,
                     String actionId,String status,Map<String,Object> preparedBlock,String error) {}
  public View get(String session,String execution,String invocation,AuthSession viewer){
    var evidence=evidence(session,execution,invocation,viewer);
    var access=authorize(session,viewer,evidence);
    return view(access.get("applicationName"),invocation,evidence,store.latest(session,invocation,viewer.userId()).orElse(null));
  }
  public View prepare(String session,String execution,String invocation,AuthSession viewer){
    var evidence=evidence(session,execution,invocation,viewer);
    var access=authorize(session,viewer,evidence);
    var existing=store.latest(session,invocation,viewer.userId()).orElse(null);
    if(existing!=null && Set.of("prepared","applying","unknown","context_pending","verified").contains(existing.status()))
      return view(access.get("applicationName"),invocation,evidence,existing);
    var context=json.convertValue(evidence.get("input"),EasyVSchemeAssessmentService.ImprovementContext.class);
    var proposal=json.convertValue(evidence.get("proposal"),BlockImprovement.Proposal.class);
    BlockImprovement.preview(context.block(),proposal,context.chartTypes().keySet());
    var plan=new LinkedHashMap<String,Object>();
    plan.put("appId",access.get("appId"));plan.put("blockId",access.get("blockId"));
    plan.put("title",context.block().title());plan.put("purpose",context.block().purpose());
    plan.put("targetTitle",proposal.title());plan.put("targetPurpose",proposal.purpose());
    plan.put("blockTypeId",context.block().input().blockTypeId());plan.put("schemeId",proposal.schemeId());
    plan.put("choices",proposal.choices().stream().map(choice->{
      var metric=context.block().metrics().stream().filter(m->m.componentId().equals(choice.componentId())).findFirst().orElseThrow();
      var item=new LinkedHashMap<String,Object>();item.put("componentId",metric.componentId());item.put("metricId",metric.metricId());
      item.put("description",metric.description());item.put("insight",metric.insight());item.put("unit",metric.unit());item.put("aggregationRule",metric.aggregationRule());
      item.put("name",metric.name());item.put("beforeChart",metric.chartFamily());item.put("afterChart",choice.chartFamily());item.put("slotIndex",choice.slotIndex());
      return item;
    }).toList());
    var prepared=source.prepare(plan,access.get("userId"),access.get("spaceId"),access.get("teamId"));
    validatePrepared(prepared,plan,access);
    var saved=store.create(session,invocation,viewer.userId(),Map.of("executionId",execution,"access",access,"source",prepared));
    return view(access.get("applicationName"),invocation,evidence,saved);
  }
  public View confirm(String session,String actionId,AuthSession viewer){
    sessions.requireOwned(session,viewer);
    var action=store.require(actionId,session,viewer.userId());
    String execution=(String)action.prepared().get("executionId");
    var evidence=evidence(session,execution,action.invocationId(),viewer);
    var access=authorize(session,viewer,evidence);
    if(!json.valueToTree(access).equals(json.valueToTree(action.prepared().get("access"))))
      throw new BackendException("BLOCK_ACTION_FORBIDDEN","当前业务身份或目标范围已改变,请重新准备方案。");
    if(action.status().equals("verified")) return view(access.get("applicationName"),action.invocationId(),evidence,action);
    if(!store.claim(actionId)) return view(access.get("applicationName"),action.invocationId(),evidence,store.require(actionId,session,viewer.userId()));
    try {
      var result=source.apply(map(action.prepared().get("source")),access.get("userId"),access.get("spaceId"),access.get("teamId"));
      String status=String.valueOf(result.get("status"));
      if(!Set.of("verified","applied_context_pending").contains(status))
        throw new BackendException("EASYV_ACTION_RESULT_UNKNOWN","EasyV 返回了无法确认的执行状态。");
      var expected=map(action.prepared().get("source"));
      var after=map(expected.get("after"));
      if(!json.valueToTree(after.get("prototype")).equals(json.valueToTree(result.get("prototype"))))
        throw new BackendException("EASYV_ACTION_RESULT_UNKNOWN","保存后的原型与确认结果不一致,需核查。");
      store.finish(actionId,status.equals("verified")?"verified":"context_pending",result,
          status.equals("verified")?null:"原型已保存,编辑上下文未同步;核查可恢复同一方案的上下文。");
    }catch(BackendException error){
      String status=switch(error.code()) {
        case "EASYV_ACTION_FORBIDDEN","EASYV_ACTION_NOT_CONFIGURED" -> "failed";
        case "EASYV_ACTION_REJECTED" -> "conflict";
        default -> "unknown";
      };
      store.finish(actionId,status,Map.of(),error.getMessage());
    }
    return view(access.get("applicationName"),action.invocationId(),evidence,store.require(actionId,session,viewer.userId()));
  }
  private Map<String,Object> evidence(String session,String execution,String invocation,AuthSession viewer){
    sessions.requireOwned(session,viewer);
    return invocations.completedBlockProposals(session,execution,viewer.userId()).stream().filter(row->row.id.equals(invocation))
      .findFirst().map(row->row.output).orElseThrow(()->new BackendException("BLOCK_PROPOSAL_NOT_FOUND","没有可应用的已完成提案,或无权访问。"));
  }
  private Map<String,String> authorize(String session,AuthSession viewer,Map<String,Object> evidence){
    viewer=scopes.executionPrincipal(viewer);
    var context=json.convertValue(evidence.get("input"),EasyVSchemeAssessmentService.ImprovementContext.class);
    var selection=context.selection();
    var request=new EasyVObjectReadService.Request(selection.executionId(),selection.datasetVersionSetId(),
      selection.reference().objectKey(),selection.reference().objectId(),null,List.of(),List.of(),1,0);
    var block=objects.read(session,viewer,request).page().rows().getFirst().properties();
    var app=objects.read(session,viewer,new EasyVObjectReadService.Request(request.executionId(),request.datasetVersionSetId(),
      request.objectKey(),request.objectId(),"application",List.of(),List.of(),1,0)).page();
    if(app.rows().size()!=1)throw new BackendException("BLOCK_ACTION_FORBIDDEN","无法确定目标应用的业务归属。");
    String user=identities.subjectValue(Long.parseLong(viewer.userId()),"easyv","userId")
      .filter(v->v.matches("[1-9][0-9]*")).orElseThrow(()->new BackendException("EASYV_USER_BINDING_REQUIRED","请先绑定实际 EasyV 编辑用户;平台管理员身份不代替业务编辑身份。"));
    var owner=app.rows().getFirst().properties();
    // 首期只为已绑定的应用所有者开放;团队代理编辑需要独立的源授权契约。
    if(!user.equals(String.valueOf(owner.get("userId"))))throw new BackendException("BLOCK_ACTION_FORBIDDEN","当前 EasyV 身份不是该应用的所有者。");
    return Map.of("userId",user,"spaceId",required(owner,"spaceId"),"teamId",required(owner,"teamId"),
      "appId",required(block,"appId"),"blockId",required(block,"blockId"),"applicationName",block.get("pageTitle") instanceof String name && !name.isBlank()?name:"源记录未保留大屏名称");
  }
  private void validatePrepared(Map<String,Object> prepared,Map<String,Object> plan,Map<String,String> access){
    if(!json.valueToTree(plan).equals(json.valueToTree(prepared.get("plan")))
        ||!access.get("userId").equals(String.valueOf(prepared.get("actorUserId")))
        ||!access.get("spaceId").equals(String.valueOf(prepared.get("spaceId")))
        ||!access.get("teamId").equals(String.valueOf(prepared.get("teamId")))
        ||!(prepared.get("before") instanceof Map<?,?>)||!(prepared.get("after") instanceof Map<?,?>)
        ||!(prepared.get("block") instanceof Map<?,?>))
      throw new BackendException("EASYV_ACTION_PREPARE_INVALID","EasyV 准备结果与目标或身份不一致,未创建可确认动作。");
  }
  private View view(String applicationName,String invocation,Map<String,Object> evidence,EasyVBlockActionStore.Action action){
    var context=json.convertValue(evidence.get("input"),EasyVSchemeAssessmentService.ImprovementContext.class);
    if(action!=null && map(action.prepared().get("source")).get("applicationName") instanceof String liveName && !liveName.isBlank()) applicationName=liveName;
    return new View(invocation,context.block().title(),applicationName,json.convertValue(evidence.get("preview"),BlockImprovement.Preview.class),context.chartTypes(),
      action==null?null:action.id(),action==null?"proposal":action.status(),action==null?null:map(map(action.prepared().get("source")).get("block")),action==null?null:action.error());
  }
  @SuppressWarnings("unchecked") private static Map<String,Object> map(Object value){return (Map<String,Object>)value;}
  private static String required(Map<String,Object> values,String key){
    Object value=values.get(key);if(value==null||String.valueOf(value).isBlank())throw new BackendException("BLOCK_ACTION_EVIDENCE_MISSING","当前目标缺少业务归属: "+key);
    return String.valueOf(value);
  }
}
