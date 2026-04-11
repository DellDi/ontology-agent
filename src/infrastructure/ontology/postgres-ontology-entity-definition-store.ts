import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyEntityDefinitionInput,
  OntologyEntityDefinitionStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyEntityDefinition,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyEntityDefinitions } from '@/infrastructure/postgres/schema/ontology-entity-definitions';

function rowToEntityDefinition(
  row: typeof ontologyEntityDefinitions.$inferSelect,
): OntologyEntityDefinition {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    synonyms: row.synonyms ?? [],
    parentBusinessKey: row.parentBusinessKey ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyEntityDefinitionStore(
  db?: PostgresDb,
): OntologyEntityDefinitionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyEntityDefinitionInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyEntityDefinitions)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            synonyms: item.synonyms,
            parentBusinessKey: item.parentBusinessKey ?? null,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToEntityDefinition);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyEntityDefinitions)
        .where(eq(ontologyEntityDefinitions.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToEntityDefinition);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyEntityDefinitions)
        .where(
          and(
            eq(ontologyEntityDefinitions.ontologyVersionId, ontologyVersionId),
            eq(ontologyEntityDefinitions.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToEntityDefinition(rows[0]) : null;
    },
  };
}
