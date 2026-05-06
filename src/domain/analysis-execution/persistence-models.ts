import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type { AnalysisExecutionStreamEvent, ExecutionRenderBlock } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { JobStatus } from '@/domain/job-contract/models';

export type AnalysisExecutionFailurePoint = {
  id: string;
  order: number;
  title: string;
};

export type AnalysisExecutionMobileProjection = {
  summary: string;
  status: JobStatus;
  updatedAt: string;
};

export type OntologyVersionBindingSource =
  | 'grounded-context'
  | 'inherited'
  | 'switched'
  | 'legacy-unknown';

export type OntologyVersionBinding = {
  ontologyVersionId: string | null;
  source: OntologyVersionBindingSource;
};

export function resolveOntologyVersionBindingSource(
  previousVersionId: string | null,
  nextVersionId: string | null,
): OntologyVersionBindingSource {
  if (!nextVersionId) {
    return 'legacy-unknown';
  }

  if (!previousVersionId) {
    return 'grounded-context';
  }

  return previousVersionId !== nextVersionId ? 'switched' : 'inherited';
}

export type AnalysisExecutionSnapshot = {
  executionId: string;
  sessionId: string;
  ownerUserId: string;
  followUpId: string | null;
  ontologyVersionId: string | null;
  ontologyVersionSource: OntologyVersionBindingSource;
  status: JobStatus;
  planSnapshot: AnalysisExecutionPlanSnapshot;
  stepResults: AnalysisExecutionStreamEvent[];
  conclusionState: AnalysisConclusionReadModel;
  resultBlocks: ExecutionRenderBlock[];
  mobileProjection: AnalysisExecutionMobileProjection;
  failurePoint: AnalysisExecutionFailurePoint | null;
  createdAt: string;
  updatedAt: string;
};
