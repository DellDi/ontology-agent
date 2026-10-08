import { z } from 'zod';
import type { PrototypeLayoutNode, PrototypeComponentGeometry } from '@/domain/prototype-layout/models';

const objectKey = z.enum(['easyv-prototype-layout', 'easyv-prototype-block', 'easyv-prototype-component']);
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const javaObjectSelectionSchema = z.object({
  executionId: z.string().min(1).max(500), datasetVersionSetId: z.string().min(1).max(500),
  reference: z.object({ objectKey, objectId: z.string().min(1).max(500), productVersionId: z.string().min(1).max(500) }).strict(),
}).strict();

export const javaObjectReadRequestSchema = z.object({
  executionId: z.string().min(1),
  datasetVersionSetId: z.string().min(1),
  objectKey,
  drilldownId: z.string().min(1).max(500).nullable().optional(),
  objectId: z.string().min(1).max(500).nullable().optional(),
  relation: z.string().min(1).nullable().optional(),
  filters: z.array(z.object({
    member: z.string().min(1),
    operator: z.enum(['EQUALS', 'NOT_EQUALS', 'CONTAINS', 'GT', 'GTE', 'LT', 'LTE', 'SET', 'NOT_SET']),
    values: z.array(z.string().min(1).max(500)).max(100),
  }).strict()).max(10).nullable().optional(),
  order: z.array(z.object({
    member: z.string().min(1), direction: z.enum(['ASC', 'DESC']),
  }).strict()).max(4).nullable().optional(),
  limit: z.number().int().min(1).max(200).nullable().optional(),
  offset: z.number().int().min(0).max(10000).nullable().optional(),
}).strict();

export const javaResultDrilldownSchema = z.object({
  id: z.string().min(1).max(500), row: z.number().int().min(0), column: z.number().int().min(0),
  objectKey, scopeDescription: z.string().min(1),
  filters: javaObjectReadRequestSchema.shape.filters.unwrap().unwrap(),
}).strict();

// 树由 Java 解析器生成，展示端不解析 XML，也不补造缺失几何。
export type JavaLayoutNode = PrototypeLayoutNode;
export const javaLayoutNodeSchema: z.ZodType<JavaLayoutNode> = z.lazy(() => z.object({
  tag: z.string().min(1),
  attributes: z.record(z.string(), z.string()),
  children: z.array(javaLayoutNodeSchema),
}).strict());

export const javaComponentGeometrySchema: z.ZodType<PrototypeComponentGeometry> = z.union([
  z.object({ status: z.literal('available'), errorCode: z.null(), box: z.object({
    x: z.number().min(0).max(100), y: z.number().min(0).max(100),
    width: z.number().positive().max(100), height: z.number().positive().max(100),
  }).strict().refine((box) => box.x + box.width <= 100 && box.y + box.height <= 100, '组件外框超出区域。') }).strict(),
  z.object({ status: z.enum(['missing', 'invalid']), errorCode: z.string().min(1), box: z.null() }).strict(),
]);

export const javaObjectReadResultSchema = z.object({
  executionId: z.string().min(1),
  datasetVersionSetId: z.string().min(1),
  ontologyVersionId: z.string().min(1),
  componentGeometry: z.record(z.string(), javaComponentGeometrySchema).optional(),
  objectType: z.object({
    key: objectKey, label: z.string().min(1),
    properties: z.array(z.object({ key: z.string().min(1), label: z.string().min(1),
      type: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'TIME']) }).strict()),
    links: z.array(z.object({ key: z.string().min(1), targetObjectKey: objectKey,
      targetLabel: z.string().min(1) }).strict()),
  }).strict(),
  page: z.object({
    objectKey,
    rows: z.array(z.object({
      reference: z.object({ objectKey, objectId: z.string().min(1), productVersionId: z.string().min(1) }).strict(),
      properties: z.record(z.string(), scalar),
    }).strict()),
    limit: z.number().int().min(1).max(200),
    offset: z.number().int().min(0).max(10000),
    hasMore: z.boolean(),
  }).strict(),
  structure: z.discriminatedUnion('status', [
    z.object({ status: z.literal('available'), layout: javaLayoutNodeSchema }).strict(),
    z.object({ status: z.literal('not_retained'), layout: z.null() }).strict(),
    z.object({ status: z.literal('parse_failed'), layout: z.null() }).strict(),
  ]).nullable(),
}).strict().superRefine((result, context) => {
  if (result.componentGeometry && Object.keys(result.componentGeometry).some((id) => result.page.objectKey !== 'easyv-prototype-component'
      || !result.page.rows.some((row) => row.reference.objectId === id))) {
    context.addIssue({ code: 'custom', message: '组件位置必须属于当前授权页面中的对象。' });
  }
  if (result.objectType.key !== result.page.objectKey) {
    context.addIssue({ code: 'custom', message: '对象声明与页面类型不一致。' });
  }
  if (result.page.rows.some((row) => row.reference.objectKey !== result.page.objectKey)) {
    context.addIssue({ code: 'custom', message: '返回对象引用与页面类型不一致。' });
  }
  if (result.page.rows.length > result.page.limit) {
    context.addIssue({ code: 'custom', message: '返回行数超过分页限制。' });
  }
  if (result.structure !== null && (result.page.objectKey !== 'easyv-prototype-layout' || result.page.rows.length !== 1)) {
    context.addIssue({ code: 'custom', message: '结构只能附在单个版式详情中。' });
  }
});

export type JavaObjectReadRequest = z.infer<typeof javaObjectReadRequestSchema>;
export type JavaObjectReadResult = z.infer<typeof javaObjectReadResultSchema>;
