import {
  extractAnalysisContext,
  applyContextCorrection,
  ContextCorrectionError,
  resolveStoredAnalysisContext,
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
          context: resolveStoredAnalysisContext(questionText, savedContext),
          canUndo: false,
          originalQuestionText: questionText,
        };
      }

      const latest = await store.getLatest(sessionId);

      if (!latest) {
        return {
          sessionId,
          version: 0,
          context: resolveStoredAnalysisContext(questionText, savedContext),
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
        context: resolveStoredAnalysisContext(questionText, initialContext),
        originalQuestionText: questionText,
        createdAt: new Date().toISOString(),
      };

      await store.save(versionedContext);

      return versionedContext;
    },

    /**
     * 仅在用户未手动修正过上下文时（version === 1），用更精确的 context 替换初始版本。
     * 用于 LLM 抽取结果覆盖规则抽取的 savedContext。
     *
     * 返回：
     * - replaced=true: 成功替换了 version 1
     * - replaced=false: 用户已修正过（version > 1），保持不动
     */
    async replaceInitialContextIfUnmodified({
      sessionId,
      ownerUserId,
      questionText,
      newContext,
    }: {
      sessionId: string;
      ownerUserId: string;
      questionText: string;
      newContext: AnalysisContext;
    }): Promise<{ replaced: boolean; context: VersionedAnalysisContext }> {
      if (!store) {
        throw new ContextCorrectionError('上下文存储未配置。');
      }

      const existing = await store.getLatest(sessionId);

      if (!existing) {
        // 没有上下文，直接初始化
        const versionedContext: VersionedAnalysisContext = {
          sessionId,
          ownerUserId,
          version: 1,
          context: newContext,
          originalQuestionText: questionText,
          createdAt: new Date().toISOString(),
        };
        await store.save(versionedContext);
        return { replaced: true, context: versionedContext };
      }

      if (existing.version > 1) {
        // 用户已手动修正过，不覆盖
        return { replaced: false, context: existing };
      }

      if (existing.ownerUserId !== ownerUserId) {
        throw new ContextCorrectionError('无权修改此会话的上下文。');
      }

      // version === 1 且用户未修正，替换为 LLM 抽取结果
      const replaced: VersionedAnalysisContext = {
        sessionId,
        ownerUserId,
        version: 2,
        context: newContext,
        originalQuestionText: questionText,
        createdAt: new Date().toISOString(),
      };

      await store.save(replaced);
      return { replaced: true, context: replaced };
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
