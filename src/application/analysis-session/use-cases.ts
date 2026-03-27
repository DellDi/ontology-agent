import { randomUUID } from 'node:crypto';

import {
  type AnalysisSession,
  getMissingScopedTargetsMessage,
  isSessionAccessibleInScope,
  normalizeQuestionText,
  validateQuestionText,
} from '@/domain/analysis-session/models';
import { extractAnalysisContext } from '@/domain/analysis-context/models';
import { hasScopedTargets, type AuthSession } from '@/domain/auth/models';

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

      if (!hasScopedTargets(owner)) {
        throw new InvalidAnalysisQuestionError(
          getMissingScopedTargetsMessage(),
        );
      }

      const timestamp = new Date().toISOString();
      const normalizedQuestionText = normalizeQuestionText(questionText);
      const session: AnalysisSession = {
        id: randomUUID(),
        ownerUserId: owner.userId,
        organizationId: owner.scope.organizationId,
        projectIds: [...owner.scope.projectIds],
        areaIds: [...owner.scope.areaIds],
        questionText: normalizedQuestionText,
        savedContext: extractAnalysisContext(normalizedQuestionText),
        status: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      return await analysisSessionStore.create(session);
    },

    async getOwnedSession({
      sessionId,
      owner,
    }: {
      sessionId: string;
      owner: AuthSession;
    }) {
      const session = await analysisSessionStore.getById(sessionId);

      if (!session) {
        return null;
      }

      if (session.ownerUserId !== owner.userId) {
        return null;
      }

      if (
        !isSessionAccessibleInScope(session, {
          userId: owner.userId,
          scope: owner.scope,
        })
      ) {
        return null;
      }

      return session;
    },

    async listOwnedSessions(owner: AuthSession) {
      const sessions = await analysisSessionStore.listByOwner(owner.userId);

      return sessions.filter((session) =>
        isSessionAccessibleInScope(session, {
          userId: owner.userId,
          scope: owner.scope,
        }),
      );
    },

    async deleteOwnedSession({
      sessionId,
      owner,
    }: {
      sessionId: string;
      owner: AuthSession;
    }) {
      const session = await analysisSessionStore.getById(sessionId);

      if (!session) {
        return;
      }

      if (session.ownerUserId !== owner.userId) {
        return;
      }

      if (
        !isSessionAccessibleInScope(session, {
          userId: owner.userId,
          scope: owner.scope,
        })
      ) {
        return;
      }

      await analysisSessionStore.delete(sessionId);
    },
  };
}
