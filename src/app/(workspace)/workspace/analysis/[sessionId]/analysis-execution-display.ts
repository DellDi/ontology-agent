import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import {
  type AnalysisExecutionPlanSnapshot,
  validateAnalysisExecutionJobData,
} from '@/domain/analysis-execution/models';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
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

const analysisExecutionDisplayModule = {
  buildExecutionStreamReadModelFromSnapshot,
  getSessionScopedExecutionSnapshot,
  getSessionScopedExecutionJob,
  mergeExecutionEvents,
  buildLiveConclusionReadModel,
};

export default analysisExecutionDisplayModule;
