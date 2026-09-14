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
        // 当前阶段查看不限制：所有已认证会话可见全部数据源、组织与血缘信息。
        // 发布/授权等写操作仍由 requireAdmin / setGrant 限定 PLATFORM_ADMIN；
        // 如需恢复组织级只读授权，回到按 source_view_grants 过滤 sourceKeys 的实现。
        return new Access(true, admin, port.sourceKeys(),
                admin ? port.grants(null) : List.of());
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
