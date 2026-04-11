import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyEntityDefinitions = platformSchema.table(
  'ontology_entity_definitions',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    synonyms: text('synonyms').array().notNull().default([]),
    parentBusinessKey: text('parent_business_key'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_entity_defs_version_idx').on(table.ontologyVersionId),
    index('ontology_entity_defs_business_key_idx').on(table.businessKey),
    index('ontology_entity_defs_version_key_idx').on(
      table.ontologyVersionId,
      table.businessKey,
    ),
    index('ontology_entity_defs_status_idx').on(table.status),
  ],
);
