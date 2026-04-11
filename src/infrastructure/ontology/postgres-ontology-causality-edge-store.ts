import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyCausalityEdgeInput,
  OntologyCausalityEdgeStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyCausalityEdge,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyCausalityEdges } from '@/infrastructure/postgres/schema/ontology-causality-edges';

function rowToCausalityEdge(
  row: typeof ontologyCausalityEdges.$inferSelect,
): OntologyCausalityEdge {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    sourceEntityKey: row.sourceEntityKey,
    targetEntityKey: row.targetEntityKey,
    causalityType: row.causalityType,
    isAttributionPathEnabled: row.isAttributionPathEnabled,
    defaultWeight: (row.defaultWeight ?? { type: 'fixed', value: 1.0 }) as Record<string, unknown>,
    neo4jRelationshipTypes: row.neo4jRelationshipTypes ?? [],
    temporalConstraints: (row.temporalConstraints ?? null) as Record<string, unknown> | null,
    filterConditions: (row.filterConditions ?? null) as Record<string, unknown> | null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyCausalityEdgeStore(
  db?: PostgresDb,
): OntologyCausalityEdgeStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyCausalityEdgeInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyCausalityEdges)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            sourceEntityKey: item.sourceEntityKey,
            targetEntityKey: item.targetEntityKey,
            causalityType: item.causalityType,
            isAttributionPathEnabled: item.isAttributionPathEnabled,
            defaultWeight: item.defaultWeight,
            neo4jRelationshipTypes: item.neo4jRelationshipTypes,
            temporalConstraints: item.temporalConstraints ?? null,
            filterConditions: item.filterConditions ?? null,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToCausalityEdge);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyCausalityEdges)
        .where(eq(ontologyCausalityEdges.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToCausalityEdge);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyCausalityEdges)
        .where(
          and(
            eq(ontologyCausalityEdges.ontologyVersionId, ontologyVersionId),
            eq(ontologyCausalityEdges.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToCausalityEdge(rows[0]) : null;
    },

    async findAttributionPaths(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyCausalityEdges)
        .where(
          and(
            eq(ontologyCausalityEdges.ontologyVersionId, ontologyVersionId),
            eq(ontologyCausalityEdges.isAttributionPathEnabled, true),
          ),
        );

      return rows.map(rowToCausalityEdge);
    },
  };
}
