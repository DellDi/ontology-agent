import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';
import { ontologyVersions } from './ontology-versions';

export const ontologyChangeRequests = platformSchema.table(
  'ontology_change_requests',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id')
      .notNull()
      .references(() => ontologyVersions.id, { onDelete: 'cascade' }),
    targetObjectType: text('target_object_type').notNull(),
    targetObjectKey: text('target_object_key').notNull(),
    changeType: text('change_type').notNull(),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    description: text('description'),
    beforeSummary: jsonb('before_summary'),
    afterSummary: jsonb('after_summary'),
    impactScope: text('impact_scope')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    compatibilityType: text('compatibility_type').notNull(),
    compatibilityNote: text('compatibility_note'),
    submittedBy: text('submitted_by').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_change_requests_version_id_idx').on(table.ontologyVersionId),
    index('ontology_change_requests_status_idx').on(table.status),
    index('ontology_change_requests_submitted_by_idx').on(table.submittedBy),
    index('ontology_change_requests_target_idx').on(
      table.targetObjectType,
      table.targetObjectKey,
    ),
  ],
);
