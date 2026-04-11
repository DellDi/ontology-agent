import { integer, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyPlanStepTemplates = platformSchema.table(
  'ontology_plan_step_templates',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    intentTypes: text('intent_types').array().notNull().default([]),
    requiredCapabilities: text('required_capabilities').array().notNull().default([]),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_plan_step_tmpl_version_idx').on(table.ontologyVersionId),
    index('ontology_plan_step_tmpl_business_key_idx').on(table.businessKey),
    index('ontology_plan_step_tmpl_version_key_idx').on(
      table.ontologyVersionId,
      table.businessKey,
    ),
    index('ontology_plan_step_tmpl_status_idx').on(table.status),
  ],
);
