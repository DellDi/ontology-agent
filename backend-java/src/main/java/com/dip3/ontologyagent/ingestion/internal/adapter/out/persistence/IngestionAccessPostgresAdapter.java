package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionAccessPort;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.UUID;

@Repository
public class IngestionAccessPostgresAdapter implements IngestionAccessPort {
    private final JdbcTemplate jdbc;
    public IngestionAccessPostgresAdapter(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    @Override
    public List<Grant> grants(String organizationId) {
        return jdbc.query("select source_key, organization_id, granted_by, granted_at from ingestion.source_view_grants "
                        + (organizationId == null ? "" : "where organization_id=? ") + "order by source_key, organization_id",
                (rs, n) -> new Grant(rs.getString(1), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toInstant()),
                organizationId == null ? new Object[0] : new Object[]{organizationId});
    }
    @Override
    @Transactional
    public void setGrant(String sourceKey, String organizationId, boolean enabled, AuthSession actor) {
        if (jdbc.queryForObject("select count(*) from ingestion.source_definitions where source_key=?", Integer.class, sourceKey) != 1)
            throw new BackendException("INGESTION_REQUEST_INVALID", "数据源不存在。");
        int changed = enabled ? jdbc.update("""
                insert into ingestion.source_view_grants(source_key,organization_id,granted_by)
                values(?,?,?) on conflict do nothing
                """, sourceKey, organizationId, actor.userId()) : jdbc.update(
                "delete from ingestion.source_view_grants where source_key=? and organization_id=?", sourceKey, organizationId);
        if (changed > 0) jdbc.update("""
                insert into platform.audit_events
                (id,user_id,organization_id,session_id,event_type,event_result,event_source,correlation_id,payload,created_at,retention_until)
                values(?,?,?,?,'ingestion.access.changed','success','ingestion-management',?,
                  jsonb_build_object('sourceKey',cast(? as text),'targetOrganizationId',cast(? as text),'enabled',cast(? as boolean)),
                  now(),now()+interval '180 days')
                """, UUID.randomUUID().toString(), actor.userId(), actor.scope().organizationId(), actor.sessionId(),
                UUID.randomUUID().toString(), sourceKey, organizationId, enabled);
    }
}
