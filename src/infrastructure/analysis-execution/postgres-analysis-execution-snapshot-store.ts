import { desc, eq } from 'drizzle-orm';

import type { AnalysisExecutionSnapshotStore } from '@/application/analysis-execution/persistence-ports';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import {
  createOntologyVersionBinding,
  normalizeOntologyVersionBindingSource,
  type OntologyVersionBindingSource,
} from '@/domain/ontology/version-binding';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { analysisExecutionSnapshots } from '@/infrastructure/postgres/schema/analysis-execution-snapshots';

function normalizePersistedBindingSource(
  source: string | null | undefined,
  hasVersion: boolean,
): Exclude<OntologyVersionBindingSource, 'legacy/unknown'> | undefined {
  const normalized = normalizeOntologyVersionBindingSource(source, hasVersion);

  return normalized === 'legacy/unknown' ? undefined : normalized;
}

function rowToSnapshot(
  row: typeof analysisExecutionSnapshots.$inferSelect,
): AnalysisExecutionSnapshot {
  return {
    executionId: row.executionId,
    sessionId: row.sessionId,
    ownerUserId: row.ownerUserId,
    followUpId: row.followUpId,
    ontologyVersionId: row.ontologyVersionId,
    ontologyVersionBinding: createOntologyVersionBinding(
      row.ontologyVersionId,
      normalizePersistedBindingSource(
        row.ontologyVersionBindingSource,
        Boolean(row.ontologyVersionId),
      ),
    ),
    status: row.status as AnalysisExecutionSnapshot['status'],
    planSnapshot: row.planSnapshot as AnalysisExecutionSnapshot['planSnapshot'],
    stepResults: row.stepResults as AnalysisExecutionSnapshot['stepResults'],
    conclusionState:
      row.conclusionState as AnalysisExecutionSnapshot['conclusionState'],
    resultBlocks: row.resultBlocks as AnalysisExecutionSnapshot['resultBlocks'],
    mobileProjection:
      row.mobileProjection as AnalysisExecutionSnapshot['mobileProjection'],
    failurePoint: row.failurePoint as AnalysisExecutionSnapshot['failurePoint'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresAnalysisExecutionSnapshotStore(
  db?: PostgresDb,
): AnalysisExecutionSnapshotStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async save(snapshot) {
      const ontologyVersionBinding =
        snapshot.ontologyVersionBinding ??
        createOntologyVersionBinding(snapshot.ontologyVersionId, 'inherited');
      await resolvedDb
        .insert(analysisExecutionSnapshots)
        .values({
          executionId: snapshot.executionId,
          sessionId: snapshot.sessionId,
          ownerUserId: snapshot.ownerUserId,
          followUpId: snapshot.followUpId,
          ontologyVersionId: ontologyVersionBinding.ontologyVersionId,
          ontologyVersionBindingSource: ontologyVersionBinding.source,
          status: snapshot.status,
          planSnapshot: snapshot.planSnapshot,
          stepResults: snapshot.stepResults,
          conclusionState: snapshot.conclusionState,
          resultBlocks: snapshot.resultBlocks,
          mobileProjection: snapshot.mobileProjection,
          failurePoint: snapshot.failurePoint,
          createdAt: new Date(snapshot.createdAt),
          updatedAt: new Date(snapshot.updatedAt),
        })
        .onConflictDoUpdate({
          target: analysisExecutionSnapshots.executionId,
          set: {
            status: snapshot.status,
            planSnapshot: snapshot.planSnapshot,
            followUpId: snapshot.followUpId,
            ontologyVersionId: ontologyVersionBinding.ontologyVersionId,
            ontologyVersionBindingSource: ontologyVersionBinding.source,
            stepResults: snapshot.stepResults,
            conclusionState: snapshot.conclusionState,
            resultBlocks: snapshot.resultBlocks,
            mobileProjection: snapshot.mobileProjection,
            failurePoint: snapshot.failurePoint,
            updatedAt: new Date(snapshot.updatedAt),
          },
        });

      return {
        ...snapshot,
        ontologyVersionId: ontologyVersionBinding.ontologyVersionId,
        ontologyVersionBinding,
      };
    },

    async getLatestBySessionId(sessionId) {
      const rows = await resolvedDb
        .select()
        .from(analysisExecutionSnapshots)
        .where(eq(analysisExecutionSnapshots.sessionId, sessionId))
        .orderBy(desc(analysisExecutionSnapshots.updatedAt))
        .limit(1);

      const row = rows[0];

      return row ? rowToSnapshot(row) : null;
    },

    async listBySessionId(sessionId) {
      const rows = await resolvedDb
        .select()
        .from(analysisExecutionSnapshots)
        .where(eq(analysisExecutionSnapshots.sessionId, sessionId))
        .orderBy(analysisExecutionSnapshots.createdAt);

      return rows.map(rowToSnapshot);
    },

    async getByExecutionId(executionId) {
      const rows = await resolvedDb
        .select()
        .from(analysisExecutionSnapshots)
        .where(eq(analysisExecutionSnapshots.executionId, executionId))
        .limit(1);

      const row = rows[0];

      return row ? rowToSnapshot(row) : null;
    },
  };
}
