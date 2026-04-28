import { sql } from 'drizzle-orm';
import {
  index,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';
import { ontologyVersions } from './ontology-versions';

export const ontologyPublishRecords = platformSchema.table(
  'ontology_publish_records',
  {
    id: text('id').primaryKey(),
    ontologyVersionId: text('ontology_version_id')
      .notNull()
      .references(() => ontologyVersions.id, { onDelete: 'cascade' }),
    publishedBy: text('published_by').notNull(),
    previousVersionId: text('previous_version_id'),
    changeRequestIds: text('change_request_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    publishNote: text('publish_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_publish_records_version_id_idx').on(table.ontologyVersionId),
    index('ontology_publish_records_published_by_idx').on(table.publishedBy),
  ],
);
