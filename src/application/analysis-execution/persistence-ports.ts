import type { AnalysisExecutionSnapshot } from '@/domain/analysis-execution/persistence-models';

export type AnalysisExecutionSnapshotSummary = Pick<
  AnalysisExecutionSnapshot,
  | 'sessionId'
  | 'executionId'
  | 'status'
  | 'conclusionState'
  | 'failurePoint'
  | 'updatedAt'
>;

export type AnalysisExecutionSnapshotHistorySummary = Pick<
  AnalysisExecutionSnapshot,
  | 'executionId'
  | 'sessionId'
  | 'ownerUserId'
  | 'followUpId'
  | 'ontologyVersionId'
  | 'ontologyVersionBinding'
  | 'status'
  | 'planSnapshot'
  | 'conclusionState'
  | 'failurePoint'
  | 'createdAt'
  | 'updatedAt'
>;

export type AnalysisExecutionSnapshotStore = {
  save(snapshot: AnalysisExecutionSnapshot): Promise<AnalysisExecutionSnapshot>;
  getLatestBySessionId(sessionId: string): Promise<AnalysisExecutionSnapshot | null>;
  getLatestBySessionIds(sessionIds: string[]): Promise<Map<string, AnalysisExecutionSnapshot>>;
  getLatestSummariesBySessionIds(sessionIds: string[]): Promise<Map<string, AnalysisExecutionSnapshotSummary>>;
  listBySessionId(sessionId: string): Promise<AnalysisExecutionSnapshot[]>;
  listSummariesBySessionId(sessionId: string): Promise<AnalysisExecutionSnapshotHistorySummary[]>;
  getByExecutionId(executionId: string): Promise<AnalysisExecutionSnapshot | null>;
};
