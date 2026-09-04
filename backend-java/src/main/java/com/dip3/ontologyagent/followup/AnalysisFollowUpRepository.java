package com.dip3.ontologyagent.followup;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.dip3.ontologyagent.execution.ExecutionSnapshotEntity;
import com.dip3.ontologyagent.execution.ExecutionSnapshotMapper;
import com.dip3.ontologyagent.support.BackendException;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Repository
public class AnalysisFollowUpRepository {
    private final AnalysisFollowUpMapper followUps;
    private final ExecutionSnapshotMapper snapshots;

    public AnalysisFollowUpRepository(AnalysisFollowUpMapper followUps, ExecutionSnapshotMapper snapshots) {
        this.followUps = followUps;
        this.snapshots = snapshots;
    }

    public AnalysisFollowUp create(AnalysisFollowUp followUp) {
        AnalysisFollowUpEntity row = entity(followUp);
        if (followUps.insert(row) != 1) {
            throw new BackendException("FOLLOW_UP_CREATE_FAILED", "追问写入失败。");
        }
        return model(row);
    }

    public Optional<AnalysisFollowUp> findOwned(String followUpId, String ownerUserId) {
        AnalysisFollowUpEntity row = followUps.selectById(followUpId);
        return row == null || !ownerUserId.equals(row.ownerUserId) ? Optional.empty() : Optional.of(model(row));
    }

    public Optional<AnalysisFollowUp> lockOwned(String followUpId, String sessionId, String ownerUserId) {
        return followUps.selectList(new QueryWrapper<AnalysisFollowUpEntity>()
                        .eq("id", followUpId).eq("session_id", sessionId).eq("owner_user_id", ownerUserId)
                        .last("for update"))
                .stream().findFirst().map(AnalysisFollowUpRepository::model);
    }

    public List<AnalysisFollowUp> listOwned(String sessionId, String ownerUserId) {
        return followUps.selectList(new QueryWrapper<AnalysisFollowUpEntity>()
                        .eq("session_id", sessionId).eq("owner_user_id", ownerUserId)
                        .orderByAsc("created_order"))
                .stream().map(AnalysisFollowUpRepository::model).toList();
    }

    public AnalysisFollowUp replace(AnalysisFollowUp previous, AnalysisFollowUp next) {
        AnalysisFollowUpEntity row = entity(next);
        int changed = followUps.replace(row, previous.updatedAt());
        if (changed != 1) {
            throw new BackendException("FOLLOW_UP_STATE_CONFLICT", "追问已被其他请求更新，请刷新后重试。");
        }
        return next;
    }

    public Optional<ExecutionSnapshotEntity> latestCompletedRootSnapshot(String sessionId, String ownerUserId) {
        return snapshots.selectList(new QueryWrapper<ExecutionSnapshotEntity>()
                        .eq("session_id", sessionId).eq("owner_user_id", ownerUserId)
                        .eq("status", "completed").isNull("follow_up_id")
                        .apply("plan_snapshot->>'_executionContract' = {0}", "java-initial-v1")
                        .orderByDesc("updated_at").orderByDesc("execution_id").last("limit 1"))
                .stream().findFirst();
    }

    public Optional<ExecutionSnapshotEntity> completedFollowUpSnapshot(String executionId, String sessionId,
                                                                        String ownerUserId, String followUpId) {
        ExecutionSnapshotEntity row = snapshots.selectById(executionId);
        return row != null && sessionId.equals(row.sessionId) && ownerUserId.equals(row.ownerUserId)
                && followUpId.equals(row.followUpId) && "completed".equals(row.status)
                && row.planSnapshot != null
                && "java-follow-up-v1".equals(row.planSnapshot.get("_executionContract"))
                ? Optional.of(row) : Optional.empty();
    }

    public Optional<ExecutionSnapshotEntity> completedSourceSnapshot(AnalysisFollowUp followUp) {
        ExecutionSnapshotEntity row = snapshots.selectById(followUp.referencedExecutionId());
        String expectedContract = followUp.parentFollowUpId() == null ? "java-initial-v1" : "java-follow-up-v1";
        boolean expectedRound = followUp.parentFollowUpId() == null ? row != null && row.followUpId == null
                : row != null && followUp.parentFollowUpId().equals(row.followUpId);
        return row != null && followUp.sessionId().equals(row.sessionId)
                && followUp.ownerUserId().equals(row.ownerUserId) && "completed".equals(row.status)
                && expectedRound && row.planSnapshot != null
                && expectedContract.equals(row.planSnapshot.get("_executionContract"))
                ? Optional.of(row) : Optional.empty();
    }

    private static AnalysisFollowUpEntity entity(AnalysisFollowUp source) {
        AnalysisFollowUpEntity row = new AnalysisFollowUpEntity();
        row.id = source.id();
        row.sessionId = source.sessionId();
        row.ownerUserId = source.ownerUserId();
        row.questionText = source.questionText();
        row.parentFollowUpId = source.parentFollowUpId();
        row.referencedExecutionId = source.referencedExecutionId();
        row.referencedConclusionTitle = source.referencedConclusionTitle();
        row.referencedConclusionSummary = source.referencedConclusionSummary();
        row.resultExecutionId = source.resultExecutionId();
        row.ontologyVersionId = source.ontologyVersionId();
        row.ontologyVersionBindingSource = text(source.ontologyVersionBinding().get("source"));
        row.capabilityBinding = source.capabilityBinding();
        row.inheritedContext = source.inheritedContext();
        row.mergedContext = source.mergedContext();
        row.planVersion = source.planVersion();
        row.currentPlanSnapshot = source.currentPlanSnapshot();
        row.previousPlanSnapshot = source.previousPlanSnapshot();
        row.currentPlanDiff = source.currentPlanDiff();
        row.createdAt = source.createdAt();
        row.updatedAt = source.updatedAt();
        return row;
    }

    private static AnalysisFollowUp model(AnalysisFollowUpEntity row) {
        Map<String, Object> binding = new LinkedHashMap<>();
        binding.put("ontologyVersionId", row.ontologyVersionId);
        binding.put("source", row.ontologyVersionBindingSource);
        return new AnalysisFollowUp(row.id, row.sessionId, row.ownerUserId, row.questionText,
                row.parentFollowUpId, row.referencedExecutionId, row.referencedConclusionTitle,
                row.referencedConclusionSummary, row.resultExecutionId, row.ontologyVersionId, binding,
                row.capabilityBinding, row.inheritedContext, row.mergedContext, row.planVersion, row.currentPlanSnapshot,
                row.previousPlanSnapshot, row.currentPlanDiff, row.createdAt, row.updatedAt);
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }
}
