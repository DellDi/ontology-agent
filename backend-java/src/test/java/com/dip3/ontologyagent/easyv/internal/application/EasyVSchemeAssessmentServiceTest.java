package com.dip3.ontologyagent.easyv.internal.application;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.*;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EasyVSchemeAssessmentServiceTest {
  private final EasyVObjectReadService objects=mock(EasyVObjectReadService.class);
  private final DatasetVersionSetRegistry datasets=mock(DatasetVersionSetRegistry.class);
  private final SchemeAssessmentPort facts=mock(SchemeAssessmentPort.class);
  private final EasyVSchemeAssessmentService service=new EasyVSchemeAssessmentService(objects,datasets,facts);
  private final AuthSession viewer=new AuthSession("cookie","1","用户",new AccessScope("org",List.of(),List.of(),List.of("PLATFORM_ADMIN")),Instant.MAX);
  private final ObjectSelection selection=new ObjectSelection("execution-old","set-old",new ObjectQueryPort.Reference("easyv-prototype-block","1:b","blocks-old"));
  private final Map<String,String> versions=Map.of("easyv-prototype-layout","layouts-old","easyv-prototype-block","blocks-old","easyv-prototype-component","components-old","easyv-scheme-library","schemes-old");
  @BeforeEach void setup() {
    when(objects.read(eq("session"),eq(viewer),argThat(r -> r.objectKey().equals("easyv-prototype-block")))).thenReturn(detail(selection.reference(),Map.of("appId","app","blockId","b"),null));
    when(datasets.requireFrozen(eq("set-old"),anySet())).thenReturn(manifest(versions));
    var tree=new PrototypeStructureParser.LayoutNode("Page",Map.of("width","1000","height","700"),List.of(new PrototypeStructureParser.LayoutNode("Layout",Map.of(),List.of(new PrototypeStructureParser.LayoutNode("Block",Map.of("id","b","span","12"),List.of())))));
    when(objects.read(eq("session"),eq(viewer),argThat(r -> r.objectKey().equals("easyv-prototype-layout")))).thenReturn(detail(new ObjectQueryPort.Reference("easyv-prototype-layout","app","layouts-old"),Map.of(),new EasyVObjectReadService.Structure("available",new JsonCodec().map(new JsonCodec().write(tree)))));
    when(facts.block("blocks-old","components-old","app","b")).thenReturn(new SchemeAssessmentPort.Block("type","current",false,"available",
        List.of(new PrototypeStructureParser.MetricBinding(0,"c","m","bar",null,null)),List.of(new SchemeAdaptation.Component("c",new PrototypeComponentGeometry.Parsed("available",null,new PrototypeComponentGeometry.Box(0,0,100,100))))));
    when(facts.candidates("schemes-old","type")).thenReturn(List.of(new SchemeAdaptation.Candidate("current","type",1,"available",null,List.of(new SchemeLibraryParser.Slot(0,"1","main",1,new SchemeLibraryParser.Position(1,1,12,12),new SchemeLibraryParser.Config("0%","0%","100%","100%"),List.of("chart"),List.of())))));
  }
  @Test void runtimeAssessmentUsesLeasedObjectReaderAndSameFrozenManifestWithoutCompletedSnapshot() {
    var context = new com.dip3.ontologyagent.capability.api.CapabilityExecutionContext(viewer,
        new com.dip3.ontologyagent.agent.AgentTurn("java-initial-v1", "session", "比较区域方案", null, null, Map.of(), Map.of(), Instant.now()),
        "execution-old", new com.dip3.ontologyagent.ontology.OntologyCatalog("ontology-old", "1", List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of()), "set-old", "trace", "worker");
    var scope = new com.dip3.ontologyagent.capability.api.ResolvedScopeSnapshot("easyv", 2, Map.of("userId", "1", "accessMode", "all"));
    when(objects.readDuringExecution(eq(context), eq(scope), any())).thenReturn(detail(selection.reference(), Map.of("appId", "app", "blockId", "b"), null));
    var retained = new HashMap<>(versions); retained.remove("easyv-scheme-library");
    when(datasets.requireFrozen(eq("set-old"), anySet())).thenReturn(manifest(retained));
    var result = service.assessDuringExecution(context, scope, selection);
    assertEquals("SCHEME_LIBRARY_NOT_RETAINED", result.reason());
    assertEquals(retained, result.productVersionIds());
    verify(objects, never()).read(anyString(), any(), any());
    verify(facts).audit(result.assessmentId(), "session", viewer, result);
  }
  @Test void evaluatesOnlyAuthorizedFrozenVersionsAndPersistsReplayableEvidence() {
    var result=service.assess("session",viewer,selection);
    assertEquals("evaluated",result.status());assertEquals("feasible",result.comparison().current().status());
    assertEquals(versions,result.productVersionIds());assertEquals("ontology-old",result.ontologyVersionId());
    assertEquals("available",result.geometry().status());
    verify(facts).audit(result.assessmentId(),"session",viewer,result);
    verify(datasets,never()).latestFrozen(anySet());
    var json=new JsonCodec();
    var serialized=new HashMap<>(json.map(json.write(result)));serialized.put("assessmentId","assessment-fixture");
    try {
      assertEquals(json.map(java.nio.file.Files.readString(java.nio.file.Path.of("..","contracts","backend","fixtures","scheme-assessment.json"))),serialized);
    } catch(java.io.IOException failure) { throw new AssertionError(failure); }
    var replay=SchemeAdaptation.compare(result.comparison().input(),result.candidateInputs());assertEquals(result.comparison(),replay);
  }
  @Test void permissionOrVersionFailureOccursBeforeAnyAssessmentFactReadOrAudit() {
    when(objects.read(eq("session"),eq(viewer),any())).thenThrow(new BackendException("OBJECT_SCOPE_FORBIDDEN","范围已失效"));
    assertEquals("OBJECT_SCOPE_FORBIDDEN",assertThrows(BackendException.class,() -> service.assess("session",viewer,selection)).code());
    verifyNoInteractions(facts,datasets);
  }
  @Test void forgedProductReferenceCannotSelectNewFacts() {
    var forged=new ObjectSelection("execution-old","set-old",new ObjectQueryPort.Reference("easyv-prototype-block","1:b","blocks-new"));
    assertEquals("OBJECT_VERSION_MISMATCH",assertThrows(BackendException.class,() -> service.assess("session",viewer,forged)).code());
    verifyNoInteractions(facts,datasets);
  }
  @Test void oldManifestDoesNotUseLatestLibraryAndAuditRetainsUnavailableReason() {
    var old=new HashMap<>(versions);old.remove("easyv-scheme-library");
    when(datasets.requireFrozen(eq("set-old"),anySet())).thenReturn(manifest(old));
    var result=service.assess("session",viewer,selection);
    assertEquals("unassessable",result.status());assertEquals("SCHEME_LIBRARY_NOT_RETAINED",result.reason());assertNull(result.comparison());
    verify(facts,never()).block(anyString(),anyString(),anyString(),anyString());
    verify(facts,never()).candidates(anyString(),anyString());verify(facts).audit(result.assessmentId(),"session",viewer,result);
  }
  @Test void lostStructureAndMetricEvidenceRemainVisibleRatherThanThrowingOrInventingScores() {
    when(objects.read(eq("session"),eq(viewer),argThat(r -> r.objectKey().equals("easyv-prototype-layout")))).thenReturn(detail(new ObjectQueryPort.Reference("easyv-prototype-layout","app","layouts-old"),Map.of(),new EasyVObjectReadService.Structure("not_retained",null)));
    var result=service.assess("session",viewer,selection);
    assertEquals("unassessable",result.comparison().current().status());assertNull(result.comparison().current().score());
    assertEquals("LAYOUT_NOT_RETAINED",result.geometry().errorCode());
  }
  @Test void auditFailureIsNotSilentlyIgnored() {
    doThrow(new BackendException("AUDIT_WRITE_FAILED","数据库不可用")).when(facts).audit(anyString(),anyString(),any(),any());
    assertEquals("AUDIT_WRITE_FAILED",assertThrows(BackendException.class,() -> service.assess("session",viewer,selection)).code());
  }
  private EasyVObjectReadService.Result detail(ObjectQueryPort.Reference reference,Map<String,Object> props,EasyVObjectReadService.Structure structure) {
    return new EasyVObjectReadService.Result("execution-old","set-old","ontology-old",new ObjectQueryPort.Page(reference.objectKey(),List.of(new ObjectQueryPort.Row(reference,props)),1,0,false),structure,null,Map.of());
  }
  private DatasetVersionSet manifest(Map<String,String> values) { return new DatasetVersionSet("set-old",values,Instant.EPOCH,DatasetVersionSet.Status.FROZEN,Instant.EPOCH,Instant.EPOCH,"test"); }
}
