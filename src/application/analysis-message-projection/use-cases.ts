import {
  AI_RUNTIME_CONTRACT_VERSION,
  AI_RUNTIME_SCHEMA_VERSION,
  assertAiRuntimeVersions,
  buildAiRuntimeProjection,
  type AiRuntimeMessage,
  type AiRuntimeProjection,
} from '@/application/ai-runtime';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import {
  ANALYSIS_UI_MESSAGE_PROJECTION_VERSION,
  assertAnalysisUiMessageProjectionScope,
  createAnalysisUiMessageProjectionCursor,
  normalizeAnalysisUiMessageProjectionScope,
  resolveAnalysisUiMessageProjectionId,
  type AnalysisUiMessageProjectionRecord,
  type AnalysisUiMessageProjectionRecoveryMetadata,
  type AnalysisUiMessageProjectionScope,
  type AnalysisUiMessageProjectionStreamCursor,
} from '@/domain/analysis-message-projection/models';

import type { AnalysisUiMessageProjectionStore } from './ports';

export type AnalysisUiMessageProjectionHydrationResult = {
  source: 'persisted' | 'rebuilt-from-canonical';
  projection: AiRuntimeProjection;
  record: AnalysisUiMessageProjectionRecord;
  resumeCursor: AnalysisUiMessageProjectionStreamCursor;
  rebuildReason?: string;
};

