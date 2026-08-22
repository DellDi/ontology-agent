package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class GraphSyncIncrementalRepository {
    private final GraphSyncIncrementalMapper mapper;

    public GraphSyncIncrementalRepository(GraphSyncIncrementalMapper mapper) { this.mapper = mapper; }

    @Transactional
    public <T> T withSourceLock(String sourceName, java.util.function.Supplier<T> action) {
        if (!mapper.tryLockSource(sourceName)) {
            throw new BackendException("GRAPH_SYNC_SOURCE_CONFLICT", "该来源已有增量任务正在执行。 ");
        }
        return action.get();
    }

    @Transactional
    public void assertSourceAvailable(String sourceName) {
        if (!mapper.tryLockSource(sourceName)) {
            throw new BackendException("GRAPH_SYNC_SOURCE_CONFLICT", "该来源已有增量任务正在执行。 ");
        }
    }

    public Optional<GraphSyncCursor> cursor(String sourceName) {
        return Optional.ofNullable(mapper.cursor(sourceName));
    }

    @Transactional
    public void record(GraphSyncSource source, GraphSyncChange change) {
        Instant now = Instant.now();
        mapper.lockScope(change.organizationId());
        Map<String, Object> progress = Map.of(source.sourceName(), Map.of(
                "cursorTime", change.cursorTime().toString(), "cursorPk", change.sourcePk(),
                "sourcePk", change.sourcePk(), "reason", source.reason()));
        GraphSyncDirtyScope pending = mapper.pendingForScope(change.organizationId());
        if (pending == null) {
            GraphSyncDirtyScope created = new GraphSyncDirtyScope(UUID.randomUUID().toString(), "organization",
                    change.organizationId(), source.reason(), source.sourceName(), change.sourcePk(), progress,
                    now, now, "pending", 0, null, null);
            if (mapper.insertDirty(created) != 1) stateConflict();
        } else if (mapper.mergeDirty(pending.id(), source.reason(), source.sourceName(), change.sourcePk(),
                progress, now) != 1) {
            stateConflict();
        }
    }

    public List<GraphSyncDirtyScope> pending(String sourceName) { return mapper.pending(sourceName, 3); }

    @Transactional
    public void claim(String id, String sourceRunId) {
        if (mapper.claim(id, sourceRunId, Instant.now()) != 1) stateConflict();
    }
    @Transactional
    public void completed(String id, String runId) {
        if (mapper.completeDirty(id, runId) != 1) stateConflict();
    }
    @Transactional
    public void failed(String id, String runId, String error) {
        if (mapper.failDirty(id, runId, error) != 1) stateConflict();
    }
    @Transactional
    public void advance(String sourceName, GraphSyncChange target, String runId) {
        if (mapper.saveCursor(sourceName, target.cursorTime(), target.sourcePk(), runId, Instant.now()) != 1) {
            stateConflict();
        }
    }
    public List<GraphSyncCursor> cursors() { return mapper.cursors(); }
    public List<GraphSyncDirtyScope> failures(int limit) { return mapper.failures(limit); }
    public List<GraphSyncDirtyScope> failures(String organizationId, int limit) {
        return mapper.scopedFailures(organizationId, limit);
    }
    @Transactional
    public int requeueRetryable(String sourceName, int maxAttempts) {
        mapper.recoverProcessing(sourceName, Instant.now().minus(GraphSyncRunRepository.STALE_AFTER));
        int count = 0;
        for (GraphSyncDirtyScope scope : mapper.retryable(sourceName, maxAttempts)) {
            count += mapper.retryDirty(scope.id(), maxAttempts);
        }
        return count;
    }
    public List<String> organizationIds(int limit) { return mapper.organizationIds(limit); }

    public Map<String, Integer> backlog() {
        return counts(mapper.backlog());
    }

    public Map<String, Integer> backlog(String organizationId) {
        return counts(mapper.scopedBacklog(organizationId));
    }

    private static Map<String, Integer> counts(List<Map<String, Object>> rows) {
        Map<String, Integer> counts = new LinkedHashMap<>(Map.of(
                "pending", 0, "processing", 0, "completed", 0, "failed", 0));
        for (Map<String, Object> row : rows) {
            counts.put(row.get("status").toString(), ((Number) row.get("count")).intValue());
        }
        return counts;
    }

    private static void stateConflict() {
        throw new BackendException("GRAPH_SYNC_STATE_CONFLICT", "Graph Sync 状态已被其他任务修改。 ");
    }
}
