import { and, eq } from 'drizzle-orm';

import type {
  CreateOntologyEvidenceTypeDefinitionInput,
  OntologyEvidenceTypeDefinitionStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyEvidenceTypeDefinition,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyEvidenceTypeDefinitions } from '@/infrastructure/postgres/schema/ontology-evidence-type-definitions';

function rowToEvidenceTypeDefinition(
  row: typeof ontologyEvidenceTypeDefinitions.$inferSelect,
): OntologyEvidenceTypeDefinition {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    evidenceCategory: row.evidenceCategory,
    rendererConfig: (row.rendererConfig ?? {}) as Record<string, unknown>,
    dataSourceConfig: (row.dataSourceConfig ?? {}) as Record<string, unknown>,
    defaultPriority: row.defaultPriority ?? null,
    isInteractive: row.isInteractive as boolean,
    templateSchema: (row.templateSchema ?? null) as Record<string, unknown> | null,
    validationRules: (row.validationRules ?? []) as unknown[],
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyEvidenceTypeDefinitionStore(
  db?: PostgresDb,
): OntologyEvidenceTypeDefinitionStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyEvidenceTypeDefinitionInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyEvidenceTypeDefinitions)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            evidenceCategory: item.evidenceCategory,
            rendererConfig: item.rendererConfig,
            dataSourceConfig: item.dataSourceConfig,
            defaultPriority: item.defaultPriority ?? null,
            isInteractive: item.isInteractive,
            templateSchema: item.templateSchema ?? null,
            validationRules: item.validationRules,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToEvidenceTypeDefinition);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyEvidenceTypeDefinitions)
        .where(eq(ontologyEvidenceTypeDefinitions.ontologyVersionId, ontologyVersionId));

      return rows.map(rowToEvidenceTypeDefinition);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyEvidenceTypeDefinitions)
        .where(
          and(
            eq(ontologyEvidenceTypeDefinitions.ontologyVersionId, ontologyVersionId),
            eq(ontologyEvidenceTypeDefinitions.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToEvidenceTypeDefinition(rows[0]) : null;
    },
  };
}
