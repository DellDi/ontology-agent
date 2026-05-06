import type { AnalysisExecutionPlanSnapshot } from '@/domain/analysis-execution/models';
import type { AnalysisExecutionStreamEvent, ExecutionRenderBlock } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import type { JobStatus } from '@/domain/job-contract/models';
import type { OntologyVersionBinding } from '@/domain/ontology/version-binding';

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

export type AnalysisExecutionSnapshot = {
  executionId: string;
  sessionId: string;
  ownerUserId: string;
  followUpId: string | null;
  ontologyVersionId: string | null;
  ontologyVersionBinding: OntologyVersionBinding;
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
