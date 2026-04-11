import type { AuditEvent } from '@/domain/audit/models';

export interface AuditEventStore {
  create(event: AuditEvent): Promise<AuditEvent>;
  listRecent(params?: { limit?: number }): Promise<AuditEvent[]>;
}
