import { and, desc, eq } from 'drizzle-orm';

import type {
  CreateChangeRequestInput,
  OntologyChangeRequestStore,
} from '@/application/ontology/governance-ports';
import type {
  ChangeRequestStatus,
  OntologyChangeRequest,
} from '@/domain/ontology/governance';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyChangeRequests } from '@/infrastructure/postgres/schema/ontology-change-requests';

function rowToDomain(
  row: typeof ontologyChangeRequests.$inferSelect,
): OntologyChangeRequest {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    targetObjectType: row.targetObjectType as OntologyChangeRequest['targetObjectType'],
    targetObjectKey: row.targetObjectKey,
    changeType: row.changeType as OntologyChangeRequest['changeType'],
    status: row.status as ChangeRequestStatus,
    title: row.title,
    description: row.description ?? null,
    beforeSummary: (row.beforeSummary ?? null) as Record<string, unknown> | null,
    afterSummary: (row.afterSummary ?? null) as Record<string, unknown> | null,
    impactScope: row.impactScope,
    compatibilityType: row.compatibilityType as OntologyChangeRequest['compatibilityType'],
    compatibilityNote: row.compatibilityNote ?? null,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyChangeRequestStore(
  db?: PostgresDb,
): OntologyChangeRequestStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(input: CreateChangeRequestInput) {
      const rows = await resolvedDb
        .insert(ontologyChangeRequests)
        .values({
          id: input.id,
          ontologyVersionId: input.ontologyVersionId,
          targetObjectType: input.targetObjectType,
          targetObjectKey: input.targetObjectKey,
          changeType: input.changeType,
          status: 'draft',
          title: input.title,
          description: input.description ?? null,
          beforeSummary: input.beforeSummary ?? null,
          afterSummary: input.afterSummary ?? null,
          impactScope: input.impactScope,
          compatibilityType: input.compatibilityType,
          compatibilityNote: input.compatibilityNote ?? null,
          submittedBy: input.submittedBy,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.updatedAt),
        })
        .returning();

      return rowToDomain(rows[0]);
    },

    async findById(id: string) {
      const rows = await resolvedDb
        .select()
        .from(ontologyChangeRequests)
        .where(eq(ontologyChangeRequests.id, id))
        .limit(1);

      return rows[0] ? rowToDomain(rows[0]) : null;
    },

    async updateStatus(
      id: string,
      status: ChangeRequestStatus,
      updatedAt: string,
      submittedAt?: string | null,
    ) {
      const setValues: Record<string, unknown> = {
        status,
        updatedAt: new Date(updatedAt),
      };
      if (submittedAt !== undefined) {
        setValues.submittedAt = submittedAt ? new Date(submittedAt) : null;
      }

      const rows = await resolvedDb
        .update(ontologyChangeRequests)
        .set(setValues)
        .where(eq(ontologyChangeRequests.id, id))
        .returning();

      if (!rows[0]) {
        throw new Error(`OntologyChangeRequest not found: ${id}`);
      }

      return rowToDomain(rows[0]);
    },

    async findByVersionId(ontologyVersionId: string) {
      const rows = await resolvedDb
        .select()
        .from(ontologyChangeRequests)
        .where(eq(ontologyChangeRequests.ontologyVersionId, ontologyVersionId))
        .orderBy(desc(ontologyChangeRequests.createdAt));

      return rows.map(rowToDomain);
    },

    async findByStatus(status: ChangeRequestStatus) {
      const rows = await resolvedDb
        .select()
        .from(ontologyChangeRequests)
        .where(eq(ontologyChangeRequests.status, status))
        .orderBy(desc(ontologyChangeRequests.createdAt));

      return rows.map(rowToDomain);
    },

    async findByVersionAndStatus(
      ontologyVersionId: string,
      status: ChangeRequestStatus,
    ) {
      const rows = await resolvedDb
        .select()
        .from(ontologyChangeRequests)
        .where(
          and(
            eq(ontologyChangeRequests.ontologyVersionId, ontologyVersionId),
            eq(ontologyChangeRequests.status, status),
          ),
        )
        .orderBy(desc(ontologyChangeRequests.createdAt));

      return rows.map(rowToDomain);
    },

    async listRecent(limit = 50) {
      const rows = await resolvedDb
        .select()
        .from(ontologyChangeRequests)
        .orderBy(desc(ontologyChangeRequests.updatedAt), desc(ontologyChangeRequests.createdAt))
        .limit(limit);

      return rows.map(rowToDomain);
    },
  };
}
