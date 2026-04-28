import { and, desc, eq, isNotNull } from 'drizzle-orm';

import type { OntologyVersionStore } from '@/application/ontology/ports';
import type { OntologyVersion, OntologyVersionStatus } from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyVersions } from '@/infrastructure/postgres/schema/ontology-versions';

function rowToOntologyVersion(
  row: typeof ontologyVersions.$inferSelect,
): OntologyVersion {
  return {
    id: row.id,
    semver: row.semver,
    displayName: row.displayName,
    status: row.status as OntologyVersionStatus,
    description: row.description ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    deprecatedAt: row.deprecatedAt?.toISOString() ?? null,
    retiredAt: row.retiredAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyVersionStore(
  db?: PostgresDb,
): OntologyVersionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(input) {
      const rows = await resolvedDb
        .insert(ontologyVersions)
        .values({
          id: input.id,
          semver: input.semver,
          displayName: input.displayName,
          status: 'draft',
          description: input.description ?? null,
          createdBy: input.createdBy,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.updatedAt),
        })
        .returning();

      return rowToOntologyVersion(rows[0]);
    },

    async findById(id) {
      const rows = await resolvedDb
        .select()
        .from(ontologyVersions)
        .where(eq(ontologyVersions.id, id))
        .limit(1);

      return rows[0] ? rowToOntologyVersion(rows[0]) : null;
    },

    async findCurrentApproved() {
      const rows = await resolvedDb
        .select()
        .from(ontologyVersions)
        .where(eq(ontologyVersions.status, 'approved'))
        .orderBy(
          desc(ontologyVersions.publishedAt),
          desc(ontologyVersions.updatedAt),
          desc(ontologyVersions.createdAt),
          desc(ontologyVersions.id),
        )
        .limit(1);

      return rows[0] ? rowToOntologyVersion(rows[0]) : null;
    },

    async findCurrentPublished() {
      const rows = await resolvedDb
        .select()
        .from(ontologyVersions)
        .where(
          and(
            eq(ontologyVersions.status, 'approved'),
            isNotNull(ontologyVersions.publishedAt),
          ),
        )
        .orderBy(
          desc(ontologyVersions.publishedAt),
          desc(ontologyVersions.updatedAt),
          desc(ontologyVersions.id),
        )
        .limit(1);

      return rows[0] ? rowToOntologyVersion(rows[0]) : null;
    },

    async listRecent(limit = 20) {
      const rows = await resolvedDb
        .select()
        .from(ontologyVersions)
        .orderBy(
          desc(ontologyVersions.publishedAt),
          desc(ontologyVersions.updatedAt),
          desc(ontologyVersions.createdAt),
          desc(ontologyVersions.id),
        )
        .limit(limit);

      return rows.map((row) => rowToOntologyVersion(row));
    },

    async listApprovedCandidates(limit = 20) {
      const rows = await resolvedDb
        .select()
        .from(ontologyVersions)
        .where(eq(ontologyVersions.status, 'approved'))
        .orderBy(
          desc(ontologyVersions.publishedAt),
          desc(ontologyVersions.updatedAt),
          desc(ontologyVersions.createdAt),
          desc(ontologyVersions.id),
        )
        .limit(limit);

      return rows.map((row) => rowToOntologyVersion(row));
    },

    async updateStatus(id, status, updatedAt, timestamps) {
      const rows = await resolvedDb
        .update(ontologyVersions)
        .set({
          status,
          updatedAt: new Date(updatedAt),
          ...(timestamps?.publishedAt !== undefined && {
            publishedAt: timestamps.publishedAt
              ? new Date(timestamps.publishedAt)
              : null,
          }),
          ...(timestamps?.deprecatedAt !== undefined && {
            deprecatedAt: timestamps.deprecatedAt
              ? new Date(timestamps.deprecatedAt)
              : null,
          }),
          ...(timestamps?.retiredAt !== undefined && {
            retiredAt: timestamps.retiredAt
              ? new Date(timestamps.retiredAt)
              : null,
          }),
        })
        .where(eq(ontologyVersions.id, id))
        .returning();

      if (!rows[0]) {
        throw new Error(`OntologyVersion not found: ${id}`);
      }

      return rowToOntologyVersion(rows[0]);
    },
  };
}
