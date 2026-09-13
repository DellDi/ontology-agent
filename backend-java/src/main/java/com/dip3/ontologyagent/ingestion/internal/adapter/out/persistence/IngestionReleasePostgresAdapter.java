package com.dip3.ontologyagent.ingestion.internal.adapter.out.persistence;

import com.dip3.ontologyagent.auth.AuthSession;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionPersistencePort;
import com.dip3.ontologyagent.ingestion.internal.application.IngestionReleasePort;
import com.dip3.ontologyagent.support.BackendException;
import com.dip3.ontologyagent.support.JsonCodec;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Consumer;

@Repository
public class IngestionReleasePostgresAdapter implements IngestionReleasePort {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final IngestionPersistencePort persistence;

    public IngestionReleasePostgresAdapter(JdbcTemplate jdbc, PlatformTransactionManager manager,
                                           IngestionPersistencePort persistence) {
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(manager);
        this.persistence = persistence;
    }

    @Override
    public Optional<Task> find(String id) {
        return jdbc.query("select * from ingestion.release_tasks where id=?", this::task, id).stream().findFirst();
    }

    @Override
    public List<Task> recent() {
        return jdbc.query("select * from ingestion.release_tasks order by created_at desc,id desc limit 50", this::task);
    }

    @Override
    public Task submit(String id, String sourceKey, List<String> products, String mode, String retryOf,
                       AuthSession actor, String traceId) {
        return transaction.execute(status -> {
            int inserted = jdbc.update("""
                    insert into ingestion.release_tasks
                    (id,source_key,product_keys,mode,retry_of,requested_by,organization_id,session_id,correlation_id)
                    values (?,?,?, ?,?,?,?,?,?) on conflict (id) do nothing
                    """, id, sourceKey, products.toArray(String[]::new), mode, retryOf,
                    actor.userId(), actor.scope().organizationId(), actor.sessionId(), traceId);
            Task existing = find(id).orElseThrow();
            boolean sameActor = Boolean.TRUE.equals(jdbc.queryForObject("""
                    select requested_by=? and organization_id=? from ingestion.release_tasks where id=?
                    """, Boolean.class, actor.userId(), actor.scope().organizationId(), id));
            if (!sameActor || !existing.sourceKey().equals(sourceKey) || !existing.productKeys().equals(products)
                    || !existing.mode().equals(mode) || !Objects.equals(existing.retryOf(), retryOf)) {
                throw new BackendException("INGESTION_RELEASE_CONFLICT", "此请求编号已用于其他发布，请刷新后重新提交。");
            }
            if (inserted == 1) audit(id, "submitted", "success");
            return existing;
        });
    }

    @Override
    public void withNext(Consumer<Task> work) {
        // A session lock serializes web publishers without holding a long database transaction.
        // The pinned connection must be direct/session-pooled PostgreSQL, not transaction pooling.
        try (Connection connection = Objects.requireNonNull(jdbc.getDataSource()).getConnection()) {
            if (!lock(connection, "pg_try_advisory_lock")) return;
            try {
                var next = jdbc.query("""
                        select * from ingestion.release_tasks where status in ('running','pending')
                        order by (status='running') desc,created_at,id limit 1
                        """, this::task);
                if (!next.isEmpty()) work.accept(next.getFirst());
            } finally {
                try {
                    if (!lock(connection, "pg_advisory_unlock")) {
                        throw new SQLException("ingestion worker lock was lost");
                    }
                } catch (SQLException failure) {
                    connection.abort(Runnable::run); // Never return a potentially locked session to the pool.
                    throw failure;
                }
            }
        } catch (SQLException error) {
            throw new BackendException("INGESTION_WORKER_FAILED", "发布任务数据库协调失败。", error);
        }
    }

    private static boolean lock(Connection connection, String function) throws SQLException {
        try (var statement = connection.createStatement();
             var result = statement.executeQuery("select " + function
                     + "(hashtextextended('ingestion:web-release-worker',0))")) {
            result.next();
            return result.getBoolean(1);
        }
    }

    @Override
    public void start(String id) {
        transaction.executeWithoutResult(status -> {
            changed(jdbc.update("""
                    update ingestion.release_tasks set status='running',started_at=now()
                    where id=? and status='pending'
                    """, id));
            audit(id, "started", "success");
        });
    }

    @Override
    public void finish(String id, String errorCode) {
        transaction.executeWithoutResult(status -> {
            changed(jdbc.update("""
                    update ingestion.release_tasks set status=?,error_code=?,finished_at=now()
                    where id=? and status='running'
                    """, errorCode == null ? "completed" : "failed", errorCode, id));
            audit(id, errorCode == null ? "completed" : "failed", errorCode == null ? "success" : "failure");
        });
    }

    @Override
    public void recover(String id, String errorCode) {
        var published = jdbc.queryForObject("""
                select exists(select 1 from ingestion.dataset_version_sets where set_id=? and status='frozen')
                """, Boolean.class, id);
        if (Boolean.TRUE.equals(published)) {
            finish(id, null);
            return;
        }
        for (String run : jdbc.queryForList("""
                select id from ingestion.source_ingestion_runs
                where correlation_id=? and status in ('pending','running')
                """, String.class, id)) {
            persistence.failSourceRun(run, errorCode, Map.of("releaseTaskId", id));
        }
        for (String run : jdbc.queryForList("""
                select id from ingestion.product_materialization_runs
                where correlation_id=? and status in ('pending','running')
                """, String.class, id)) {
            persistence.failProductRun(run, errorCode, Map.of("releaseTaskId", id));
        }
        finish(id, errorCode);
    }

    private void audit(String id, String action, String result) {
        changed(jdbc.update("""
                insert into platform.audit_events
                  (id,user_id,organization_id,session_id,event_type,event_result,event_source,
                   correlation_id,payload,created_at,retention_until)
                select ?,requested_by,organization_id,session_id,?,?,'ingestion-management',correlation_id,
                       jsonb_build_object('releaseTaskId',id,'sourceKey',source_key,'productKeys',product_keys,
                         'mode',mode,'retryOf',retry_of,'errorCode',error_code),now(),now()+interval '180 days'
                from ingestion.release_tasks where id=?
                """, UUID.randomUUID().toString(), "ingestion.release." + action, result, id));
    }

    private static void changed(int count) {
        if (count != 1) throw new BackendException("INGESTION_RELEASE_CONFLICT", "发布任务状态发生冲突。");
    }

    private Task task(ResultSet rs, int index) throws SQLException {
        return new Task(rs.getString("id"), rs.getString("source_key"), JsonCodec.strings(rs.getArray("product_keys")),
                rs.getString("mode"), rs.getString("status"), rs.getString("retry_of"), rs.getString("requested_by"),
                rs.getString("correlation_id"), rs.getString("error_code"), instant(rs, "created_at"),
                instant(rs, "started_at"), instant(rs, "finished_at"));
    }

    private static Instant instant(ResultSet rs, String field) throws SQLException {
        var value = rs.getTimestamp(field);
        return value == null ? null : value.toInstant();
    }
}
