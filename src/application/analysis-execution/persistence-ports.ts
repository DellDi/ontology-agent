import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';

export type AnalysisExecutionSnapshotStore = {
  save(snapshot: AnalysisExecutionSnapshot): Promise<AnalysisExecutionSnapshot>;
  getLatestBySessionId(sessionId: string): Promise<AnalysisExecutionSnapshot | null>;
  getLatestBySessionIds(sessionIds: string[]): Promise<Map<string, AnalysisExecutionSnapshot>>;
  listBySessionId(sessionId: string): Promise<AnalysisExecutionSnapshot[]>;
  getByExecutionId(executionId: string): Promise<AnalysisExecutionSnapshot | null>;
};
