package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.*;
import com.dip3.ontologyagent.easyv.internal.domain.*;
import com.dip3.ontologyagent.ingestion.api.*;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.semantic.internal.adapter.out.postgres.PostgresObjectQueryAdapter;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@Testcontainers
class EasyVFailureInspectionTest {
  @Container static final PostgreSQLContainer POSTGRES=new PostgreSQLContainer("postgres:17.8-alpine");
  private static JdbcTemplate jdbc;
  private static ObjectQueryPort objects;
  private DatasetVersionSetRegistry datasets;
  private EasyVFailureInspectionService service;
  private final AuthSession admin=viewer("PLATFORM_ADMIN"), analyst=viewer("EASYV_ANALYST");

  @BeforeAll static void setup() {
    jdbc=new JdbcTemplate(new DriverManagerDataSource(POSTGRES.getJdbcUrl(),POSTGRES.getUsername(),POSTGRES.getPassword()));
    jdbc.execute("create schema facts");
    jdbc.execute("create table facts.easyv_ai_application(product_version_id text,app_id text,user_id bigint,is_deleted boolean)");
    jdbc.execute("create table facts.easyv_forge_generation_task(product_version_id text,task_id text,app_id text,status text,failure_reason text,created_at timestamptz,started_at timestamptz,finished_at timestamptz)");
    objects=new PostgresObjectQueryAdapter(jdbc,SemanticModel.discover());
  }
  @BeforeEach void reset() {
    jdbc.execute("truncate facts.easyv_ai_application,facts.easyv_forge_generation_task");
    datasets=mock(DatasetVersionSetRegistry.class);
    when(datasets.latestFrozen(anySet())).thenReturn(Optional.of(version("current")));
    when(datasets.requireFrozen(eq("current"),anySet())).thenReturn(version("current"));
    when(datasets.previousFrozen(eq("current"),anySet())).thenReturn(Optional.of(version("previous")));
    var accounts=mock(IdentityAccountService.class);
    when(accounts.subjectValue(7L,"easyv","userId")).thenReturn(Optional.of("1"));
    service=new EasyVFailureInspectionService(datasets,new EasyVScopeResolver(accounts),objects);
    for (String version:List.of("current","previous")) {
      app(version,"app-a",1,false);app(version,"app-b",2,false);app(version,"deleted",1,true);
    }
  }
  @Test void reusesCanonicalMembershipScopesAndDistinctFailureChanges() {
    task("current","same","app-a","failed");task("previous","same","app-a","failed");
    task("current","changed","app-a","failed");task("previous","changed","app-a","running");
    task("current","first","app-a","failed");
    task("current","other","app-b","failed");
    task("current","orphan","missing-app","failed");task("current","gone","deleted","failed");
    var report=service.inspect(analyst,null,0);
    assertEquals(3,report.summary().totalFailures());
    assertEquals(1,report.summary().changedToFailed());assertEquals(1,report.summary().firstVisibleFailures());
    assertEquals(1,report.summary().failedInBoth());assertEquals(0,report.summary().withoutBaseline());
    assertEquals(1,report.summary().repeatedApplications());assertEquals(3,report.repeatedApplications().getFirst().failureCount());
    assertEquals(4,service.inspect(admin,null,0).summary().totalFailures(),"管理员也沿用应用成员资格，不能把两个孤立/删除应用任务计入业务统计");
    assertTrue(report.failures().stream().allMatch(row -> row.application().objectId().equals("app-a")));
  }
  @Test void previousOwnershipCannotLeakOrMasqueradeAsAChangedStatus() {
    app("previous","was-other",2,false);app("current","was-other",1,false);
    task("previous","moved","was-other","running");task("current","moved","was-other","failed");
    var row=service.inspect(analyst,null,0).failures().getFirst();
    assertEquals(FailureChange.FIRST_VISIBLE_FAILURE,row.change());assertNull(row.previousStatus());
    assertEquals(FailureChange.CHANGED_TO_FAILED,service.inspect(admin,null,0).failures().getFirst().change());
  }
  @Test void noBaselineAndEmptyResultsRemainExplicit() {
    when(datasets.previousFrozen(eq("current"),anySet())).thenReturn(Optional.empty());
    var empty=service.inspect(analyst,null,0);assertNull(empty.baseline());assertEquals(0,empty.summary().totalFailures());
    task("current","first","app-a","failed");
    var report=service.inspect(analyst,null,0);assertEquals(1,report.summary().withoutBaseline());
    assertEquals(0,report.summary().firstVisibleFailures());assertEquals(FailureChange.NO_BASELINE,report.failures().getFirst().change());
  }
  @Test void summaryScansEveryPageAndPagingStaysOnRequestedFrozenVersion() {
    for (int i=0;i<105;i++) task("current","task-"+i,"app-a","failed");
    var first=service.inspect(analyst,null,0);var second=service.inspect(analyst,"current",50);var last=service.inspect(analyst,"current",100);
    assertEquals(105,first.summary().totalFailures());assertEquals(105,last.summary().totalFailures());
    assertEquals(105,first.repeatedApplications().getFirst().failureCount());
    assertEquals(50,first.failures().size());assertEquals(50,second.failures().size());assertEquals(5,last.failures().size());
    assertTrue(first.hasMore());assertFalse(last.hasMore());
    assertTrue(Collections.disjoint(first.failures().stream().map(row -> row.reference().objectId()).toList(),second.failures().stream().map(row -> row.reference().objectId()).toList()));
    verify(datasets,times(2)).requireFrozen(eq("current"),anySet());
  }
  @Test void rejectsUnauthorizedUnboundAndInvalidOffsetsBeforeBusinessReads() {
    assertThrows(BackendException.class,() -> service.inspect(viewer("PLATFORM_VIEWER"),null,0));
    assertThrows(BackendException.class,() -> service.inspect(analyst,null,-1));
    assertThrows(BackendException.class,() -> service.inspect(analyst,null,1));
    assertThrows(BackendException.class,() -> service.inspect(analyst,null,10050));
    verifyNoInteractions(datasets);
    var noBinding=new EasyVFailureInspectionService(datasets,new EasyVScopeResolver(mock(IdentityAccountService.class)),objects);
    assertEquals("EASYV_USER_BINDING_REQUIRED",assertThrows(BackendException.class,() -> noBinding.inspect(analyst,null,0)).code());
  }
  @Test void objectQueryCeilingRejectsTheWholeInspectionInsteadOfReturningPartialCounts() {
    var alwaysMore=mock(ObjectQueryPort.class);
    when(alwaysMore.query(any(),any())).thenReturn(new ObjectQueryPort.Page("easyv-forge-task",List.of(),50,0,true));
    var accounts=mock(IdentityAccountService.class);
    var capped=new EasyVFailureInspectionService(datasets,new EasyVScopeResolver(accounts),alwaysMore);
    assertEquals("OBJECT_QUERY_INVALID",assertThrows(BackendException.class,() -> capped.inspect(admin,null,0)).code());
  }
  private static void app(String version,String id,long user,boolean deleted) {
    jdbc.update("insert into facts.easyv_ai_application values(?,?,?,?)",version+"-apps",id,user,deleted);
  }
  private static void task(String version,String id,String app,String status) {
    jdbc.update("insert into facts.easyv_forge_generation_task values(?,?,?,?,?,'2026-10-01T00:00:00Z',null,null)",version+"-forge",id,app,status,"source self report");
  }
  private static AuthSession viewer(String role) {
    return new AuthSession("session","7","User",new AccessScope("org",List.of(),List.of(),List.of(role)),Instant.MAX);
  }
  private static DatasetVersionSet version(String id) {
    var at=Instant.parse(id.equals("current")?"2026-10-11T00:00:00Z":"2026-10-10T00:00:00Z");
    return new DatasetVersionSet(id,Map.of("easyv-ai-application",id+"-apps","easyv-forge-task",id+"-forge"),at,DatasetVersionSet.Status.FROZEN,at,at,"test");
  }
}
