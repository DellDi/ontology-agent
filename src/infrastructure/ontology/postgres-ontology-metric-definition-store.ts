import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyMetricDefinitionInput,
  OntologyMetricDefinitionStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyMetricDefinition,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyMetricDefinitions } from '@/infrastructure/postgres/schema/ontology-metric-definitions';

function rowToMetricDefinition(
  row: typeof ontologyMetricDefinitions.$inferSelect,
): OntologyMetricDefinition {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    applicableSubjectKeys: row.applicableSubjectKeys ?? [],
    defaultAggregation: row.defaultAggregation ?? null,
    unit: row.unit ?? null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyMetricDefinitionStore(
  db?: PostgresDb,
): OntologyMetricDefinitionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyMetricDefinitionInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyMetricDefinitions)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            applicableSubjectKeys: item.applicableSubjectKeys,
            defaultAggregation: item.defaultAggregation ?? null,
            unit: item.unit ?? null,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToMetricDefinition);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyMetricDefinitions)
        .where(eq(ontologyMetricDefinitions.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToMetricDefinition);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyMetricDefinitions)
        .where(
          and(
            eq(ontologyMetricDefinitions.ontologyVersionId, ontologyVersionId),
            eq(ontologyMetricDefinitions.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToMetricDefinition(rows[0]) : null;
    },
  };
}
