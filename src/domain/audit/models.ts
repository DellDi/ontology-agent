export const AUDIT_EVENT_TYPES = [
  'analysis.requested',
  'authorization.denied',
  'tool.invoked',
  'ontology.change_request.submitted',
  'ontology.change_request.approved',
  'ontology.change_request.rejected',
  'ontology.version.published',
] as const;

export const AUDIT_EVENT_RESULTS = ['succeeded', 'failed', 'denied'] as const;

export const AUDIT_EVENT_SOURCES = ['route-handler', 'application', 'worker'] as const;

const REDACTED_VALUE = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'apiKey',
  'apikey',
  'user_password',
  'userPassword',
]);

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];
export type AuditEventResult = (typeof AUDIT_EVENT_RESULTS)[number];
export type AuditEventSource = (typeof AUDIT_EVENT_SOURCES)[number];

export type AuditEventPayload =
  | string
  | number
  | boolean
  | null
  | AuditEventPayload[]
  | { [key: string]: AuditEventPayload };

export type AuditEvent = {
  id: string;
  userId: string;
  organizationId: string;
  sessionId: string | null;
  eventType: AuditEventType;
  eventResult: AuditEventResult;
  eventSource: AuditEventSource;
  correlationId: string;
  payload: AuditEventPayload;
  createdAt: string;
  retentionUntil: string;
};

function normalizePayloadValue(
  value: unknown,
  depth = 0,
): AuditEventPayload {
  if (depth > 4) {
    return '[TRUNCATED]';
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizePayloadValue(item, depth + 1));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        SENSITIVE_KEYS.has(key)
          ? REDACTED_VALUE
          : normalizePayloadValue(nestedValue, depth + 1),
      ]),
    );
  }

  return String(value);
}

export function sanitizeAuditPayload(payload: unknown): AuditEventPayload {
  return normalizePayloadValue(payload);
}

export function isAuditAdmin(roleCodes: string[]) {
  return roleCodes.includes('PLATFORM_ADMIN');
}
