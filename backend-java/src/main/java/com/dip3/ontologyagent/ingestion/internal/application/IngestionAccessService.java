package com.dip3.ontologyagent.ingestion.internal.application;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class IngestionAccessService {
    private final IngestionAccessPort port;
    public IngestionAccessService(IngestionAccessPort port) { this.port = port; }
    public record Access(boolean canView, boolean canManage, List<String> sourceKeys, List<IngestionAccessPort.Grant> grants) {}
    public Access access(AuthSession actor) {
        boolean admin = actor.scope().roleCodes().contains("PLATFORM_ADMIN");
        var grants = port.grants(admin ? null : actor.scope().organizationId());
        return new Access(admin || !grants.isEmpty(), admin,
                grants.stream().map(IngestionAccessPort.Grant::sourceKey).distinct().toList(), admin ? grants : List.of());
    }
    public Access requireView(AuthSession actor) {
        var access = access(actor);
        if (!access.canView()) throw new BackendException("INGESTION_MANAGEMENT_FORBIDDEN", "当前组织尚未获得共享数据源查看权限。");
        return access;
    }
    public Access setGrant(String sourceKey, String organizationId, Boolean enabled, AuthSession actor) {
        IngestionManagementService.requireAdmin(actor);
        if (enabled == null || sourceKey == null || !sourceKey.matches("[a-z][a-z0-9_-]*") || organizationId == null
                || organizationId.isBlank() || organizationId.length() > 200 || !organizationId.equals(organizationId.trim())) {
            throw new BackendException("INGESTION_REQUEST_INVALID", "请选择数据源并填写有效组织 ID。");
        }
        port.setGrant(sourceKey, organizationId, enabled, actor);
        return access(actor);
    }
}
