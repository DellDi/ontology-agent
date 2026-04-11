import { randomUUID } from 'node:crypto';

import {
  sanitizeAuditPayload,
  type AuditEvent,
  type AuditEventResult,
  type AuditEventSource,
  type AuditEventType,
} from '@/domain/audit/models';

import type { AuditEventStore } from './ports';

const RETENTION_WINDOW_DAYS = 180;
const RETENTION_WINDOW_MS = RETENTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

type AuditUseCasesDependencies = {
  auditEventStore: AuditEventStore;
  now?: () => Date;
};

export function createAuditUseCases({
  auditEventStore,
  now = () => new Date(),
}: AuditUseCasesDependencies) {
  return {
    async recordEvent(input: {
      userId: string;
      organizationId: string;
      sessionId?: string | null;
      eventType: AuditEventType;
      eventResult: AuditEventResult;
      eventSource: AuditEventSource;
      correlationId?: string;
      payload?: unknown;
    }) {
      const createdAtDate = now();
      const retentionUntilDate = new Date(
        createdAtDate.getTime() + RETENTION_WINDOW_MS,
      );
      const event: AuditEvent = {
        id: randomUUID(),
        userId: input.userId,
        organizationId: input.organizationId,
        sessionId: input.sessionId ?? null,
        eventType: input.eventType,
        eventResult: input.eventResult,
        eventSource: input.eventSource,
        correlationId: input.correlationId ?? randomUUID(),
        payload: sanitizeAuditPayload(input.payload ?? {}),
        createdAt: createdAtDate.toISOString(),
        retentionUntil: retentionUntilDate.toISOString(),
      };

      return await auditEventStore.create(event);
    },

    async listRecentEvents({ limit = 50 }: { limit?: number } = {}) {
      return await auditEventStore.listRecent({ limit });
    },
  };
}
