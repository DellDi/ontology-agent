import { randomUUID } from 'node:crypto';

import {
  type AnalysisSession,
  normalizeQuestionText,
  validateQuestionText,
} from '@/domain/analysis-session/models';
import type { AuthSession } from '@/domain/auth/models';

import type { AnalysisSessionStore } from './ports';

export class InvalidAnalysisQuestionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAnalysisQuestionError';
  }
}

type AnalysisSessionUseCasesDependencies = {
  analysisSessionStore: AnalysisSessionStore;
};

export function createAnalysisSessionUseCases({
  analysisSessionStore,
}: AnalysisSessionUseCasesDependencies) {
  return {
    async createSession({
      questionText,
      owner,
    }: {
      questionText: string;
      owner: AuthSession;
    }) {
      const validationMessage = validateQuestionText(questionText);

      if (validationMessage) {
        throw new InvalidAnalysisQuestionError(validationMessage);
      }

      const timestamp = new Date().toISOString();
      const session: AnalysisSession = {
        id: randomUUID(),
        ownerUserId: owner.userId,
        questionText: normalizeQuestionText(questionText),
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return await analysisSessionStore.create(session);
    },

    async getOwnedSession({
      sessionId,
      ownerUserId,
    }: {
      sessionId: string;
      ownerUserId: string;
    }) {
      const session = await analysisSessionStore.getById(sessionId);

      if (!session || session.ownerUserId !== ownerUserId) {
        return null;
      }

      return session;
    },

    async listOwnedSessions(ownerUserId: string) {
      return await analysisSessionStore.listByOwner(ownerUserId);
    },
  };
}
