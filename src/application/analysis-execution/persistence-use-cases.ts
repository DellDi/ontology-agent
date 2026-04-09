import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type {
  AnalysisExecutionFailurePoint,
  AnalysisExecutionSnapshot,
} from '@/domain/analysis-execution/persistence-models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { JobStatus } from '@/domain/job-contract/models';

import type { AnalysisExecutionSnapshotStore } from './persistence-ports';

function buildFailurePoint(
  status: JobStatus,
  events: AnalysisExecutionStreamEvent[],
): AnalysisExecutionFailurePoint | null {
  if (status !== 'failed') {
    return null;
  }

  const failedEvent = [...events]
    .reverse()
    .find((event) => event.step?.status === 'failed');

  if (!failedEvent?.step) {
    return null;
  }

  return {
    id: failedEvent.step.id,
    order: failedEvent.step.order,
    title: failedEvent.step.title,
  };
}

function buildMobileProjection(
  status: JobStatus,
  updatedAt: string,
  conclusionReadModel: AnalysisConclusionReadModel,
  events: AnalysisExecutionStreamEvent[],
) {
  return {
    summary:
      conclusionReadModel.causes[0]?.summary ??
      events.at(-1)?.message ??
      '暂无可展示摘要。',
    status,
    updatedAt,
  };
}

function buildResultBlocks(
  conclusionReadModel: AnalysisConclusionReadModel,
  events: AnalysisExecutionStreamEvent[],
) {
  const stageBlocks = events.flatMap((event) => event.renderBlocks);

  return [...conclusionReadModel.renderBlocks, ...stageBlocks];
}

export function createAnalysisExecutionPersistenceUseCases({
  snapshotStore,
}: {
  snapshotStore: AnalysisExecutionSnapshotStore;
}) {
  return {
    async saveExecutionSnapshot(input: {
      executionId: string;
      sessionId: string;
      ownerUserId: string;
      followUpId?: string | null;
      status: JobStatus;
      planSnapshot: AnalysisExecutionPlanSnapshot;
      events: AnalysisExecutionStreamEvent[];
      conclusionReadModel: AnalysisConclusionReadModel;
    }) {
      const timestamp = new Date().toISOString();
      const snapshot: AnalysisExecutionSnapshot = {
        executionId: input.executionId,
        sessionId: input.sessionId,
        ownerUserId: input.ownerUserId,
        followUpId: input.followUpId ?? null,
        status: input.status,
        planSnapshot: input.planSnapshot,
        stepResults: input.events,
        conclusionState: input.conclusionReadModel,
        resultBlocks: buildResultBlocks(
          input.conclusionReadModel,
          input.events,
        ),
        mobileProjection: buildMobileProjection(
          input.status,
          timestamp,
          input.conclusionReadModel,
          input.events,
        ),
        failurePoint: buildFailurePoint(input.status, input.events),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return await snapshotStore.save(snapshot);
    },

    async getLatestSnapshotForSession({
      sessionId,
      ownerUserId,
    }: {
      sessionId: string;
      ownerUserId: string;
    }) {
      const snapshot = await snapshotStore.getLatestBySessionId(sessionId);

      if (!snapshot || snapshot.ownerUserId !== ownerUserId) {
        return null;
      }

      return snapshot;
    },

    async listSnapshotsForSession({
      sessionId,
      ownerUserId,
    }: {
      sessionId: string;
      ownerUserId: string;
    }) {
      const snapshots = await snapshotStore.listBySessionId(sessionId);

      return snapshots.filter((snapshot) => snapshot.ownerUserId === ownerUserId);
    },

    async getSnapshotByExecutionId({
      executionId,
      ownerUserId,
    }: {
      executionId: string;
      ownerUserId: string;
    }) {
      const snapshot = await snapshotStore.getByExecutionId(executionId);

      if (!snapshot || snapshot.ownerUserId !== ownerUserId) {
        return null;
      }

      return snapshot;
    },
  };
}
