import { desc, eq } from 'drizzle-orm';

import type {
  CreatePublishRecordInput,
  OntologyPublishRecordStore,
} from '@/application/ontology/governance-ports';
import type { OntologyPublishRecord } from '@/domain/ontology/governance';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyPublishRecords } from '@/infrastructure/postgres/schema/ontology-publish-records';

function rowToDomain(
  row: typeof ontologyPublishRecords.$inferSelect,
): OntologyPublishRecord {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    publishedBy: row.publishedBy,
    previousVersionId: row.previousVersionId ?? null,
    changeRequestIds: row.changeRequestIds,
    publishNote: row.publishNote ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createPostgresOntologyPublishRecordStore(
  db?: PostgresDb,
): OntologyPublishRecordStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(input: CreatePublishRecordInput) {
      const rows = await resolvedDb
        .insert(ontologyPublishRecords)
        .values({
          id: input.id,
          ontologyVersionId: input.ontologyVersionId,
          publishedBy: input.publishedBy,
          previousVersionId: input.previousVersionId ?? null,
          changeRequestIds: input.changeRequestIds,
          publishNote: input.publishNote ?? null,
          createdAt: new Date(input.createdAt),
        })
        .returning();

      return rowToDomain(rows[0]);
    },

    async findByVersionId(ontologyVersionId: string) {
      const rows = await resolvedDb
        .select()
        .from(ontologyPublishRecords)
        .where(eq(ontologyPublishRecords.ontologyVersionId, ontologyVersionId))
        .orderBy(desc(ontologyPublishRecords.createdAt));

      return rows.map(rowToDomain);
    },

    async findLatest() {
      const rows = await resolvedDb
        .select()
        .from(ontologyPublishRecords)
        .orderBy(desc(ontologyPublishRecords.createdAt))
        .limit(1);

      return rows[0] ? rowToDomain(rows[0]) : null;
    },

    async listRecent(limit = 20) {
      const rows = await resolvedDb
        .select()
        .from(ontologyPublishRecords)
        .orderBy(desc(ontologyPublishRecords.createdAt))
        .limit(limit);

      return rows.map(rowToDomain);
    },
  };
}