function messageToRecordMessage(
  message: AiRuntimeMessage,
): AnalysisUiMessageProjectionRecord['messages'][number] {
  return {
    id: message.id,
    role: message.role,
    parts: message.parts as unknown as Record<string, unknown>[],
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function recordToProjection(
  record: AnalysisUiMessageProjectionRecord,
): AiRuntimeProjection {
  if (record.projectionVersion !== ANALYSIS_UI_MESSAGE_PROJECTION_VERSION) {
    throw new Error(
      `analysis-ui-message-projection version mismatch: field=projectionVersion, expected=${ANALYSIS_UI_MESSAGE_PROJECTION_VERSION}, actual=${record.projectionVersion}`,
    );
  }

  assertAiRuntimeVersions(
    {
      schemaVersion: record.partSchemaVersion,
      contractVersion: record.contractVersion,
    },
    {
      schemaVersion: AI_RUNTIME_SCHEMA_VERSION,
      contractVersion: AI_RUNTIME_CONTRACT_VERSION,
    },
  );

  assertValidRecordMessages(record.messages);
  assertValidRecordCursor(record.streamCursor);

  return {
    sessionId: record.sessionId,
    executionId: record.executionId,
    status: record.status,
    lastSequence: record.streamCursor.lastSequence,
    isTerminal: record.isTerminal,
    messages: record.messages as unknown as AiRuntimeProjection['messages'],
    schemaVersion: record.partSchemaVersion,
    contractVersion: record.contractVersion,
  };
}

function assertValidRecordMessages(
  messages: AnalysisUiMessageProjectionRecord['messages'],
) {
  if (!Array.isArray(messages)) {
    throw new Error('analysis-ui-message-projection messages must be an array');
  }

  messages.forEach((message, index) => {
    if (!message || typeof message !== 'object') {
      throw new Error(
        `analysis-ui-message-projection message[${index}] must be an object`,
      );
    }
    if (typeof message.id !== 'string' || !message.id.trim()) {
      throw new Error(
        `analysis-ui-message-projection message[${index}].id must be a non-empty string`,
      );
    }
    if (!Array.isArray(message.parts)) {
      throw new Error(
        `analysis-ui-message-projection message[${index}].parts must be an array`,
      );
    }
  });
}

function assertValidRecordCursor(
  cursor: AnalysisUiMessageProjectionRecord['streamCursor'],
) {
  if (
    !cursor ||
    typeof cursor !== 'object' ||
    !Number.isSafeInteger(cursor.lastSequence) ||
    cursor.lastSequence < 0
  ) {
    throw new Error(
      'analysis-ui-message-projection streamCursor.lastSequence must be a non-negative integer',
    );
  }
}

function resolveRebuildReason(error: unknown) {
  if (!(error instanceof Error)) {
    return 'unknown projection validation failure';
  }
  if (/version mismatch/.test(error.message)) {
    return `version mismatch: ${error.message}`;
  }
  return error.message;
}

function buildRecord(input: {
  ownerUserId: string;
  followUpId?: string | null;
  historyRoundId?: string | null;
  projection: AiRuntimeProjection;
  lastEventId?: string | null;
  recoveryMetadata?: AnalysisUiMessageProjectionRecoveryMetadata;
}): AnalysisUiMessageProjectionRecord {
  const now = new Date().toISOString();
  const scope = normalizeAnalysisUiMessageProjectionScope({
    ownerUserId: input.ownerUserId,
    sessionId: input.projection.sessionId,
    executionId: input.projection.executionId,
    followUpId: input.followUpId,
    historyRoundId: input.historyRoundId,
  });

  return {
    ...scope,
    id: resolveAnalysisUiMessageProjectionId(scope),
    projectionVersion: ANALYSIS_UI_MESSAGE_PROJECTION_VERSION,
    partSchemaVersion: input.projection.schemaVersion,
    contractVersion: input.projection.contractVersion,
    status: input.projection.status,
    isTerminal: input.projection.isTerminal,
    streamCursor: createAnalysisUiMessageProjectionCursor({
      lastSequence: input.projection.lastSequence,
      lastEventId: input.lastEventId,
    }),
    messages: input.projection.messages.map(messageToRecordMessage),
    recoveryMetadata: {
      ...(input.recoveryMetadata ?? {}),
      savedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function hasCanonicalEvents(input: {
  events: readonly AnalysisExecutionStreamEvent[];
}) {
  return Array.isArray(input.events);
}

export function filterAnalysisUiMessageProjectionResumeEvents(
  events: readonly AnalysisExecutionStreamEvent[],
  cursor: AnalysisUiMessageProjectionStreamCursor,
) {
  return events
    .filter((event) => event.sequence > cursor.lastSequence)
    .sort((left, right) => left.sequence - right.sequence);
}

export function createAnalysisUiMessageProjectionUseCases({
  projectionStore,
}: {
  projectionStore: AnalysisUiMessageProjectionStore;
}) {
  async function saveProjection(input: {
    ownerUserId: string;
    followUpId?: string | null;
    historyRoundId?: string | null;
    projection: AiRuntimeProjection;
    lastEventId?: string | null;
    recoveryMetadata?: AnalysisUiMessageProjectionRecoveryMetadata;
  }) {
    return await projectionStore.save(buildRecord(input));
  }

  async function rebuildFromCanonical(input: {
    scope: AnalysisUiMessageProjectionScope;
    canonical: {
      events: readonly AnalysisExecutionStreamEvent[];
      fallbackConclusion?: AnalysisConclusionReadModel | null;
    };
    rebuildReason: string;
  }): Promise<AnalysisUiMessageProjectionHydrationResult> {
    const projection = buildAiRuntimeProjection({
      sessionId: input.scope.sessionId,
      executionId: input.scope.executionId,
      events: input.canonical.events,
      fallbackConclusion: input.canonical.fallbackConclusion,
    });
    const record = await saveProjection({
      ownerUserId: input.scope.ownerUserId,
      followUpId: input.scope.followUpId,
      historyRoundId: input.scope.historyRoundId,
      projection,
      lastEventId: input.canonical.events.at(-1)?.id ?? null,
      recoveryMetadata: {
        source: 'canonical-truth',
        rebuildReason: input.rebuildReason,
      },
    });

    return {
      source: 'rebuilt-from-canonical',
      projection,
      record,
      resumeCursor: record.streamCursor,
      rebuildReason: input.rebuildReason,
    };
  }

  return {
    saveProjection,

    async hydrateProjection(input: {
      ownerUserId: string;
      sessionId: string;
      executionId: string;
      followUpId?: string | null;
      historyRoundId?: string | null;
      canonical?: {
        events: readonly AnalysisExecutionStreamEvent[];
        fallbackConclusion?: AnalysisConclusionReadModel | null;
      } | null;
    }): Promise<AnalysisUiMessageProjectionHydrationResult | null> {
      const scope = normalizeAnalysisUiMessageProjectionScope(input);
      const persisted = await projectionStore.getByScope(scope);

      if (persisted) {
        assertAnalysisUiMessageProjectionScope(persisted, scope);

        try {
          const projection = recordToProjection(persisted);
          return {
            source: 'persisted',
            projection,
            record: persisted,
            resumeCursor: persisted.streamCursor,
          };
        } catch (error) {
          if (!input.canonical || !hasCanonicalEvents(input.canonical)) {
            throw error;
          }

          return await rebuildFromCanonical({
            scope,
            canonical: input.canonical,
            rebuildReason: resolveRebuildReason(error),
          });
        }
      }

      if (!input.canonical || !hasCanonicalEvents(input.canonical)) {
        return null;
      }

      return await rebuildFromCanonical({
        scope,
        canonical: input.canonical,
        rebuildReason: 'missing persisted projection',
      });
    },
  };
}
