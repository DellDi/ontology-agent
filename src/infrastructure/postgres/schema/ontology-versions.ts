import { sql } from 'drizzle-orm';
import { index, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';

export const ontologyVersions = platformSchema.table(
  'ontology_versions',
  {
    id: text('id').primaryKey(),
    semver: text('semver').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull(),
    description: text('description'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_versions_status_idx').on(table.status),
    index('ontology_versions_published_at_idx').on(table.publishedAt),
    uniqueIndex('ontology_versions_single_current_uidx')
      .on(table.status)
      .where(sql`status = 'approved' and published_at is not null`),
  ],
);
