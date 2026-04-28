import { desc, eq } from 'drizzle-orm';

import type {
  CreateApprovalRecordInput,
  OntologyApprovalRecordStore,
} from '@/application/ontology/governance-ports';
import type {
  ApprovalDecision,
  OntologyApprovalRecord,
} from '@/domain/ontology/governance';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyApprovalRecords } from '@/infrastructure/postgres/schema/ontology-approval-records';

function rowToDomain(
  row: typeof ontologyApprovalRecords.$inferSelect,
): OntologyApprovalRecord {
  return {
    id: row.id,
    changeRequestId: row.changeRequestId,
    decision: row.decision as ApprovalDecision,
    reviewedBy: row.reviewedBy,
    comment: row.comment ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createPostgresOntologyApprovalRecordStore(
  db?: PostgresDb,
): OntologyApprovalRecordStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(input: CreateApprovalRecordInput) {
      const rows = await resolvedDb
        .insert(ontologyApprovalRecords)
        .values({
          id: input.id,
          changeRequestId: input.changeRequestId,
          decision: input.decision,
          reviewedBy: input.reviewedBy,
          comment: input.comment ?? null,
          createdAt: new Date(input.createdAt),
        })
        .returning();

      return rowToDomain(rows[0]);
    },

    async findByChangeRequestId(changeRequestId: string) {
      const rows = await resolvedDb
        .select()
        .from(ontologyApprovalRecords)
        .where(eq(ontologyApprovalRecords.changeRequestId, changeRequestId))
        .orderBy(desc(ontologyApprovalRecords.createdAt));

      return rows.map(rowToDomain);
    },
  };
}
