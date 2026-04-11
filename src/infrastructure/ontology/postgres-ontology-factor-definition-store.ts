import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyFactorDefinitionInput,
  OntologyFactorDefinitionStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyFactorDefinition,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyFactorDefinitions } from '@/infrastructure/postgres/schema/ontology-factor-definitions';

function rowToFactorDefinition(
  row: typeof ontologyFactorDefinitions.$inferSelect,
): OntologyFactorDefinition {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    category: row.category,
    relatedMetricKeys: row.relatedMetricKeys ?? [],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyFactorDefinitionStore(
  db?: PostgresDb,
): OntologyFactorDefinitionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyFactorDefinitionInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyFactorDefinitions)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            category: item.category,
            relatedMetricKeys: item.relatedMetricKeys,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToFactorDefinition);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyFactorDefinitions)
        .where(eq(ontologyFactorDefinitions.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToFactorDefinition);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyFactorDefinitions)
        .where(
          and(
            eq(ontologyFactorDefinitions.ontologyVersionId, ontologyVersionId),
            eq(ontologyFactorDefinitions.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToFactorDefinition(rows[0]) : null;
    },
  };
}
