import { index, jsonb, text, timestamp } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyMetricDefinitions = platformSchema.table(
  'ontology_metric_definitions',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id').notNull(),
    businessKey: text('business_key').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    status: text('status').notNull(),
    applicableSubjectKeys: text('applicable_subject_keys').array().notNull().default([]),
    defaultAggregation: text('default_aggregation'),
    unit: text('unit'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_metric_defs_version_idx').on(table.ontologyVersionId),
    index('ontology_metric_defs_business_key_idx').on(table.businessKey),
    index('ontology_metric_defs_version_key_idx').on(
      table.ontologyVersionId,
      table.businessKey,
    ),
    index('ontology_metric_defs_status_idx').on(table.status),
  ],
);
