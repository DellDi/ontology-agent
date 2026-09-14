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
        access.requireView(actor);
        return port.overview();
    }

    static void requireAdmin(AuthSession actor) {
        // Publishing and access changes remain platform operations, regardless of view grants.
        if (!actor.scope().roleCodes().contains("PLATFORM_ADMIN")) {
            throw new BackendException("INGESTION_MANAGEMENT_FORBIDDEN", "数据接入管理仅向平台管理员开放。");
        }
    }
}
