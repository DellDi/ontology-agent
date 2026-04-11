import { and, asc, eq } from 'drizzle-orm';

import type {
  CreateOntologyPlanStepTemplateInput,
  OntologyPlanStepTemplateStore,
} from '@/application/ontology/ports';
import type {
  DefinitionLifecycleState,
  OntologyPlanStepTemplate,
} from '@/domain/ontology/models';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyPlanStepTemplates } from '@/infrastructure/postgres/schema/ontology-plan-step-templates';

function rowToPlanStepTemplate(
  row: typeof ontologyPlanStepTemplates.$inferSelect,
): OntologyPlanStepTemplate {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    businessKey: row.businessKey,
    displayName: row.displayName,
    description: row.description ?? null,
    status: row.status as DefinitionLifecycleState,
    intentTypes: row.intentTypes ?? [],
    requiredCapabilities: row.requiredCapabilities ?? [],
    sortOrder: row.sortOrder,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createPostgresOntologyPlanStepTemplateStore(
  db?: PostgresDb,
): OntologyPlanStepTemplateStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateOntologyPlanStepTemplateInput[]) {
      if (items.length === 0) return [];

      const rows = await resolvedDb
        .insert(ontologyPlanStepTemplates)
        .values(
          items.map((item) => ({
            id: item.id,
            ontologyVersionId: item.ontologyVersionId,
            businessKey: item.businessKey,
            displayName: item.displayName,
            description: item.description ?? null,
            status: item.status,
            intentTypes: item.intentTypes,
            requiredCapabilities: item.requiredCapabilities,
            sortOrder: item.sortOrder,
            metadata: item.metadata,
            createdAt: new Date(item.createdAt),
            updatedAt: new Date(item.updatedAt),
          })),
        )
        .returning();

      return rows.map(rowToPlanStepTemplate);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyPlanStepTemplates)
        .where(eq(ontologyPlanStepTemplates.ontologyVersionId, ontologyVersionId))
        .orderBy(asc(ontologyPlanStepTemplates.sortOrder));

      return rows.map(rowToPlanStepTemplate);
    },

    async findByVersionAndKey(ontologyVersionId, businessKey) {
      const rows = await resolvedDb
        .select()
        .from(ontologyPlanStepTemplates)
        .where(
          and(
            eq(ontologyPlanStepTemplates.ontologyVersionId, ontologyVersionId),
            eq(ontologyPlanStepTemplates.businessKey, businessKey),
          ),
        )
        .limit(1);

      return rows[0] ? rowToPlanStepTemplate(rows[0]) : null;
    },
  };
}
