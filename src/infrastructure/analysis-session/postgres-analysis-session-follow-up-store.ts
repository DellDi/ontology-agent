import { asc, and, eq } from 'drizzle-orm';

import type { AnalysisSessionFollowUpStore } from '@/application/follow-up/ports';
import type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { analysisSessionFollowUps } from '@/infrastructure/postgres/schema/analysis-session-follow-ups';

function rowToAnalysisSessionFollowUp(
  row: typeof analysisSessionFollowUps.$inferSelect,
): AnalysisSessionFollowUp {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerUserId: row.ownerUserId,
    questionText: row.questionText,
    referencedExecutionId: row.referencedExecutionId,
    referencedConclusionTitle: row.referencedConclusionTitle,
    referencedConclusionSummary: row.referencedConclusionSummary,
    inheritedContext:
      row.inheritedContext as AnalysisSessionFollowUp['inheritedContext'],
    mergedContext: row.mergedContext as AnalysisSessionFollowUp['mergedContext'],
    planVersion: row.planVersion,
    currentPlanSnapshot:
      row.currentPlanSnapshot as AnalysisSessionFollowUp['currentPlanSnapshot'],
    previousPlanSnapshot:
      row.previousPlanSnapshot as AnalysisSessionFollowUp['previousPlanSnapshot'],
    currentPlanDiff:
      row.currentPlanDiff as AnalysisSessionFollowUp['currentPlanDiff'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresAnalysisSessionFollowUpStore(
  db?: PostgresDb,
): AnalysisSessionFollowUpStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(followUp) {
      await resolvedDb.insert(analysisSessionFollowUps).values({
        id: followUp.id,
        sessionId: followUp.sessionId,
        ownerUserId: followUp.ownerUserId,
        questionText: followUp.questionText,
        referencedExecutionId: followUp.referencedExecutionId,
        referencedConclusionTitle: followUp.referencedConclusionTitle,
        referencedConclusionSummary: followUp.referencedConclusionSummary,
        inheritedContext: followUp.inheritedContext,
        mergedContext: followUp.mergedContext,
        planVersion: followUp.planVersion,
        currentPlanSnapshot: followUp.currentPlanSnapshot,
        previousPlanSnapshot: followUp.previousPlanSnapshot,
        currentPlanDiff: followUp.currentPlanDiff,
        createdAt: new Date(followUp.createdAt),
        updatedAt: new Date(followUp.updatedAt),
      });

      return followUp;
    },

    async getById({ followUpId, ownerUserId }) {
      const rows = await resolvedDb
        .select()
        .from(analysisSessionFollowUps)
        .where(
          and(
            eq(analysisSessionFollowUps.id, followUpId),
            eq(analysisSessionFollowUps.ownerUserId, ownerUserId),
          ),
        )
        .limit(1);

      const row = rows[0];

      return row ? rowToAnalysisSessionFollowUp(row) : null;
    },

    async updateMergedContext({
      followUpId,
      ownerUserId,
      mergedContext,
      updatedAt,
    }) {
      const rows = await resolvedDb
        .update(analysisSessionFollowUps)
        .set({
          mergedContext,
          updatedAt: new Date(updatedAt),
        })
        .where(
          and(
            eq(analysisSessionFollowUps.id, followUpId),
            eq(analysisSessionFollowUps.ownerUserId, ownerUserId),
          ),
        )
        .returning();

      const row = rows[0];

      return row ? rowToAnalysisSessionFollowUp(row) : null;
    },

    async updatePlanState({
      followUpId,
      ownerUserId,
      planVersion,
      currentPlanSnapshot,
      previousPlanSnapshot,
      currentPlanDiff,
      updatedAt,
    }) {
      const rows = await resolvedDb
        .update(analysisSessionFollowUps)
        .set({
          planVersion,
          currentPlanSnapshot,
          previousPlanSnapshot,
          currentPlanDiff,
          updatedAt: new Date(updatedAt),
        })
        .where(
          and(
            eq(analysisSessionFollowUps.id, followUpId),
            eq(analysisSessionFollowUps.ownerUserId, ownerUserId),
          ),
        )
        .returning();

      const row = rows[0];

      return row ? rowToAnalysisSessionFollowUp(row) : null;
    },

    async listBySessionId({ sessionId, ownerUserId }) {
      const rows = await resolvedDb
        .select()
        .from(analysisSessionFollowUps)
        .where(
          and(
            eq(analysisSessionFollowUps.sessionId, sessionId),
            eq(analysisSessionFollowUps.ownerUserId, ownerUserId),
          ),
        )
        .orderBy(asc(analysisSessionFollowUps.createdAt));

      return rows.map(rowToAnalysisSessionFollowUp);
    },
  };
}
