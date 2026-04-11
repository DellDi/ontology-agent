import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyTimeSemanticInput,
  OntologyTimeSemanticStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyTimeSemantic,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyTimeSemantics } from '@/infrastructure/postgres/schema/ontology-time-semantics';

function rowToTimeSemantic(
  row: typeof ontologyTimeSemantics.$inferSelect,
): OntologyTimeSemantic {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    semanticType: row.semanticType,
    entityDateFieldMapping: (row.entityDateFieldMapping ?? {}) as Record<string, unknown>,
    cubeTimeDimensionMapping: (row.cubeTimeDimensionMapping ?? null) as Record<string, unknown> | null,
    calculationRule: (row.calculationRule ?? null) as Record<string, unknown> | null,
    defaultGranularity: row.defaultGranularity ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyTimeSemanticStore(
  db?: PostgresDb,
): OntologyTimeSemanticStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyTimeSemanticInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyTimeSemantics)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            semanticType: item.semanticType,
            entityDateFieldMapping: item.entityDateFieldMapping,
            cubeTimeDimensionMapping: item.cubeTimeDimensionMapping ?? null,
            calculationRule: item.calculationRule ?? null,
            defaultGranularity: item.defaultGranularity ?? null,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToTimeSemantic);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyTimeSemantics)
        .where(eq(ontologyTimeSemantics.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToTimeSemantic);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyTimeSemantics)
        .where(
          and(
            eq(ontologyTimeSemantics.ontologyVersionId, ontologyVersionId),
            eq(ontologyTimeSemantics.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToTimeSemantic(rows[0]) : null;
    },
  };
}
