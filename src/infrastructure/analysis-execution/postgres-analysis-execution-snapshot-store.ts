import { desc, eq, inArray } from 'drizzle-orm';

import type {
  AnalysisExecutionSnapshotStore,
  AnalysisExecutionSnapshotHistorySummary,
  AnalysisExecutionSnapshotSummary,
} from '@/application/analysis-execution/persistence-ports';
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

function rowToSnapshotSummary(row: {
  sessionId: string;
  executionId: string;
  status: string;
  conclusionState: unknown;
  failurePoint: unknown;
  updatedAt: Date;
}): AnalysisExecutionSnapshotSummary {
  return {
    sessionId: row.sessionId,
    executionId: row.executionId,
    status: row.status as AnalysisExecutionSnapshotSummary['status'],
    conclusionState:
      row.conclusionState as AnalysisExecutionSnapshotSummary['conclusionState'],
    failurePoint:
      row.failurePoint as AnalysisExecutionSnapshotSummary['failurePoint'],
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToSnapshotHistorySummary(row: {
  executionId: string;
  sessionId: string;
  ownerUserId: string;
  followUpId: string | null;
  ontologyVersionId: string | null;
  ontologyVersionBindingSource: string;
  status: string;
  planSnapshot: unknown;
  conclusionState: unknown;
  failurePoint: unknown;
  createdAt: Date;
  updatedAt: Date;
}): AnalysisExecutionSnapshotHistorySummary {
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
    status: row.status as AnalysisExecutionSnapshotHistorySummary['status'],
    planSnapshot:
      row.planSnapshot as AnalysisExecutionSnapshotHistorySummary['planSnapshot'],
    conclusionState:
      row.conclusionState as AnalysisExecutionSnapshotHistorySummary['conclusionState'],
    failurePoint:
      row.failurePoint as AnalysisExecutionSnapshotHistorySummary['failurePoint'],
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

    async getLatestBySessionIds(sessionIds) {
      const uniqueSessionIds = [...new Set(sessionIds)].filter(Boolean);
      const snapshots = new Map<string, AnalysisExecutionSnapshot>();

      if (uniqueSessionIds.length === 0) {
        return snapshots;
      }

      const rows = await resolvedDb
        .selectDistinctOn([analysisExecutionSnapshots.sessionId])
        .from(analysisExecutionSnapshots)
        .where(inArray(analysisExecutionSnapshots.sessionId, uniqueSessionIds))
        .orderBy(
          analysisExecutionSnapshots.sessionId,
          desc(analysisExecutionSnapshots.updatedAt),
        );

      for (const row of rows) {
        snapshots.set(row.sessionId, rowToSnapshot(row));
      }

      return snapshots;
    },

    async getLatestSummariesBySessionIds(sessionIds) {
      const uniqueSessionIds = [...new Set(sessionIds)].filter(Boolean);
      const snapshots = new Map<string, AnalysisExecutionSnapshotSummary>();

      if (uniqueSessionIds.length === 0) {
        return snapshots;
      }

      const rows = await resolvedDb
        .selectDistinctOn([analysisExecutionSnapshots.sessionId], {
          sessionId: analysisExecutionSnapshots.sessionId,
          executionId: analysisExecutionSnapshots.executionId,
          status: analysisExecutionSnapshots.status,
          conclusionState: analysisExecutionSnapshots.conclusionState,
          failurePoint: analysisExecutionSnapshots.failurePoint,
          updatedAt: analysisExecutionSnapshots.updatedAt,
        })
        .from(analysisExecutionSnapshots)
        .where(inArray(analysisExecutionSnapshots.sessionId, uniqueSessionIds))
        .orderBy(
          analysisExecutionSnapshots.sessionId,
          desc(analysisExecutionSnapshots.updatedAt),
        );

      for (const row of rows) {
        snapshots.set(row.sessionId, rowToSnapshotSummary(row));
      }

      return snapshots;
    },

    async listBySessionId(sessionId) {
      const rows = await resolvedDb
        .select()
        .from(analysisExecutionSnapshots)
        .where(eq(analysisExecutionSnapshots.sessionId, sessionId))
        .orderBy(analysisExecutionSnapshots.createdAt);

      return rows.map(rowToSnapshot);
    },

    async listSummariesBySessionId(sessionId) {
      const rows = await resolvedDb
        .select({
          executionId: analysisExecutionSnapshots.executionId,
          sessionId: analysisExecutionSnapshots.sessionId,
          ownerUserId: analysisExecutionSnapshots.ownerUserId,
          followUpId: analysisExecutionSnapshots.followUpId,
          ontologyVersionId: analysisExecutionSnapshots.ontologyVersionId,
          ontologyVersionBindingSource:
            analysisExecutionSnapshots.ontologyVersionBindingSource,
          status: analysisExecutionSnapshots.status,
          planSnapshot: analysisExecutionSnapshots.planSnapshot,
          conclusionState: analysisExecutionSnapshots.conclusionState,
          failurePoint: analysisExecutionSnapshots.failurePoint,
          createdAt: analysisExecutionSnapshots.createdAt,
          updatedAt: analysisExecutionSnapshots.updatedAt,
        })
        .from(analysisExecutionSnapshots)
        .where(eq(analysisExecutionSnapshots.sessionId, sessionId))
        .orderBy(analysisExecutionSnapshots.createdAt);

      return rows.map(rowToSnapshotHistorySummary);
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
