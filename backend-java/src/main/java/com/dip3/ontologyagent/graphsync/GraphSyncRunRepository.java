package com.dip3.ontologyagent.graphsync;

import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.Duration;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Optional;

@Repository
public class GraphSyncRunRepository {
    static final Duration STALE_AFTER = Duration.ofMinutes(30);
    private final GraphSyncRunMapper mapper;

    public GraphSyncRunRepository(GraphSyncRunMapper mapper) { this.mapper = mapper; }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public GraphSyncRun createLocked(String runId, String organizationId, String userId) {
        return createLocked(runId, organizationId, userId, "org-rebuild", "manual", Map.of());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public GraphSyncRun createLocked(String runId, String organizationId, String triggeredBy, String mode,
                                     String triggerType, Map<String, Object> cursorSnapshot) {
        if (!mapper.tryLockOrganization(organizationId)) {
            throw new BackendException("GRAPH_SYNC_CONFLICT", "该组织已有图谱重建正在提交。 ");
        }
        recoverStale("organization", organizationId);
        GraphSyncRun active = mapper.latest(organizationId);
        if (active != null && ("pending".equals(active.status()) || "running".equals(active.status()))) {
            throw new BackendException("GRAPH_SYNC_CONFLICT", "该组织已有图谱重建正在执行。 ");
        }
        Instant now = Instant.now();
        Map<String, Object> fencedSnapshot = fenced(cursorSnapshot);
        GraphSyncRun run = new GraphSyncRun(runId, mode, "pending", "organization",
                organizationId, triggerType, triggeredBy, fencedSnapshot, 0, 0, null, null,
                null, null, now, now);
        if (mapper.insert(run) != 1) throw new BackendException("GRAPH_SYNC_CREATE_FAILED", "图谱同步记录创建失败。 ");
        return run;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void running(String runId) {
        Instant now = Instant.now();
        requireTransition(mapper.transition(runId, "pending", "running", 0, 0, null, null,
                now, null, now));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void completed(String runId, GraphWriter.WriteResult result) {
        Instant now = Instant.now();
        requireTransition(mapper.transition(runId, "running", "completed", result.nodesWritten(),
                result.edgesWritten(), null, Map.of("nodesDeleted", result.nodesDeleted(),
                        "edgesDeleted", result.edgesDeleted()), null, now, now));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void failed(String runId, boolean partial, String code, String message) {
        Instant now = Instant.now();
        requireTransition(mapper.fail(runId, partial ? "partial" : "failed", message,
                Map.of("code", code, "partialWrite", partial), now));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void heartbeat(String runId) { requireTransition(mapper.heartbeat(runId, Instant.now())); }

    public Optional<GraphSyncRun> latest(String organizationId) {
        return Optional.ofNullable(mapper.latest(organizationId));
    }

    public Optional<GraphSyncRun> latestAny() { return Optional.ofNullable(mapper.latestAny()); }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public GraphSyncRun createSourceLocked(String runId, String sourceName, String triggeredBy) {
        if (!mapper.tryLockBootstrap()) {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_CONFLICT", "全量图谱初始化正在提交。 ");
        }
        recoverStale("all", "all");
        if (mapper.activeBootstrapCount() != 0) {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_CONFLICT", "全量图谱初始化正在执行。 ");
        }
        if (!mapper.tryLockOrganization("source:" + sourceName)) {
            throw new BackendException("GRAPH_SYNC_SOURCE_CONFLICT", "该来源已有增量任务正在提交。 ");
        }
        recoverStale("all", sourceName);
        GraphSyncRun active = mapper.latestScope("all", sourceName);
        if (active != null && ("pending".equals(active.status()) || "running".equals(active.status()))) {
            throw new BackendException("GRAPH_SYNC_SOURCE_CONFLICT", "该来源已有增量任务正在执行。 ");
        }
        Instant now = Instant.now();
        GraphSyncRun run = new GraphSyncRun(runId, "incremental-scan", "pending", "all", sourceName,
                "scheduler", triggeredBy, fenced(Map.of()), 0, 0, null, null, null, null, now, now);
        if (mapper.insert(run) != 1) {
            throw new BackendException("GRAPH_SYNC_CREATE_FAILED", "图谱同步记录创建失败。 ");
        }
        return run;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public GraphSyncRun createBootstrapLocked(String runId, String triggeredBy,
                                               Map<String, Object> cursorSnapshot) {
        if (!mapper.tryLockBootstrap()) {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_CONFLICT", "全量图谱初始化正在提交。 ");
        }
        recoverStale("all", "all");
        if (mapper.activeBootstrapCount() != 0) {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_CONFLICT", "全量图谱初始化正在执行。 ");
        }
        for (String sourceName : GraphSyncSource.names()) recoverStale("all", sourceName);
        if (mapper.activeIncrementalCount() != 0) {
            throw new BackendException("GRAPH_SYNC_BOOTSTRAP_CONFLICT", "增量扫描正在执行，不能启动全量初始化。 ");
        }
        Instant now = Instant.now();
        GraphSyncRun run = new GraphSyncRun(runId, "full-bootstrap", "pending", "all", "all", "system",
                triggeredBy, fenced(cursorSnapshot), 0, 0, null, null, null, null, now, now);
        if (mapper.insert(run) != 1) {
            throw new BackendException("GRAPH_SYNC_CREATE_FAILED", "图谱同步记录创建失败。 ");
        }
        return run;
    }

    public Optional<GraphSyncRun> latestBootstrap() {
        return Optional.ofNullable(mapper.latestScope("all", "all"));
    }

    private static void requireTransition(int changed) {
        if (changed != 1) throw new BackendException("GRAPH_SYNC_STATE_CONFLICT", "图谱同步状态已被其他请求修改。 ");
    }

    private void recoverStale(String scopeType, String scopeKey) {
        Instant now = Instant.now();
        mapper.recoverStale(scopeType, scopeKey, now.minus(STALE_AFTER), now);
    }

    private Map<String, Object> fenced(Map<String, Object> snapshot) {
        Map<String, Object> value = new LinkedHashMap<>(snapshot);
        value.put("fencingToken", mapper.currentFencingToken());
        return value;
    }
}
