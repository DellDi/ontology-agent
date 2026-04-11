import { desc } from 'drizzle-orm';

import type { AuditEventStore } from '@/application/audit/ports';
import type { AuditEvent } from '@/domain/audit/models';
import {
  createPostgresDb,
  type PostgresDb,
} from '@/infrastructure/postgres/client';
import { auditEvents } from '@/infrastructure/postgres/schema/audit-events';

function rowToAuditEvent(row: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    sessionId: row.sessionId,
    eventType: row.eventType as AuditEvent['eventType'],
    eventResult: row.eventResult as AuditEvent['eventResult'],
    eventSource: row.eventSource as AuditEvent['eventSource'],
    correlationId: row.correlationId,
    payload: row.payload as AuditEvent['payload'],
    createdAt: row.createdAt.toISOString(),
    retentionUntil: row.retentionUntil.toISOString(),
  };
}

export function createPostgresAuditEventStore(
  db?: PostgresDb,
): AuditEventStore {
  const resolvedDb = db ?? createPostgresDb().db;

  return {
    async create(event) {
      await resolvedDb.insert(auditEvents).values({
        id: event.id,
        userId: event.userId,
        organizationId: event.organizationId,
        sessionId: event.sessionId,
        eventType: event.eventType,
        eventResult: event.eventResult,
        eventSource: event.eventSource,
        correlationId: event.correlationId,
        payload: event.payload,
        createdAt: new Date(event.createdAt),
        retentionUntil: new Date(event.retentionUntil),
      });

      return event;
    },

    async listRecent({ limit = 50 }: { limit?: number } = {}) {
      const rows = await resolvedDb
        .select()
        .from(auditEvents)
        .orderBy(desc(auditEvents.createdAt))
        .limit(Math.max(1, Math.min(limit, 100)));

      return rows.map(rowToAuditEvent);
    },
  };
}
