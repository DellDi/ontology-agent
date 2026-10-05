import type { AnalysisObjectSelection } from '@/domain/analysis-execution/object-selection';
import { javaSchemeAssessmentRequestSchema, javaSchemeAssessmentResultSchema } from './scheme-assessment-contract';

export async function assessAnalysisScheme(sessionId: string, selection: AnalysisObjectSelection) {
  const body = javaSchemeAssessmentRequestSchema.parse(selection);
  const response = await fetch(`/api/analysis/sessions/${encodeURIComponent(sessionId)}/objects/assess`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as { error?: string; traceId?: string };
    throw new Error(`${error.error ?? '方案评估失败。'}${error.traceId ? `（追踪 ID：${error.traceId}）` : ''}`);
  }
  const parsed = javaSchemeAssessmentResultSchema.parse(result);
  const selected = parsed.selection;
  if (selected.executionId !== body.executionId || selected.datasetVersionSetId !== body.datasetVersionSetId
    || selected.reference.objectId !== body.reference.objectId || selected.reference.productVersionId !== body.reference.productVersionId) {
    throw new Error('评估响应与选中的冻结区域不一致。');
  }
  return parsed;
}
