import { javaObjectReadRequestSchema, javaObjectReadResultSchema, type JavaObjectReadRequest } from './object-read-contract';

export async function readAnalysisObjects(sessionId: string, request: JavaObjectReadRequest, signal: AbortSignal) {
  const body = javaObjectReadRequestSchema.parse(request);
  const response = await fetch(`/api/analysis/sessions/${encodeURIComponent(sessionId)}/objects/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = result as { error?: string; code?: string; traceId?: string };
    throw new Error(`${error.error ?? '对象读取失败。'}${error.traceId ? `（追踪 ID：${error.traceId}）` : ''}`);
  }
  const parsed = javaObjectReadResultSchema.parse(result);
  if (parsed.executionId !== body.executionId || parsed.datasetVersionSetId !== body.datasetVersionSetId) {
    throw new Error('对象响应与来源执行版本不一致。');
  }
  return parsed;
}
