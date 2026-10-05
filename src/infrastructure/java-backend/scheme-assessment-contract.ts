import { z } from 'zod';
import { javaObjectSelectionSchema } from './object-read-contract';

export const javaSchemeAssessmentRequestSchema = javaObjectSelectionSchema.extend({ reference: javaObjectSelectionSchema.shape.reference.extend({ objectKey: z.literal('easyv-prototype-block') }) }).strict();

const rect = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).strict();
const minimum = z.object({ width: z.number().positive(), height: z.number().positive() }).strict();
const geometry = z.object({ status: z.enum(['available', 'missing', 'invalid']), errorCode: z.string().nullable(), box: rect.nullable() }).strict();
const slot = z.object({ slotIndex: z.number().int().nonnegative(), internalId: z.string(), role: z.string(), weight: z.number().int(),
  position: z.object({ col: z.number().int(), row: z.number().int(), colSpan: z.number().int(), rowSpan: z.number().int() }).strict(),
  config: z.object({ x: z.union([z.string(), z.number()]).nullable(), y: z.union([z.string(), z.number()]).nullable(),
    width: z.union([z.string(), z.number()]).nullable(), height: z.union([z.string(), z.number()]).nullable() }).strict().nullable(),
  allowedChartCategories: z.array(z.string()).nullable(), recommendedGroups: z.array(z.string()).nullable(),
}).strict();
const candidate = z.object({ schemeId: z.string(), blockTypeId: z.string(), chartCount: z.number().int(),
  parseStatus: z.enum(['available', 'missing', 'invalid']), parseErrorCode: z.string().nullable(), slots: z.array(slot).nullable() }).strict();
const assessment = z.object({ schemeId: z.string().nullable(), status: z.enum(['feasible', 'infeasible', 'unassessable']), score: z.number().min(0).max(100).nullable(),
  assignments: z.array(z.object({ slotIndex: z.number().int().nonnegative(), componentId: z.string(), metricId: z.string(), chartFamily: z.string(),
    bounds: rect, minimum, readability: z.number().min(0).max(100), role: z.number().min(0).max(100), position: z.number().min(0).max(100) }).strict()),
  findings: z.array(z.object({ code: z.string(), message: z.string(), slotIndex: z.number().int().nullable(), componentId: z.string().nullable() }).strict()),
}).strict().superRefine((value, context) => {
  if (value.status === 'feasible' ? value.score === null || value.assignments.length === 0 || value.findings.length !== 0
    : value.score !== null || value.assignments.length !== 0 || value.findings.length === 0) {
    context.addIssue({ code: 'custom', message: '方案状态与评分、分配或原因不一致。' });
  }
});

export const javaSchemeAssessmentResultSchema = z.object({
  assessmentId: z.string().min(1), selection: javaObjectSelectionSchema, ontologyVersionId: z.string().min(1),
  productVersionIds: z.record(z.string(), z.string().min(1)), status: z.enum(['evaluated', 'unassessable']), reason: z.string().nullable(),
  geometry: z.object({ status: z.enum(['available', 'unavailable']), errorCode: z.string().nullable(), bounds: rect.nullable() }).strict().nullable(),
  candidateInputs: z.array(candidate).max(200),
  comparison: z.object({
    rules: z.object({ version: z.string(), calibration: z.literal('heuristic_pending_real_data_calibration'), normalization: z.string(), maxMetrics: z.number().int(),
      readabilityWeight: z.number().int(), roleWeight: z.number().int(), positionWeight: z.number().int(), inset: z.number(), titleReserve: z.number(), gap: z.number(),
      minimums: z.record(z.string(), minimum) }).strict(),
    input: z.object({ blockTypeId: z.string().nullable(), schemeId: z.string().nullable(), bounds: rect.nullable(), titlePresent: z.boolean().nullable(),
      metricBindingStatus: z.string().nullable(), metrics: z.array(z.object({ slotIndex: z.number().int(), componentId: z.string(), metricId: z.string(),
        chartFamily: z.string(), sceneType: z.string().nullable(), sourceType: z.string().nullable() }).strict()).nullable(),
      components: z.array(z.object({ componentId: z.string(), geometry: geometry.nullable() }).strict()).nullable(),
    }).strict(), current: assessment, candidates: z.array(assessment).max(200),
  }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if (value.selection.reference.objectKey !== 'easyv-prototype-block'
    || value.productVersionIds['easyv-prototype-block'] !== value.selection.reference.productVersionId) {
    context.addIssue({ code: 'custom', message: '评估引用与冻结区域版本不一致。' });
  }
  if (value.status === 'evaluated' && (value.reason !== null || value.comparison === null || !value.candidateInputs.length)) {
    context.addIssue({ code: 'custom', message: '已评估响应缺少输入或比较结果。' });
  }
  if (value.comparison !== null) {
    const inputs = new Set(value.candidateInputs.map((c) => c.schemeId));
    const results = new Set(value.comparison.candidates.map((c) => c.schemeId));
    if (inputs.size !== value.candidateInputs.length || results.size !== inputs.size || [...results].some((id) => id === null || !inputs.has(id))) {
      context.addIssue({ code: 'custom', message: '候选输入与结果集合不一致。' });
    }
  }
});
export type JavaSchemeAssessmentResult = z.infer<typeof javaSchemeAssessmentResultSchema>;
