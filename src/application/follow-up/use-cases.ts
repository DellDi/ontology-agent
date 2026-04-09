import { randomUUID } from 'node:crypto';

import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';
import {
  mergeFollowUpContext,
  type AnalysisSessionFollowUp,
} from '@/domain/analysis-session/follow-up-models';
import {
  normalizeQuestionText,
  type AnalysisSession,
  validateQuestionText,
} from '@/domain/analysis-session/models';

import type { AnalysisSessionFollowUpStore } from './ports';

export class InvalidAnalysisFollowUpQuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisFollowUpQuestionError';
  }
}

export class MissingAnalysisConclusionForFollowUpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingAnalysisConclusionForFollowUpError';
  }
}

export function createAnalysisFollowUpUseCases({
  followUpStore,
}: {
  followUpStore: AnalysisSessionFollowUpStore;
}) {
  return {
    async createFollowUp({
      session,
      questionText,
      currentContextReadModel,
      latestSnapshot,
    }: {
      session: AnalysisSession;
      questionText: string;
      currentContextReadModel: AnalysisContextReadModel;
      latestSnapshot: AnalysisExecutionSnapshot | null;
    }) {
      const validationMessage = validateQuestionText(questionText);

      if (validationMessage) {
        throw new InvalidAnalysisFollowUpQuestionError(validationMessage);
      }

      const latestConclusion = latestSnapshot?.conclusionState?.causes?.[0] ?? null;

      if (!latestSnapshot || !latestConclusion) {
        throw new MissingAnalysisConclusionForFollowUpError(
          '当前会话还没有可承接的既有结论，无法发起追问。',
        );
      }

      const normalizedQuestionText = normalizeQuestionText(questionText);
      const timestamp = new Date().toISOString();
      const followUp: AnalysisSessionFollowUp = {
        id: randomUUID(),
        sessionId: session.id,
        ownerUserId: session.ownerUserId,
        questionText: normalizedQuestionText,
        referencedExecutionId: latestSnapshot.executionId,
        referencedConclusionTitle: latestConclusion.title,
        referencedConclusionSummary: latestConclusion.summary,
        inheritedContext: currentContextReadModel.context,
        mergedContext: mergeFollowUpContext({
          inheritedContext: currentContextReadModel.context,
          followUpQuestionText: normalizedQuestionText,
        }),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return await followUpStore.create(followUp);
    },

    async listOwnedFollowUps({
      sessionId,
      ownerUserId,
    }: {
      sessionId: string;
      ownerUserId: string;
    }) {
      return await followUpStore.listBySessionId({
        sessionId,
        ownerUserId,
      });
    },
  };
}
