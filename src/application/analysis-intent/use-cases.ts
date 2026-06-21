import { randomUUID } from 'node:crypto';

import {
  type AnalysisIntent,
  recognizeIntentFromQuestion,
} from '@/domain/analysis-intent/models';

import type { AnalysisIntentStore } from './ports';

type AnalysisIntentUseCasesDependencies = {
  analysisIntentStore: AnalysisIntentStore;
};

export function createAnalysisIntentUseCases({
  analysisIntentStore,
}: AnalysisIntentUseCasesDependencies) {
  async function recognizeAndStoreIntent({
    sessionId,
    questionText,
  }: {
    sessionId: string;
    questionText: string;
  }): Promise<AnalysisIntent> {
    const failureToken = process.env.FAIL_ANALYSIS_INTENT_FOR_TEST?.trim();

    if (failureToken && questionText.includes(failureToken)) {
      throw new Error('analysis-intent-test-failure');
    }

    const result = recognizeIntentFromQuestion(questionText);

    const intent: AnalysisIntent = {
      id: randomUUID(),
      sessionId,
      type: result.type,
      goal: result.goal,
      createdAt: new Date().toISOString(),
    };

    return await analysisIntentStore.save(intent);
  }

  return {
    recognizeAndStoreIntent,

    async getIntentBySessionId(
      sessionId: string,
    ): Promise<AnalysisIntent | null> {
      return await analysisIntentStore.getBySessionId(sessionId);
    },

    async getOrRecognizeIntent({
      sessionId,
      questionText,
    }: {
      sessionId: string;
      questionText: string;
    }): Promise<AnalysisIntent> {
      const existing = await analysisIntentStore.getBySessionId(sessionId);

      if (existing) {
        return existing;
      }

      return await recognizeAndStoreIntent({
        sessionId,
        questionText,
      });
    },
  };
}
