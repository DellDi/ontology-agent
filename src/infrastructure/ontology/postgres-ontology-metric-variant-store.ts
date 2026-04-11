import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyMetricVariantInput,
  OntologyMetricVariantStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyMetricVariant,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyMetricVariants } from '@/infrastructure/postgres/schema/ontology-metric-variants';

function rowToMetricVariant(
  row: typeof ontologyMetricVariants.$inferSelect,
): OntologyMetricVariant {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    parentMetricDefinitionId: row.parentMetricDefinitionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    semanticDiscriminator: row.semanticDiscriminator,
    cubeViewMapping: (row.cubeViewMapping ?? {}) as Record<string, unknown>,
    filterTemplate: (row.filterTemplate ?? null) as Record<string, unknown> | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyMetricVariantStore(
  db?: PostgresDb,
): OntologyMetricVariantStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyMetricVariantInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyMetricVariants)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            parentMetricDefinitionId: item.parentMetricDefinitionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            semanticDiscriminator: item.semanticDiscriminator,
            cubeViewMapping: item.cubeViewMapping,
            filterTemplate: item.filterTemplate ?? null,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToMetricVariant);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyMetricVariants)
        .where(eq(ontologyMetricVariants.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToMetricVariant);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyMetricVariants)
        .where(
          and(
            eq(ontologyMetricVariants.ontologyVersionId, ontologyVersionId),
            eq(ontologyMetricVariants.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToMetricVariant(rows[0]) : null;
    },

    async findByParentMetric(ontologyVersionId, parentMetricDefinitionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyMetricVariants)
        .where(
          and(
            eq(ontologyMetricVariants.ontologyVersionId, ontologyVersionId),
            eq(ontologyMetricVariants.parentMetricDefinitionId, parentMetricDefinitionId),
          ),
        );

      return rows.map(rowToMetricVariant);
    },
  };
}
