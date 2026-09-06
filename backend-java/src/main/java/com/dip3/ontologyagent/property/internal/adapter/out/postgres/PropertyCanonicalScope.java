package com.dip3.ontologyagent.property.internal.adapter.out.postgres;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSet;
import com.dip3.ontologyagent.ingestion.api.DatasetVersionSetRegistry;
import com.dip3.ontologyagent.property.internal.application.PropertyDataProducts;
import com.dip3.ontologyagent.property.internal.domain.WorkflowRequest;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.tooling.Evidence;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Resolves an execution-pinned Property product set and its authorized canonical projects. */
@Component
public final class PropertyCanonicalScope {
  private final JdbcTemplate jdbc;
  private final DatasetVersionSetRegistry versionSets;
  private final TransactionTemplate readOnly;

  public PropertyCanonicalScope(JdbcTemplate jdbc, DatasetVersionSetRegistry versionSets,
                                PlatformTransactionManager transactionManager) {
    this.jdbc = jdbc;
    this.versionSets = versionSets;
    this.readOnly = new TransactionTemplate(transactionManager);
    this.readOnly.setReadOnly(true);
    this.readOnly.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
  }

  public Resolved resolve(AuthSession owner, WorkflowRequest request) {
    if (request.datasetVersionSetId() == null) {
      throw new BackendException("DATASET_VERSION_SET_MISSING", "物业分析未绑定 canonical 数据版本集合。");
    }
    DatasetVersionSet set = versionSets.requireFrozen(
        request.datasetVersionSetId(), PropertyDataProducts.REQUIRED);
    Resolved resolved = readOnly.execute(status -> resolveReadOnly(owner, request, set));
    if (resolved == null) {
      throw new BackendException("PROPERTY_SCOPE_RESOLUTION_EMPTY", "物业 canonical 项目范围解析失败。");
    }
    return resolved;
  }

  private Resolved resolveReadOnly(AuthSession owner, WorkflowRequest request, DatasetVersionSet set) {
    Boolean transactionReadOnly = jdbc.queryForObject(
        "select current_setting('transaction_read_only')='on'", Boolean.class);
    if (!Boolean.TRUE.equals(transactionReadOnly)) {
      throw new BackendException("PROPERTY_READ_ONLY_TRANSACTION_REQUIRED",
          "物业 canonical facts 读取未处于 PostgreSQL READ ONLY 事务。");
    }

    Map<String, String> versions = set.productVersionIds();
    LinkedHashSet<String> allowed = new LinkedHashSet<>(owner.scope().projectIds());
    if (!owner.scope().areaIds().isEmpty()) {
      allowed.addAll(projectsForAreas(owner, versions, owner.scope().areaIds()));
    }
    if (allowed.isEmpty()) {
      throw new BackendException("ACCESS_SCOPE_EMPTY", "当前执行没有可查询的项目或区域范围。");
    }

    LinkedHashSet<String> requested = new LinkedHashSet<>(request.projectIds() == null
        ? List.of() : request.projectIds());
    if (requested.stream().anyMatch(id -> id == null || id.isBlank())
        || !allowed.containsAll(requested)) {
      throw new BackendException("ANALYSIS_PROJECT_SCOPE_DENIED", "Workflow 请求的项目超出授权范围。");
    }
    List<String> selected = requested.isEmpty() ? List.copyOf(allowed) : List.copyOf(requested);
    if (selected.size() > 100) {
      throw new BackendException("ANALYSIS_SCOPE_LIMIT_EXCEEDED", "首次分析最多支持 100 个项目，禁止截断取样。");
    }
    assertProjectsExist(versions.get(PropertyDataProducts.PROJECT), selected);
    return new Resolved(set.publicationId(), versions, selected, set.capturedAt());
  }

  private List<String> projectsForAreas(AuthSession owner, Map<String, String> versions,
                                        List<String> areaIds) {
    List<Object> arguments = new ArrayList<>();
    arguments.add(versions.get(PropertyDataProducts.PROJECT));
    arguments.addAll(areaIds);
    arguments.add(owner.scope().organizationId());
    arguments.add(versions.get(PropertyDataProducts.ORGANIZATION));
    arguments.add(owner.scope().organizationId());
    arguments.add(owner.scope().organizationId());
    String sql = """
        select p.project_id
        from facts.property_project p
        where p.product_version_id=? and not p.is_deleted and not p.delete_flag
          and p.area_id in (%s)
          and (p.organization_id=? or exists (
            select 1 from facts.property_organization o
            where o.product_version_id=? and not o.is_deleted
              and o.organization_id::text=p.organization_id
              and (o.organization_id::text=?
                   or strpos(coalesce(o.organization_path,''), '/' || ? || '/') > 0)))
        order by p.project_id
        """.formatted(placeholders(areaIds.size()));
    return jdbc.queryForList(sql, String.class, arguments.toArray());
  }

  private void assertProjectsExist(String projectVersionId, List<String> projectIds) {
    List<Object> arguments = new ArrayList<>();
    arguments.add(projectVersionId);
    arguments.addAll(projectIds);
    Integer count = jdbc.queryForObject("""
        select count(*) from facts.property_project
        where product_version_id=? and not is_deleted and not delete_flag
          and project_id in (%s)
        """.formatted(placeholders(projectIds.size())), Integer.class, arguments.toArray());
    if (count == null || count != projectIds.size()) {
      throw new BackendException("PROPERTY_SCOPE_RESOLUTION_INCOMPLETE",
          "授权项目在绑定的 canonical 版本中不存在或已删除。");
    }
  }

  private static String placeholders(int count) {
    if (count <= 0) throw new IllegalArgumentException("placeholder count must be positive");
    return String.join(",", java.util.Collections.nCopies(count, "?"));
  }

  public record Resolved(String datasetVersionSetId, Map<String, String> productVersionIds,
                         List<String> projectIds, Instant capturedAt) {
    public Resolved {
      productVersionIds = Map.copyOf(productVersionIds);
      projectIds = List.copyOf(projectIds);
      if (capturedAt == null) {
        throw new IllegalArgumentException("capturedAt must not be null");
      }
    }

    public String version(String productKey) {
      String version = productVersionIds.get(productKey);
      if (version == null) {
        throw new BackendException("DATASET_VERSION_SET_INCOMPLETE",
            "物业数据版本集合缺少产品: " + productKey);
      }
      return version;
    }

    public Evidence.Provenance provenance(String ontologyVersionId, String... productKeys) {
      Map<String, String> versions = new LinkedHashMap<>();
      for (String productKey : productKeys) {
        versions.put(productKey, version(productKey));
      }
      return new Evidence.Provenance(ontologyVersionId, datasetVersionSetId, capturedAt, versions);
    }
  }
}
