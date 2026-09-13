package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;

@Service
public class IngestionManagementService {
    private final IngestionManagementPort port;
    private final IngestionAccessService access;

    public IngestionManagementService(IngestionManagementPort port, IngestionAccessService access) {
        this.port = port;
        this.access = access;
    }

    public IngestionManagementPort.Overview overview(AuthSession actor) {
        var permission = access.requireView(actor);
        var all = port.overview();
        if (permission.canManage()) return all;
        var sources = java.util.Set.copyOf(permission.sourceKeys());
        var datasets = all.datasets().stream().filter(d -> sources.contains(d.sourceKey())).toList();
        var datasetKeys = datasets.stream().map(IngestionManagementPort.Dataset::key).collect(java.util.stream.Collectors.toSet());
        var products = all.products().stream().filter(p -> !p.datasetKeys().isEmpty() && datasetKeys.containsAll(p.datasetKeys())).toList();
        var productKeys = products.stream().map(IngestionManagementPort.Product::key).collect(java.util.stream.Collectors.toSet());
        // Never return a partial version set: membership and historical lineage must both be authorized.
        return new IngestionManagementPort.Overview("organization", all.runLimit(), all.releaseLimit(),
                all.sources().stream().filter(s -> sources.contains(s.key())).toList(), datasets, products,
                all.runs().stream().filter(r -> ("source".equals(r.kind()) ? sources : productKeys).contains(r.targetKey())).toList(),
                all.releases().stream().filter(r -> !r.products().isEmpty() && r.products().stream().allMatch(p ->
                        productKeys.contains(p.key()) && !p.sources().isEmpty()
                        && p.sources().stream().allMatch(s -> datasetKeys.contains(s.datasetKey())))).toList());
    }

    static void requireAdmin(AuthSession actor) {
        // Publishing and access changes remain platform operations, regardless of view grants.
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("INGESTION_MANAGEMENT_FORBIDDEN", "数据接入管理仅向平台管理员开放。");
        }
    }
}
