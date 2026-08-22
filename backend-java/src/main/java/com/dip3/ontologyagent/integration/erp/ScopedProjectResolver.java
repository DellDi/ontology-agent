package com.dip3.ontologyagent.integration.erp;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
public final class ScopedProjectResolver {
    private final ErpEvidenceMapper mapper;

    public ScopedProjectResolver(ErpEvidenceMapper mapper) {
        this.mapper = mapper;
    }

    public List<String> resolve(AuthSession owner) {
        return resolve(owner, List.of());
    }

    public List<String> resolve(AuthSession owner, List<String> requestedProjectIds) {
        List<String> allowed = allowed(owner);
        LinkedHashSet<String> requested = new LinkedHashSet<>(requestedProjectIds == null
                ? List.of() : requestedProjectIds);
        if (requested.stream().anyMatch(id -> id == null || id.isBlank()) || !allowed.containsAll(requested)) {
            throw new BackendException("ANALYSIS_PROJECT_SCOPE_DENIED", "Workflow 请求的项目超出授权范围。");
        }
        List<String> resolved = requested.isEmpty() ? allowed : List.copyOf(requested);
        if (resolved.size() > 100) {
            throw new BackendException("ANALYSIS_SCOPE_LIMIT_EXCEEDED", "首次分析最多支持 100 个项目，禁止截断取样。");
        }
        return resolved;
    }

    public List<ScopedProjectTarget> targets(AuthSession owner) {
        List<String> ids = resolve(owner);
        Map<String, ScopedProjectTarget> targets = mapper.projectTargets(ids.toArray(String[]::new)).stream()
                .collect(Collectors.toMap(ScopedProjectTarget::id, Function.identity()));
        if (targets.size() != ids.size()) {
            throw new BackendException("ERP_SCOPE_RESOLUTION_INCOMPLETE",
                    "授权项目中存在已删除或无法解析名称的项目，禁止交给 Agent 猜测。");
        }
        return ids.stream().map(targets::get).toList();
    }

    private List<String> allowed(AuthSession owner) {
        LinkedHashSet<String> projects = new LinkedHashSet<>(owner.scope().projectIds());
        if (owner.scope().areaIds().isEmpty()) {
            if (!projects.isEmpty()) return List.copyOf(projects);
            throw new BackendException("ACCESS_SCOPE_EMPTY", "当前执行没有可查询的项目或区域范围。");
        }
        List<String> areaProjects = mapper.projectIdsByAreas(owner.scope().organizationId(),
                owner.scope().areaIds().toArray(String[]::new));
        if (areaProjects.isEmpty()) {
            throw new BackendException("ERP_SCOPE_RESOLUTION_EMPTY", "当前区域范围未解析到可查询项目。");
        }
        projects.addAll(areaProjects);
        return List.copyOf(projects);
    }
}
