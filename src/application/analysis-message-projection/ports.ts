import type {
  AnalysisUiMessageProjectionRecord,
  AnalysisUiMessageProjectionScope,
} from '@/domain/analysis-message-projection/models';

export type AnalysisUiMessageProjectionStore = {
  save(
    record: AnalysisUiMessageProjectionRecord,
  ): Promise<AnalysisUiMessageProjectionRecord>;
  getByScope(
    scope: AnalysisUiMessageProjectionScope,
  ): Promise<AnalysisUiMessageProjectionRecord | null>;
};
