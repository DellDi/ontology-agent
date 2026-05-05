import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisHistoryRoundReadModel } from '@/application/analysis-history/use-cases';
import {
  type AnalysisExecutionPlanSnapshot,
  validateAnalysisExecutionJobData,
} from '@/domain/analysis-execution/models';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisUiMessageProjectionStreamCursor } from '@/domain/analysis-message-projection/models';
import {
  buildAnalysisConclusionReadModel,
  type AnalysisConclusionReadModel,
} from '@/domain/analysis-result/models';
import type { Job } from '@/domain/job-contract/models';

export type SessionScopedExecutionJob = {
  executionId: string;
  status: Job['status'];
  submittedAt: string;
  planSnapshot: AnalysisExecutionPlanSnapshot;
};

export function buildExecutionStreamReadModelFromSnapshot(
  snapshot: Pick<
    AnalysisExecutionSnapshot,
    'sessionId' | 'executionId' | 'status' | 'stepResults'
  >,
): AnalysisExecutionStreamReadModel {
  return {
    sessionId: snapshot.sessionId,
    executionId: snapshot.executionId,
    currentStatus: snapshot.status,
    hasEvents: snapshot.stepResults.length > 0,
    events: snapshot.stepResults,
  };
}

export function getSessionScopedExecutionSnapshot(
  snapshot: AnalysisExecutionSnapshot | null,
  sessionId: string,
): AnalysisExecutionSnapshot | null {
  if (!snapshot || snapshot.sessionId !== sessionId) {
    return null;
  }

  return snapshot;
}

export function getSessionScopedExecutionJob(
  job: Job | null,
  input: {
    sessionId: string;
    ownerUserId: string;
  },
): SessionScopedExecutionJob | null {
  if (!job || job.type !== 'analysis-execution') {
    return null;
  }

  try {
    const jobData = validateAnalysisExecutionJobData(job.data);

    if (
      jobData.sessionId !== input.sessionId ||
      jobData.ownerUserId !== input.ownerUserId
    ) {
      return null;
    }

    return {
      executionId: job.id,
      status: job.status,
      submittedAt: jobData.submittedAt,
      planSnapshot: jobData.plan,
    };
  } catch {
    return null;
  }
}

export function mergeExecutionEvents(
  previousEvents: AnalysisExecutionStreamEvent[],
  nextEvent: AnalysisExecutionStreamEvent,
) {
  if (previousEvents.some((event) => event.id === nextEvent.id)) {
    return previousEvents;
  }

  return [...previousEvents, nextEvent].sort(
    (left, right) => left.sequence - right.sequence,
  );
}

export function buildLiveConclusionReadModel({
  events,
  fallbackReadModel,
}: {
  events: AnalysisExecutionStreamEvent[];
  fallbackReadModel: AnalysisConclusionReadModel | null;
}): AnalysisConclusionReadModel | null {
  const derivedReadModel = buildAnalysisConclusionReadModel(events);

  if (derivedReadModel.causes.length > 0) {
    return derivedReadModel;
  }

  return fallbackReadModel;
}

export function resolvePlanSnapshotForDisplay(input: {
  sessionScopedRequestedExecutionSnapshot: AnalysisExecutionSnapshot | null;
  requestedExecutionJob: SessionScopedExecutionJob | null;
  activeFollowUpPlanSnapshot?: AnalysisExecutionPlanSnapshot | null;
  snapshotForDisplay: AnalysisExecutionSnapshot | null;
  isHistoryReplay: boolean;
}): AnalysisExecutionPlanSnapshot | null {
  if (input.sessionScopedRequestedExecutionSnapshot) {
    return input.sessionScopedRequestedExecutionSnapshot.planSnapshot;
  }

  if (input.requestedExecutionJob) {
    return input.requestedExecutionJob.planSnapshot;
  }

  if (input.isHistoryReplay) {
    return input.snapshotForDisplay?.planSnapshot ?? null;
  }

  return (
    input.activeFollowUpPlanSnapshot ??
    input.snapshotForDisplay?.planSnapshot ??
    null
  );
}

