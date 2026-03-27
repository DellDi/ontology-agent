import {
  extractAnalysisContext,
  applyContextCorrection,
  ContextCorrectionError,
  type AnalysisContext,
  type ContextCorrection,
  type VersionedAnalysisContext,
} from '@/domain/analysis-context/models';

import type { AnalysisContextStore } from './ports';

export type AnalysisContextReadModel = {
  sessionId: string;
  version: number;
  context: AnalysisContext;
  canUndo: boolean;
  originalQuestionText: string;
};

type AnalysisContextUseCasesDependencies = {
  analysisContextStore: AnalysisContextStore;
};

export function createAnalysisContextUseCases(
  deps?: AnalysisContextUseCasesDependencies,
) {
  const store = deps?.analysisContextStore;

  return {
    buildContextReadModel({
      sessionId,
      questionText,
    }: {
      sessionId: string;
      questionText: string;
    }): AnalysisContextReadModel {
      return {
        sessionId,
        version: 0,
        context: extractAnalysisContext(questionText),
        canUndo: false,
        originalQuestionText: questionText,
      };
    },

    async getCurrentContext({
      sessionId,
      questionText,
      savedContext,
    }: {
      sessionId: string;
      questionText: string;
      savedContext?: AnalysisContext;
    }): Promise<AnalysisContextReadModel> {
      if (!store) {
        return {
          sessionId,
          version: 0,
          context: savedContext ?? extractAnalysisContext(questionText),
          canUndo: false,
          originalQuestionText: questionText,
        };
      }

      const latest = await store.getLatest(sessionId);

      if (!latest) {
        return {
          sessionId,
          version: 0,
          context: savedContext ?? extractAnalysisContext(questionText),
          canUndo: false,
          originalQuestionText: questionText,
        };
      }

      return {
        sessionId,
        version: latest.version,
        context: latest.context,
        canUndo: latest.version > 1,
        originalQuestionText: latest.originalQuestionText,
      };
    },

    async initializeContext({
      sessionId,
      ownerUserId,
      questionText,
      initialContext,
    }: {
      sessionId: string;
      ownerUserId: string;
      questionText: string;
      initialContext?: AnalysisContext;
    }): Promise<VersionedAnalysisContext> {
      if (!store) {
        throw new ContextCorrectionError('上下文存储未配置。');
      }

      const existing = await store.getLatest(sessionId);

      if (existing) {
        return existing;
      }

      const versionedContext: VersionedAnalysisContext = {
        sessionId,
        ownerUserId,
        version: 1,
        context: initialContext ?? extractAnalysisContext(questionText),
        originalQuestionText: questionText,
        createdAt: new Date().toISOString(),
      };

      await store.save(versionedContext);

      return versionedContext;
    },

    async correctContext({
      sessionId,
      ownerUserId,
      correction,
    }: {
      sessionId: string;
      ownerUserId: string;
      correction: ContextCorrection;
    }): Promise<VersionedAnalysisContext> {
      if (!store) {
        throw new ContextCorrectionError('上下文存储未配置。');
      }

      const latest = await store.getLatest(sessionId);

      if (!latest) {
        throw new ContextCorrectionError('会话上下文尚未初始化。');
      }

      if (latest.ownerUserId !== ownerUserId) {
        throw new ContextCorrectionError('无权修改此会话的上下文。');
      }

      const correctedContext = applyContextCorrection(
        latest.context,
        correction,
      );

      const newVersion: VersionedAnalysisContext = {
        sessionId,
        ownerUserId,
        version: latest.version + 1,
        context: correctedContext,
        originalQuestionText: latest.originalQuestionText,
        createdAt: new Date().toISOString(),
      };

      await store.save(newVersion);

      return newVersion;
    },

    async undoCorrection({
      sessionId,
      ownerUserId,
    }: {
      sessionId: string;
      ownerUserId: string;
    }): Promise<VersionedAnalysisContext> {
      if (!store) {
        throw new ContextCorrectionError('上下文存储未配置。');
      }

      const latest = await store.getLatest(sessionId);

      if (!latest) {
        throw new ContextCorrectionError('会话上下文尚未初始化。');
      }

      if (latest.ownerUserId !== ownerUserId) {
        throw new ContextCorrectionError('无权修改此会话的上下文。');
      }

      if (latest.version <= 1) {
        throw new ContextCorrectionError(
          '已经是初始版本，无法继续撤销。',
        );
      }

      const previous = await store.getByVersion(
        sessionId,
        latest.version - 1,
      );

      if (!previous) {
        throw new ContextCorrectionError('上一版本不存在。');
      }

      const restoredVersion: VersionedAnalysisContext = {
        sessionId,
        ownerUserId,
        version: latest.version + 1,
        context: previous.context,
        originalQuestionText: previous.originalQuestionText,
        createdAt: new Date().toISOString(),
      };

      await store.save(restoredVersion);

      return restoredVersion;
    },
  };
}
