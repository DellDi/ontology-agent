import { z } from 'zod';
import { javaWorkspaceCatalogResultSchema } from './object-read-contract';

export const workspaceCatalogRequestSchema = z.object({
  datasetVersionSetId: z.string().min(1).optional(),
  objectKey: z.enum(['easyv-prototype-layout', 'easyv-prototype-block', 'easyv-prototype-component']).optional(),
  objectId: z.string().min(1).max(500).optional(),
  relation: z.enum(['blocks', 'components']).optional(),
  search: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(10000).optional(),
}).strict();
// 与分析对象复用同一结果校验；目录没有分析执行，不伪造执行标识。
export const workspaceCatalogResultSchema = javaWorkspaceCatalogResultSchema;
export type WorkspaceCatalogRequest = z.infer<typeof workspaceCatalogRequestSchema>;
export type WorkspaceCatalogResult = z.infer<typeof workspaceCatalogResultSchema>;

export async function readWorkspaceCatalog(request: WorkspaceCatalogRequest, signal: AbortSignal) {
  const body = workspaceCatalogRequestSchema.parse(request);
  const response = await fetch('/api/easyv/workspace/prototypes/query', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const error = z.object({error:z.string(),traceId:z.string().optional()}).safeParse(result);
    throw new Error(error.success ? `${error.data.error}${error.data.traceId ? `（追踪 ID：${error.data.traceId}）` : ''}` : `大屏读取失败（${response.status}）。`);
  }
  const parsed = workspaceCatalogResultSchema.parse(result);
  if (body.datasetVersionSetId && parsed.datasetVersionSetId !== body.datasetVersionSetId) throw new Error('数据版本已变化，请刷新目录。');
  const expectedType = body.relation === 'blocks' ? 'easyv-prototype-block' : body.relation === 'components' ? 'easyv-prototype-component' : body.objectKey ?? 'easyv-prototype-layout';
  if (parsed.page.objectKey !== expectedType || body.objectId && !body.relation
      && (parsed.page.rows.length !== 1 || parsed.page.rows[0].reference.objectId !== body.objectId)) throw new Error('目录响应与所选对象不一致。');
  return parsed;
}