type ProjectionDisplaySnapshot = Pick<
  AnalysisExecutionSnapshot,
  'executionId' | 'followUpId'
>;

type ProjectionDisplayHistoryRound = Pick<
  AnalysisHistoryRoundReadModel,
  'id' | 'executionId' | 'followUpId' | 'isLatest'
>;

export type ExecutionProjectionDisplaySelection = {
  snapshotForDisplay: AnalysisExecutionSnapshot | null;
  resolvedExecutionId: string;
  followUpIdForProjection: string | null;
  historyRoundIdForProjection: string | null;
  enableLiveStream: boolean;
  isHistoryReplay: boolean;
};

function resolveRoundIdFromSnapshot(
  snapshot: ProjectionDisplaySnapshot | null,
) {
  return snapshot?.followUpId ?? 'session-root';
}

export function resolveExecutionProjectionDisplaySelection(input: {
  requestedExecutionIdForDisplay: string;
  sessionScopedRequestedExecutionSnapshot: AnalysisExecutionSnapshot | null;
  latestExecutionSnapshot: AnalysisExecutionSnapshot | null;
  sessionSnapshots: AnalysisExecutionSnapshot[];
  selectedHistoryRound: ProjectionDisplayHistoryRound | null;
}): ExecutionProjectionDisplaySelection {
  if (input.selectedHistoryRound?.executionId) {
    const historySnapshot =
      input.sessionSnapshots.find(
        (snapshot) =>
          snapshot.executionId === input.selectedHistoryRound?.executionId,
      ) ?? null;

    return {
      snapshotForDisplay: historySnapshot,
      resolvedExecutionId: input.selectedHistoryRound.executionId,
      followUpIdForProjection: input.selectedHistoryRound.followUpId,
      historyRoundIdForProjection: input.selectedHistoryRound.id,
      enableLiveStream: false,
      isHistoryReplay: true,
    };
  }

  if (input.requestedExecutionIdForDisplay) {
    const requestedSnapshot = input.sessionScopedRequestedExecutionSnapshot;
    return {
      snapshotForDisplay: requestedSnapshot,
      resolvedExecutionId: input.requestedExecutionIdForDisplay,
      followUpIdForProjection: requestedSnapshot?.followUpId ?? null,
      historyRoundIdForProjection: resolveRoundIdFromSnapshot(requestedSnapshot),
      enableLiveStream: true,
      isHistoryReplay: false,
    };
  }

  return {
    snapshotForDisplay: input.latestExecutionSnapshot,
    resolvedExecutionId: input.latestExecutionSnapshot?.executionId ?? '',
    followUpIdForProjection: input.latestExecutionSnapshot?.followUpId ?? null,
    historyRoundIdForProjection: resolveRoundIdFromSnapshot(
      input.latestExecutionSnapshot,
    ),
    enableLiveStream: true,
    isHistoryReplay: false,
  };
}

export function buildAnalysisExecutionStreamUrl(input: {
  sessionId: string;
  executionId: string;
  resumeCursor?: AnalysisUiMessageProjectionStreamCursor | null;
}) {
  const params = new URLSearchParams({
    executionId: input.executionId,
  });

  if (input.resumeCursor && input.resumeCursor.lastSequence > 0) {
    params.set('afterSequence', String(input.resumeCursor.lastSequence));
  }

  return `/api/analysis/sessions/${encodeURIComponent(input.sessionId)}/stream?${params.toString()}`;
}

const analysisExecutionDisplayModule = {
  buildExecutionStreamReadModelFromSnapshot,
  getSessionScopedExecutionSnapshot,
  getSessionScopedExecutionJob,
  mergeExecutionEvents,
  buildLiveConclusionReadModel,
  resolvePlanSnapshotForDisplay,
  resolveExecutionProjectionDisplaySelection,
  buildAnalysisExecutionStreamUrl,
};

export default analysisExecutionDisplayModule;
