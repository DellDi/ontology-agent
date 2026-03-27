import type { VersionedAnalysisContext } from '@/domain/analysis-context/models';

export interface AnalysisContextStore {
  save(versionedContext: VersionedAnalysisContext): Promise<void>;
  getLatest(sessionId: string): Promise<VersionedAnalysisContext | null>;
  getByVersion(
    sessionId: string,
    version: number,
  ): Promise<VersionedAnalysisContext | null>;
  countVersions(sessionId: string): Promise<number>;
}
