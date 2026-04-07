import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

export type AnalysisExecutionEventStore = {
  append(input: {
    sessionId: string;
    executionId: string;
    kind: AnalysisExecutionStreamEvent['kind'];
    status?: AnalysisExecutionStreamEvent['status'];
    message?: string;
    step?: AnalysisExecutionStreamEvent['step'];
    stage?: AnalysisExecutionStreamEvent['stage'];
    renderBlocks: AnalysisExecutionStreamEvent['renderBlocks'];
    metadata?: Record<string, unknown>;
  }): Promise<AnalysisExecutionStreamEvent>;
  listBySession(sessionId: string): Promise<AnalysisExecutionStreamEvent[]>;
};
