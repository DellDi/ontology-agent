import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type {
  AnalysisExecutionFailurePoint,
  AnalysisExecutionSnapshot,
} from '@/domain/analysis-execution/persistence-models';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { JobStatus } from '@/domain/job-contract/models';
import {
  assertOntologyVersionBindingIsPublished,
  createOntologyVersionBinding,
  getPlanOntologyVersionId,
  type OntologyVersionBindingSource,
} from '@/domain/ontology/version-binding';
import type { OntologyGroundedContext } from '@/domain/ontology/grounding';
import type { OntologyVersionStore } from '@/application/ontology/ports';

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

function resolveExecutionOntologyVersionBinding(input: {
  ontologyVersionId?: string | null;
  groundedContext?: OntologyGroundedContext | null;
  planSnapshot: AnalysisExecutionPlanSnapshot;
}) {
  const ontologyVersionId =
    input.ontologyVersionId ??
    input.groundedContext?.ontologyVersionId ??
    getPlanOntologyVersionId(input.planSnapshot);
  const source: Exclude<OntologyVersionBindingSource, 'legacy/unknown'> =
    ontologyVersionId ? 'grounded-context' : 'inherited';

  return createOntologyVersionBinding(ontologyVersionId, source);
}

export function createAnalysisExecutionPersistenceUseCases({
  snapshotStore,
  ontologyVersionStore,
}: {
  snapshotStore: AnalysisExecutionSnapshotStore;
  ontologyVersionStore?: Pick<OntologyVersionStore, 'findById'>;
}) {
  async function assertPublishedBinding(
    binding: AnalysisExecutionSnapshot['ontologyVersionBinding'],
  ) {
    if (!binding.ontologyVersionId || !ontologyVersionStore) {
      return;
    }

    const version = await ontologyVersionStore.findById(binding.ontologyVersionId);
    assertOntologyVersionBindingIsPublished({
      ontologyVersionId: binding.ontologyVersionId,
      version,
    });
  }

  return {
    async saveExecutionSnapshot(input: {
      executionId: string;
      sessionId: string;
      ownerUserId: string;
      followUpId?: string | null;
      ontologyVersionId?: string | null;
      status: JobStatus;
      planSnapshot: AnalysisExecutionPlanSnapshot;
      groundedContext?: OntologyGroundedContext | null;
      events: AnalysisExecutionStreamEvent[];
      conclusionReadModel: AnalysisConclusionReadModel;
    }) {
      const timestamp = new Date().toISOString();
      const ontologyVersionBinding = resolveExecutionOntologyVersionBinding(input);
      await assertPublishedBinding(ontologyVersionBinding);
      const snapshot: AnalysisExecutionSnapshot = {
        executionId: input.executionId,
        sessionId: input.sessionId,
        ownerUserId: input.ownerUserId,
        followUpId: input.followUpId ?? null,
        ontologyVersionId: ontologyVersionBinding.ontologyVersionId,
        ontologyVersionBinding,
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
