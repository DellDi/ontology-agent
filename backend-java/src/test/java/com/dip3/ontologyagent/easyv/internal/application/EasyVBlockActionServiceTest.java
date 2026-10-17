package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.analysis.*;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.execution.*;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import java.time.Instant;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class EasyVBlockActionServiceTest {
  final AnalysisSessionRepository sessions=mock(AnalysisSessionRepository.class);
  final AgentInvocationRepository invocations=mock(AgentInvocationRepository.class);
  final EasyVObjectReadService objects=mock(EasyVObjectReadService.class);
  final IdentityAccountService identities=mock(IdentityAccountService.class);
  final EasyVScopeResolver scopes=mock(EasyVScopeResolver.class);
  final EasyVBlockActionStore store=mock(EasyVBlockActionStore.class);
  final EasyVBlockActionPort source=mock(EasyVBlockActionPort.class);
  final ObjectMapper json=new ObjectMapper();
  final EasyVBlockActionService service=new EasyVBlockActionService(sessions,invocations,objects,identities,scopes,store,source);
  final AuthSession viewer=new AuthSession("cookie","7","用户",new AccessScope("org",List.of(),List.of(),List.of("EASYV_ANALYST")),Instant.MAX);
  final ObjectSelection selection=new ObjectSelection("execution","set",new ObjectQueryPort.Reference("easyv-prototype-block","app:b","blocks"));
  final Map<String,String> access=Map.of("userId","3","spaceId","37","teamId","4","appId","app","blockId","b","applicationName","源记录未保留大屏名称");
  AgentInvocationEntity evidence;
  Map<String,Object> prepared;
  @BeforeEach void setup() {
    var config=new SchemeLibraryParser.Config("0%","0%","100%","100%");
    var scheme=new SchemeAdaptation.Candidate("1","1",1,"available",null,List.of(new SchemeLibraryParser.Slot(0,"1","main",1,new SchemeLibraryParser.Position(1,1,12,12),config,List.of("chart"),List.of())));
    var input=new SchemeAdaptation.Input("1","old",new PrototypeLayoutGeometry.Rect(0,0,1000,700),false,"available",
      List.of(new PrototypeStructureParser.MetricBinding(0,"c","m","bar","对比排行","AI")),
      List.of(new SchemeAdaptation.Component("c",new PrototypeComponentGeometry.Parsed("available",null,new PrototypeComponentGeometry.Box(0,0,100,100)))));
    var block=new BlockImprovement.Context("渠道贡献","比较渠道收入",List.of(new BlockImprovement.Metric("c","m","渠道收入","收入比较",null,"元","求和","bar")),input,List.of(scheme));
    var context=new EasyVSchemeAssessmentService.ImprovementContext(selection,"ontology",Map.of(),"assessment",block,Map.of("bar","柱状图","horizontal-bar","条形图"),List.of(selection.reference()));
    var proposal=new BlockImprovement.Proposal("1",List.of(new BlockImprovement.Choice("c","horizontal-bar",0,"便于阅读长渠道名称")),new BlockImprovement.Diagnosis("符合渠道对比目标","条形图便于比较","保留收入指标"),List.of());
    evidence=new AgentInvocationEntity();evidence.id="invocation";
    evidence.output=map(Map.of("input",context,"proposal",proposal,"preview",BlockImprovement.preview(block,proposal,context.chartTypes().keySet())));
    when(invocations.completedBlockProposals("session","execution","7")).thenReturn(List.of(evidence));
    when(scopes.executionPrincipal(viewer)).thenReturn(viewer);
    when(identities.subjectValue(7,"easyv","userId")).thenReturn(Optional.of("3"));
    when(objects.read(eq("session"),eq(viewer),any())).thenAnswer(i->{
      EasyVObjectReadService.Request req=i.getArgument(2);
      return detail(req.relation()==null?Map.of("appId","app","blockId","b"):Map.of("userId","3","spaceId","37","teamId","4","appName","渠道经营看板"));
    });
    when(store.latest("session","invocation","7")).thenReturn(Optional.empty());
    when(source.prepare(anyMap(),eq("3"),eq("37"),eq("4"))).thenAnswer(i->{
      prepared=Map.of("plan",i.getArgument(0),"actorUserId",3,"spaceId",37,"teamId",4,
        "before",Map.of("prototype",Map.of("before",true)),"after",Map.of("prototype",Map.of("after",true)),"block",Map.of("title","渠道贡献"));
      return prepared;
    });
    when(store.create(eq("session"),eq("invocation"),eq("7"),anyMap())).thenAnswer(i->action("prepared",i.getArgument(3)));
  }
  @Test void preparationRequiresOwnedAuditAndSourceIdentityAndDoesNotApply() {
    var result=service.prepare("session","execution","invocation",viewer);
    assertEquals("prepared",result.status());assertEquals("action",result.actionId());
    assertEquals("渠道贡献",result.title());verify(source,never()).apply(anyMap(),anyString(),anyString(),anyString());
    verify(store).create(eq("session"),eq("invocation"),eq("7"),argThat(data->data.get("source").equals(prepared)));
  }
  @Test void unknownOrOtherUsersProposalNeverReachesSource() {
    assertEquals("BLOCK_PROPOSAL_NOT_FOUND",assertThrows(BackendException.class,()->service.prepare("session","execution","other",viewer)).code());
    verifyNoInteractions(source,store);
  }
  @Test void platformAdministratorWithoutBusinessBindingCannotWrite() {
    when(identities.subjectValue(7,"easyv","userId")).thenReturn(Optional.empty());
    assertEquals("EASYV_USER_BINDING_REQUIRED",assertThrows(BackendException.class,()->service.prepare("session","execution","invocation",viewer)).code());
    verifyNoInteractions(source,store);
  }
  @Test void invalidPreparedIdentityCannotBecomeConfirmable() {
    when(source.prepare(anyMap(),anyString(),anyString(),anyString())).thenReturn(Map.of("plan",Map.of(),"actorUserId",8));
    assertEquals("EASYV_ACTION_PREPARE_INVALID",assertThrows(BackendException.class,()->service.prepare("session","execution","invocation",viewer)).code());
    verify(store,never()).create(anyString(),anyString(),anyString(),anyMap());
  }
  @Test void confirmsOnlyPersistedExactPayloadAndChecksReadback() {
    var action=preparedAction();
    when(source.apply(eq(prepared),eq("3"),eq("37"),eq("4"))).thenReturn(Map.of("status","verified","prototype",Map.of("after",true)));
    service.confirm("session","action",viewer);
    verify(store).finish(eq("action"),eq("verified"),anyMap(),isNull());
    verify(source,times(1)).apply(eq(prepared),eq("3"),eq("37"),eq("4"));
  }
  @Test void interruptedRequestStaysUnknownAndReadbackMismatchCannotReportSuccess() {
    preparedAction();
    when(source.apply(anyMap(),anyString(),anyString(),anyString())).thenThrow(new BackendException("EASYV_ACTION_RESULT_UNKNOWN","连接中断"));
    service.confirm("session","action",viewer);
    verify(store).finish("action","unknown",Map.of(),"连接中断");
    reset(source,store);preparedAction();
    when(source.apply(anyMap(),anyString(),anyString(),anyString())).thenReturn(Map.of("status","verified","prototype",Map.of("wrong",true)));
    service.confirm("session","action",viewer);
    verify(store).finish(eq("action"),eq("unknown"),eq(Map.of()),contains("不一致"));
  }
  @Test void repeatedSuccessfulOrBusyConfirmationDoesNotResubmit() {
    var action=preparedAction();
    when(store.require("action","session","7")).thenReturn(new EasyVBlockActionStore.Action(action.id(),action.sessionId(),action.invocationId(),action.owner(),"verified",action.prepared(),Map.of(),null,Instant.now()));
    assertEquals("verified",service.confirm("session","action",viewer).status());
    verify(source,never()).apply(anyMap(),anyString(),anyString(),anyString());
    when(store.require("action","session","7")).thenReturn(action);when(store.claim("action")).thenReturn(false);
    service.confirm("session","action",viewer);
    verify(source,never()).apply(anyMap(),anyString(),anyString(),anyString());
  }
  @Test void contextFailureIsDistinctFromFullSuccess() {
    preparedAction();
    when(source.apply(anyMap(),anyString(),anyString(),anyString())).thenReturn(Map.of("status","applied_context_pending","prototype",Map.of("after",true)));
    service.confirm("session","action",viewer);
    verify(store).finish(eq("action"),eq("context_pending"),anyMap(),contains("原型已保存"));
  }
  private EasyVBlockActionStore.Action preparedAction(){
    if(prepared==null)service.prepare("session","execution","invocation",viewer);
    var action=action("prepared",Map.of("executionId","execution","access",access,"source",prepared));
    when(store.require("action","session","7")).thenReturn(action);when(store.claim("action")).thenReturn(true);return action;
  }
  private EasyVBlockActionStore.Action action(String status,Map<String,Object> payload){return new EasyVBlockActionStore.Action("action","session","invocation","7",status,payload,Map.of(),null,Instant.now());}
  @SuppressWarnings("unchecked") private Map<String,Object> map(Object value){return json.convertValue(value,Map.class);}
  private EasyVObjectReadService.Result detail(Map<String,Object> properties){
    return new EasyVObjectReadService.Result("execution","set","ontology",new ObjectQueryPort.Page("easyv-prototype-block",List.of(new ObjectQueryPort.Row(selection.reference(),properties)),1,0,false),null,null,Map.of(),null,null,null);
  }
}
