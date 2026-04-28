import {
  index,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

import { platformSchema } from './auth-sessions';
import { ontologyChangeRequests } from './ontology-change-requests';

export const ontologyApprovalRecords = platformSchema.table(
  'ontology_approval_records',
  {
    id: text('id').primaryKey(),
    changeRequestId: text('change_request_id')
      .notNull()
      .references(() => ontologyChangeRequests.id, { onDelete: 'cascade' }),
    decision: text('decision').notNull(),
    reviewedBy: text('reviewed_by').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('ontology_approval_records_change_request_id_idx').on(table.changeRequestId),
    index('ontology_approval_records_reviewed_by_idx').on(table.reviewedBy),
    index('ontology_approval_records_decision_idx').on(table.decision),
  ],
);
