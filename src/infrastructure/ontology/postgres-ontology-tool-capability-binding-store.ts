import { asc, eq } from 'drizzle-orm';

import type { OntologyToolCapabilityBindingStore } from '@/application/ontology/ports';
import type {
  CreateToolCapabilityBindingInput,
  ToolCapabilityBinding,
} from '@/domain/ontology/tool-binding';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { ontologyToolCapabilityBindings } from '@/infrastructure/postgres/schema';

function rowToToolCapabilityBinding(
  row: typeof ontologyToolCapabilityBindings.$inferSelect,
): ToolCapabilityBinding {
  return {
    id: row.id,
    ontologyVersionId: row.ontologyVersionId,
    boundStepTemplateKey: row.boundStepTemplateKey,
    boundCapabilityTag: row.boundCapabilityTag,
    toolName: row.toolName as ToolCapabilityBinding['toolName'],
    activationConditions: row.activationConditions ?? [],
    description: row.description ?? null,
    status: row.status,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
  };
}

export function createPostgresOntologyToolCapabilityBindingStore(
  db?: PostgresDb,
): OntologyToolCapabilityBindingStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async bulkCreate(items: CreateToolCapabilityBindingInput[]) {
      if (items.length === 0) {
        return [];
      }

      const rows = await resolvedDb
        .insert(ontologyToolCapabilityBindings)
        .values(
          items.map((item) => ({
            id: item.id ?? crypto.randomUUID(),
            ontologyVersionId: item.ontologyVersionId,
            boundStepTemplateKey: item.boundStepTemplateKey,
            boundCapabilityTag: item.boundCapabilityTag,
            toolName: item.toolName,
            activationConditions: item.activationConditions,
            description: item.description ?? null,
            status: item.status,
            priority: item.priority,
            createdAt: item.createdAt ?? new Date().toISOString(),
            updatedAt: item.updatedAt ?? new Date().toISOString(),
            createdBy: item.createdBy,
          })),
        )
        .returning();

      return rows.map(rowToToolCapabilityBinding);
    },

    async findByVersionId(ontologyVersionId) {
      const rows = await resolvedDb
        .select()
        .from(ontologyToolCapabilityBindings)
        .where(eq(ontologyToolCapabilityBindings.ontologyVersionId, ontologyVersionId))
        .orderBy(
          asc(ontologyToolCapabilityBindings.boundStepTemplateKey),
          asc(ontologyToolCapabilityBindings.priority),
        );

      return rows.map(rowToToolCapabilityBinding);
    },
  };
}
