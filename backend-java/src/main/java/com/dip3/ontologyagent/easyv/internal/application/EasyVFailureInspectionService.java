package com.dip3.ontologyagent.easyv.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.easyv.internal.domain.EasyVGenerationOntology;
import com.dip3.ontologyagent.easyv.internal.domain.FailureChange;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.semantic.api.*;
import com.dip3.ontologyagent.support.BackendException;
import java.time.Instant;
import java.util.*;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

/** 按需巡检，复用正式对象查询的成员资格和账号范围；不读取业务源。 */
@Service
@ConditionalOnProperty(prefix="dip3.easyv", name="enabled", havingValue="true")
public class EasyVFailureInspectionService {
  private final DatasetVersionSetRegistry datasets;
  private final EasyVScopeResolver scopes;
  private final ObjectQueryPort objects;
  private static final Set<String> PRODUCTS = EasyVGenerationOntology.REQUIRED_DATA_PRODUCT_KEYS;
  private static final int PAGE_SIZE = 50;

  public EasyVFailureInspectionService(DatasetVersionSetRegistry datasets, EasyVScopeResolver scopes, ObjectQueryPort objects) {
    this.datasets=datasets; this.scopes=scopes; this.objects=objects;
  }
  public record Version(String id, Instant capturedAt) {
    static Version of(DatasetVersionSet set) { return new Version(set.publicationId(), set.capturedAt()); }
  }
  public record Failure(ObjectQueryPort.Reference reference, ObjectQueryPort.Reference application,
      String reason, String createdAt, String finishedAt, String previousStatus, FailureChange change) {}
  public record RepeatedApplication(ObjectQueryPort.Reference reference, long failureCount) {}
  public record Summary(int totalFailures, long changedToFailed, long firstVisibleFailures, long failedInBoth,
      long withoutBaseline, long repeatedApplications) {}
  public record Report(Version current, Version baseline, String scopeLabel, Summary summary,
      List<RepeatedApplication> repeatedApplications, List<Failure> failures, int offset, int limit, boolean hasMore) {}

  @Transactional(readOnly=true, isolation=Isolation.REPEATABLE_READ)
  public Report inspect(AuthSession viewer, String setId, int offset) {
    if (offset<0 || offset>10000 || offset%PAGE_SIZE!=0)
      throw new BackendException("OBJECT_QUERY_INVALID", "巡检分页位置必须是 0..10000 内的 50 的倍数。");
    var scope=scopes.resolveScope(viewer);
    var current=setId==null ? datasets.latestFrozen(PRODUCTS).orElseThrow(() ->
        new BackendException("DATASET_VERSION_SET_NOT_PUBLISHED", "当前尚无完整发布的 EasyV 数据。"))
        : datasets.requireFrozen(setId, PRODUCTS);
    var baseline=datasets.previousFrozen(current.publicationId(), PRODUCTS).orElse(null);
    var dataScope=EasyVScopeResolver.dataScope(scope);
    var access=new SemanticQueryPort.AccessContext(current.productVersionIds(), dataScope);
    var rows=new ArrayList<ObjectQueryPort.Row>();
    // 读取完整失败集合再统计；沿用对象查询的分页边界，超出边界明确拒绝，不把前 N 条冒充全量。
    for (int start=0;;start+=PAGE_SIZE) {
      if (start>10000) throw new BackendException("OBJECT_QUERY_INVALID", "失败记录超出当前对象查询的完整巡检范围，未返回部分统计。");
      var page=objects.query(new ObjectQueryPort.Query("easyv-forge-task",
          List.of(new QueryIntent.Filter("status", QueryIntent.Operator.EQUALS, List.of("failed"))),
          List.of(new QueryIntent.Order("createdAt", QueryIntent.Direction.DESC)), PAGE_SIZE, start), access);
      rows.addAll(page.rows());
      if (!page.hasMore()) break;
    }
    Map<String,String> previous=new HashMap<>();
    if (baseline!=null) {
      var oldAccess=new SemanticQueryPort.AccessContext(baseline.productVersionIds(), dataScope);
      for (int start=0; start<rows.size(); start+=100) {
        var ids=rows.subList(start,Math.min(start+100,rows.size())).stream().map(row -> row.reference().objectId()).toList();
        var page=objects.query(new ObjectQueryPort.Query("easyv-forge-task",
            List.of(new QueryIntent.Filter("taskId", QueryIntent.Operator.EQUALS, ids)), List.of(), 200, 0), oldAccess);
        if (page.hasMore()) throw new BackendException("OBJECT_IDENTITY_VIOLATION", "冻结数据的任务身份不唯一。");
        for (var row:page.rows()) previous.put(row.reference().objectId(), text(row,"status"));
      }
    }
    var failures=rows.stream().map(row -> {
      String prior=previous.get(row.reference().objectId());
      var app=new ObjectQueryPort.Reference("easyv-ai-application", text(row,"appId"), current.productVersionIds().get("easyv-ai-application"));
      return new Failure(row.reference(),app,text(row,"failureReason"),text(row,"createdAt"),text(row,"finishedAt"),
          prior,FailureChange.classify(baseline!=null,prior));
    }).toList();
    Map<ObjectQueryPort.Reference,Long> counts=new HashMap<>();
    failures.forEach(failure -> counts.merge(failure.application(),1L,Long::sum));
    var repeated=counts.entrySet().stream().filter(entry -> entry.getValue()>1)
        .map(entry -> new RepeatedApplication(entry.getKey(),entry.getValue()))
        .sorted(Comparator.comparingLong(RepeatedApplication::failureCount).reversed().thenComparing(app -> app.reference().objectId())).toList();
    var summary=new Summary(failures.size(), count(failures,FailureChange.CHANGED_TO_FAILED),
        count(failures,FailureChange.FIRST_VISIBLE_FAILURE),count(failures,FailureChange.FAILED_IN_BOTH),
        count(failures,FailureChange.NO_BASELINE),repeated.size());
    return new Report(Version.of(current),baseline==null?null:Version.of(baseline),EasyVScopeResolver.dataScopeLabel(scope),summary,
        repeated.stream().limit(10).toList(),failures.stream().skip(offset).limit(PAGE_SIZE).toList(),
        offset,PAGE_SIZE,(long)offset+PAGE_SIZE<failures.size());
  }
  private static String text(ObjectQueryPort.Row row,String key) {
    Object value=row.properties().get(key); return value==null?null:value.toString();
  }
  private static long count(List<Failure> failures,FailureChange change) {
    return failures.stream().filter(failure -> failure.change()==change).count();
  }
}
