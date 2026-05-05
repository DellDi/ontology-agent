import { and, eq, isNull } from 'drizzle-orm';

import type { AnalysisUiMessageProjectionStore } from '@/application/analysis-message-projection/ports';
import type { AnalysisUiMessageProjectionRecord } from '@/domain/analysis-message-projection/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { analysisUiMessageProjections } from '@/infrastructure/postgres/schema/analysis-ui-message-projections';

function rowToRecord(
  row: typeof analysisUiMessageProjections.$inferSelect,
): AnalysisUiMessageProjectionRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    ownerUserId: row.ownerUserId,
    executionId: row.executionId,
    followUpId: row.followUpId,
    historyRoundId: row.historyRoundId,
    projectionVersion: row.projectionVersion,
    partSchemaVersion: row.partSchemaVersion,
    contractVersion: row.contractVersion,
    status: row.status as AnalysisUiMessageProjectionRecord['status'],
    isTerminal: row.isTerminal,
    streamCursor:
      row.streamCursor as AnalysisUiMessageProjectionRecord['streamCursor'],
    messages: row.messages as AnalysisUiMessageProjectionRecord['messages'],
    recoveryMetadata:
      row.recoveryMetadata as AnalysisUiMessageProjectionRecord['recoveryMetadata'],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresAnalysisUiMessageProjectionStore(
  db?: PostgresDb,
): AnalysisUiMessageProjectionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async save(record) {
      await resolvedDb
        .insert(analysisUiMessageProjections)
        .values({
          id: record.id,
          sessionId: record.sessionId,
          ownerUserId: record.ownerUserId,
          executionId: record.executionId,
          followUpId: record.followUpId,
          historyRoundId: record.historyRoundId,
          projectionVersion: record.projectionVersion,
          partSchemaVersion: record.partSchemaVersion,
          contractVersion: record.contractVersion,
          status: record.status,
          isTerminal: record.isTerminal,
          streamCursor: record.streamCursor,
          messages: record.messages,
          recoveryMetadata: record.recoveryMetadata,
          createdAt: new Date(record.createdAt),
          updatedAt: new Date(record.updatedAt),
        })
        .onConflictDoUpdate({
          target: analysisUiMessageProjections.id,
          set: {
            projectionVersion: record.projectionVersion,
            partSchemaVersion: record.partSchemaVersion,
            contractVersion: record.contractVersion,
            status: record.status,
            isTerminal: record.isTerminal,
            streamCursor: record.streamCursor,
            messages: record.messages,
            recoveryMetadata: record.recoveryMetadata,
            updatedAt: new Date(record.updatedAt),
          },
        });

      return record;
    },

    async getByScope(scope) {
      const rows = await resolvedDb
        .select()
        .from(analysisUiMessageProjections)
        .where(
          and(
            eq(analysisUiMessageProjections.ownerUserId, scope.ownerUserId),
            eq(analysisUiMessageProjections.sessionId, scope.sessionId),
            eq(analysisUiMessageProjections.executionId, scope.executionId),
            scope.followUpId
              ? eq(analysisUiMessageProjections.followUpId, scope.followUpId)
              : isNull(analysisUiMessageProjections.followUpId),
            scope.historyRoundId
              ? eq(
                  analysisUiMessageProjections.historyRoundId,
                  scope.historyRoundId,
                )
              : isNull(analysisUiMessageProjections.historyRoundId),
          ),
        )
        .limit(1);

      const row = rows[0];

      return row ? rowToRecord(row) : null;
    },
  };
}
