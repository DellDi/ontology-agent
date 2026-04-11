import { createAuditUseCases } from '@/application/audit/use-cases';

import { createPostgresAuditEventStore } from './postgres-audit-event-store';

export const auditUseCases = createAuditUseCases({
  auditEventStore: createPostgresAuditEventStore(),
});
