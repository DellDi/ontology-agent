import 'server-only';

import { headers } from 'next/headers';
import { z } from 'zod';

import {
  CORRELATION_HEADER,
  resolveCorrelationIdFromHeaders,
} from '@/infrastructure/observability/correlation';

const jsonObjectSchema = z.record(z.string(), z.unknown());
const propertyCapabilityBindingSchema = z.strictObject({
  domainKey: z.literal('property'),
  capabilityKey: z.literal('collection-rate-analysis'),
  ontologyVersionId: z.string().min(1),
  resolvedScope: z.strictObject({
    domainKey: z.literal('property'),
    schemaVersion: z.literal(1),
    values: z.strictObject({
      organizationId: z.string().min(1),
      projectIds: z.array(z.string().min(1)),
      areaIds: z.array(z.string().min(1)),
    }).refine(({ projectIds, areaIds }) => projectIds.length > 0 || areaIds.length > 0, {
      message: 'Property 能力绑定的授权范围不能为空。',
      path: ['projectIds'],
    }),
  }),
});

const easyVCapabilityBindingSchema = z.strictObject({
  domainKey: z.literal('easyv'),
  capabilityKey: z.literal('generation-quality-analysis'),
  ontologyVersionId: z.string().min(1),
  resolvedScope: z.strictObject({
    domainKey: z.literal('easyv'),
    schemaVersion: z.literal(1),
    values: z.strictObject({
      userId: z.string().regex(/^[1-9][0-9]*$/),
      accessMode: z.literal('creator-owned'),
    }),
  }),
});

const capabilityBindingSchema = z.union([
  z.strictObject({ source: z.literal('legacy/unknown') }),
  propertyCapabilityBindingSchema,
  easyVCapabilityBindingSchema,
]);
const jobStatusSchema = z.enum([
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'dead_letter',
]);
const nullableInstantSchema = z.string().min(1).nullable();

const scopeSchema = z.strictObject({
  organizationId: z.string(),
  projectIds: z.array(z.string()),
  areaIds: z.array(z.string()),
  roleCodes: z.array(z.string()),
});

export const javaViewerSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  scope: scopeSchema,
  workspaceAccess: z.boolean(),
});

const sessionScopeSchema = scopeSchema.omit({ roleCodes: true });

const conclusionCauseSchema = z.strictObject({
  id: z.string().min(1),
  rank: z.number().int().positive(),
  title: z.string().min(1),
  summary: z.string().min(1),
  confidence: z.number().finite().min(0).max(1).nullable(),
  evidence: z.array(z.strictObject({
    label: z.string().min(1),
    summary: z.string().min(1),
  })).min(1),
});

const evidenceProjectionSchema = z.strictObject({
  source: z.string().min(1),
  title: z.string().min(1),
  rowCount: z.number().int().positive(),
  rows: z.array(jsonObjectSchema).min(1),
}).refine(
  ({ rowCount, rows }) => rowCount === rows.length,
  { message: 'evidence.rowCount 必须与 rows 数量一致。', path: ['rowCount'] },
);

const groundedClaimSchema = z.strictObject({
  kind: z.string().min(1).optional(),
  text: z.string().min(1),
  evidenceRefs: z.array(z.strictObject({
    source: z.string().min(1),
    row: z.number().int().nonnegative(),
    field: z.string().min(1),
    value: z.union([z.string(), z.number().finite(), z.boolean()]),
  })).min(1),
});

const conclusionStateSchema = z.strictObject({
  causes: z.array(conclusionCauseSchema),
  renderBlocks: z.array(jsonObjectSchema),
  evidence: z.array(evidenceProjectionSchema).optional(),
  claims: z.array(groundedClaimSchema).optional(),
});

const ontologyVersionBindingSchema = z.strictObject({
  ontologyVersionId: z.string().min(1),
  source: z.enum(['grounded-context', 'inherited', 'switched']),
});

const contextFieldSchema = z.strictObject({
  label: z.string().min(1),
  value: z.string().min(1),
  state: z.enum(['missing', 'uncertain', 'confirmed']),
  note: z.string().min(1).optional(),
});

const analysisContextSchema = z.strictObject({
  targetMetric: contextFieldSchema,
  entity: contextFieldSchema,
  timeRange: contextFieldSchema,
  comparison: contextFieldSchema,
  granularity: contextFieldSchema.optional(),
  constraints: z.array(z.strictObject({
    label: z.string().min(1),
    value: z.string().min(1),
  })),
});

const propertyPlanStepSchema = z.strictObject({
  id: z.string().min(1),
  order: z.number().int().positive(),
  title: z.string().min(1),
  objective: z.string().min(1),
  dependencyIds: z.array(z.string().min(1)),
});

const easyVPlanStepSchema = z.strictObject({
  id: z.string().min(1),
  order: z.number().int().positive(),
  kind: z.string().min(1),
});

const planStepSchema = z.union([propertyPlanStepSchema, easyVPlanStepSchema]);

const resolvedContextSchema = jsonObjectSchema;

const planRuntimeFields = {
  _executionContract: z.enum(['java-initial-v1', 'java-follow-up-v1']),
  _groundedSource: z.string().min(1).optional(),
  _groundingStatus: z.enum(['success', 'failed', 'ambiguous', 'partial', 'grounded']).optional(),
  _toolBindings: jsonObjectSchema.optional(),
  _executionAssumptions: z.array(z.string()).optional(),
  _followUpId: z.string().min(1).optional(),
  _referencedExecutionId: z.string().min(1).optional(),
  _resolvedContext: resolvedContextSchema,
};

const javaPlanSnapshotSchema = z.strictObject({
  mode: z.enum(['minimal', 'multi-step', 'deterministic-read-only']),
  summary: z.string().min(1),
  steps: z.array(planStepSchema).min(1),
  ...planRuntimeFields,
}).superRefine((value, context) => {
  value.steps.forEach((step, index) => {
    if (step.order !== index + 1) {
      context.addIssue({ code: 'custom', path: ['steps', index, 'order'], message: '计划步骤顺序必须连续。' });
    }
  });
});

const javaExecutionPlanEnvelopeSchema = z.strictObject({
  mode: z.enum(['minimal', 'multi-step', 'deterministic-read-only']),
  summary: z.string().min(1),
  steps: z.array(planStepSchema),
  _executionContract: z.enum(['java-initial-v1', 'java-follow-up-v1']),
  _groundedSource: z.string().min(1).optional(),
  _groundingStatus: z.enum(['success', 'failed', 'ambiguous', 'partial', 'grounded']).optional(),
  _toolBindings: jsonObjectSchema.optional(),
  _executionAssumptions: z.array(z.string()).optional(),
  _followUpId: z.string().min(1).optional(),
  _referencedExecutionId: z.string().min(1).optional(),
  _resolvedContext: jsonObjectSchema,
});

const propertyResolvedContextSchema = z.strictObject({
  entityKey: z.string().min(1),
  metricDefinitionKey: z.string().min(1),
  metricVariantKey: z.string().min(1),
  timeSemanticKey: z.string().min(1),
  projectIds: z.array(z.string().min(1)),
  from: z.iso.date(),
  to: z.iso.date(),
}).refine(({ from, to }) => from <= to, {
  message: '_resolvedContext.from 不能晚于 to。',
  path: ['from'],
});

const easyVResolvedContextSchema = z.strictObject({
  entity: z.string().min(1),
  metric: z.string().min(1),
  time: z.string().min(1),
  from: z.iso.date(),
  to: z.iso.date(),
  accessMode: z.literal('creator-owned'),
  userId: z.string().regex(/^[1-9][0-9]*$/),
}).refine(({ from, to }) => from <= to, {
  message: '_resolvedContext.from 不能晚于 to。',
  path: ['from'],
});

const propertyEvidenceSources = ['erp-staging', 'cube', 'neo4j'] as const;
const easyVEvidenceSources = [
  'easyv-ai-application',
  'easyv-pipeline-node',
  'easyv-forge-task',
  'easyv-generation-feedback',
] as const;
const easyVClaimKinds = [
  'generation-quality',
  'stage-bottleneck',
  'failure-concentration',
  'feedback-association',
  'business-success-settlement-distinct',
] as const;
const propertyClaimKinds = [
  'collection-rate',
  'erp-balance',
  'charge-structure',
] as const;

function addSourceCoverageIssues(
  state: z.infer<typeof conclusionStateSchema> | null,
  sources: readonly string[],
  context: z.RefinementCtx,
  expectedCount: number,
) {
  const evidenceSources = state?.evidence?.map((item) => item.source) ?? [];
  if (evidenceSources.length !== expectedCount
    || new Set(evidenceSources).size !== expectedCount
    || sources.some((source) => !evidenceSources.includes(source))) {
    context.addIssue({
      code: 'custom',
      path: ['conclusionState', 'evidence'],
      message: `完成态必须包含 ${sources.join('、')} 各一类证据投影。`,
    });
  }
  const claimSources = state?.claims?.flatMap((claim) => claim.evidenceRefs.map((ref) => ref.source)) ?? [];
  if (!state?.claims?.length || sources.some((source) => !claimSources.includes(source))) {
    context.addIssue({
      code: 'custom',
      path: ['conclusionState', 'claims'],
      message: `完成态结论必须保留 ${sources.join('、')} 的逐条证据引用。`,
    });
  }
}

function addClaimKindIssues(
  state: z.infer<typeof conclusionStateSchema> | null,
  kinds: readonly string[],
  context: z.RefinementCtx,
) {
  const claims = state?.claims ?? [];
  const actualKinds = claims
    .map((claim) => claim.kind)
    .filter((kind): kind is string => Boolean(kind));
  if (claims.length !== kinds.length
    || actualKinds.length !== kinds.length
    || new Set(actualKinds).size !== kinds.length
    || kinds.some((kind) => !actualKinds.includes(kind))) {
    context.addIssue({
      code: 'custom',
      path: ['conclusionState', 'claims'],
      message: `完成态必须保留 ${kinds.join('、')} 各一类受控结论。`,
    });
  }
}

function validateCapabilityPayload(
  value: {
    ontologyVersionId: string | null;
    capabilityBinding: z.infer<typeof capabilityBindingSchema>;
    planSnapshot: z.infer<typeof javaExecutionPlanEnvelopeSchema>;
    conclusionState: z.infer<typeof conclusionStateSchema>;
  },
  context: z.RefinementCtx,
) {
  if ('source' in value.capabilityBinding) {
    context.addIssue({
      code: 'custom',
      path: ['capabilityBinding'],
      message: '完成态必须携带具体能力绑定。',
    });
    return;
  }
  const binding = value.capabilityBinding;
  if (value.ontologyVersionId !== binding.ontologyVersionId) {
    context.addIssue({
      code: 'custom',
      path: ['capabilityBinding', 'ontologyVersionId'],
      message: '能力绑定与执行本体版本不一致。',
    });
  }
  if (binding.resolvedScope.domainKey !== binding.domainKey) {
    context.addIssue({ code: 'custom', path: ['capabilityBinding', 'resolvedScope', 'domainKey'], message: '能力绑定与范围快照的领域不一致。' });
  }
  if (binding.domainKey === 'property') {
    if (!propertyResolvedContextSchema.safeParse(value.planSnapshot._resolvedContext).success) {
      context.addIssue({ code: 'custom', path: ['planSnapshot', '_resolvedContext'], message: 'Property 计划缺少受控解析上下文。' });
    }
    if (value.planSnapshot.steps.some((step) => !propertyPlanStepSchema.safeParse(step).success)) {
      context.addIssue({ code: 'custom', path: ['planSnapshot', 'steps'], message: 'Property 计划步骤必须包含标题、目标和依赖关系。' });
    }
    addClaimKindIssues(value.conclusionState, propertyClaimKinds, context);
    addSourceCoverageIssues(value.conclusionState, propertyEvidenceSources, context, 3);
    return;
  }
  if (binding.domainKey === 'easyv') {
    if (binding.capabilityKey !== 'generation-quality-analysis') {
      context.addIssue({ code: 'custom', path: ['capabilityBinding', 'capabilityKey'], message: '未知的 EasyV 能力。' });
    }
    if (!easyVResolvedContextSchema.safeParse(value.planSnapshot._resolvedContext).success) {
      context.addIssue({ code: 'custom', path: ['planSnapshot', '_resolvedContext'], message: 'EasyV 计划缺少受控解析上下文。' });
    }
    if (value.planSnapshot.steps.some((step) => !easyVPlanStepSchema.safeParse(step).success)) {
      context.addIssue({ code: 'custom', path: ['planSnapshot', 'steps'], message: 'EasyV 计划步骤必须包含稳定 ID、顺序和步骤类型。' });
    }
    addClaimKindIssues(value.conclusionState, easyVClaimKinds, context);
    addSourceCoverageIssues(value.conclusionState, easyVEvidenceSources, context, 4);
    return;
  }
  context.addIssue({ code: 'custom', path: ['capabilityBinding', 'domainKey'], message: '未注册的分析领域。' });
}

const javaFollowUpPlanSnapshotSchema = javaPlanSnapshotSchema.superRefine((value, context) => {
  if (value._executionContract !== 'java-follow-up-v1') {
    context.addIssue({ code: 'custom', path: ['_executionContract'], message: '追问计划必须使用 java-follow-up-v1。' });
  }
  if (!value._followUpId || !value._referencedExecutionId) {
    context.addIssue({ code: 'custom', path: ['_followUpId'], message: '追问计划必须绑定追问和来源执行。' });
  }
});

const planDiffStepSchema = z.strictObject({
  stepId: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
});

const planDiffSchema = z.strictObject({
  reason: z.string().min(1),
  reusedSteps: z.array(planDiffStepSchema),
  invalidatedSteps: z.array(planDiffStepSchema),
  addedSteps: z.array(planDiffStepSchema),
});

export const javaAnalysisFollowUpSchema = z.strictObject({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  ownerUserId: z.string().min(1),
  questionText: z.string().min(1).max(300),
  parentFollowUpId: z.string().min(1).nullable(),
  referencedExecutionId: z.string().min(1),
  referencedConclusionTitle: z.string().min(1).nullable(),
  referencedConclusionSummary: z.string().min(1).nullable(),
  resultExecutionId: z.string().min(1).nullable(),
  ontologyVersionId: z.string().min(1),
  ontologyVersionBinding: ontologyVersionBindingSchema,
  capabilityBinding: capabilityBindingSchema,
  inheritedContext: analysisContextSchema,
  mergedContext: analysisContextSchema,
  planVersion: z.number().int().positive().nullable(),
  currentPlanSnapshot: javaPlanSnapshotSchema.nullable(),
  previousPlanSnapshot: javaPlanSnapshotSchema.nullable(),
  currentPlanDiff: planDiffSchema.nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((value, context) => {
  if (value.ontologyVersionId !== value.ontologyVersionBinding.ontologyVersionId) {
    context.addIssue({
      code: 'custom',
      path: ['ontologyVersionBinding', 'ontologyVersionId'],
      message: '追问的 ontologyVersionId 与绑定对象不一致。',
    });
  }
  if ('source' in value.capabilityBinding) {
    if (value.resultExecutionId !== null) {
      context.addIssue({
        code: 'custom',
        path: ['capabilityBinding'],
        message: '已关联执行结果的追问必须携带具体能力绑定。',
      });
    }
  } else if (value.capabilityBinding.ontologyVersionId !== value.ontologyVersionId) {
    context.addIssue({
      code: 'custom',
      path: ['capabilityBinding', 'ontologyVersionId'],
      message: '追问的 capability binding 与本体版本不一致。',
    });
  }
  for (const [field, plan] of [
    ['currentPlanSnapshot', value.currentPlanSnapshot],
    ['previousPlanSnapshot', value.previousPlanSnapshot],
  ] as const) {
    if (!plan || 'source' in value.capabilityBinding) continue;
    if (value.capabilityBinding.domainKey === 'property') {
      if (!propertyResolvedContextSchema.safeParse(plan._resolvedContext).success
        || plan.steps.some((step) => !propertyPlanStepSchema.safeParse(step).success)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'Property 追问计划必须使用受控解析上下文和计划步骤。',
        });
      }
    } else if (value.capabilityBinding.domainKey === 'easyv') {
      if (!easyVResolvedContextSchema.safeParse(plan._resolvedContext).success
        || plan.steps.some((step) => !easyVPlanStepSchema.safeParse(step).success)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: 'EasyV 追问计划必须使用受控解析上下文和计划步骤。',
        });
      }
    }
  }
  const planFields = [value.planVersion, value.currentPlanSnapshot, value.previousPlanSnapshot, value.currentPlanDiff];
  const hasPlan = planFields.every((item) => item !== null);
  if (!hasPlan && planFields.some((item) => item !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['planVersion'],
      message: '追问重规划的版本、前后计划与 diff 必须同时存在或同时为空。',
    });
  }
  if (value.currentPlanSnapshot && value.currentPlanSnapshot._followUpId !== value.id) {
    context.addIssue({ code: 'custom', path: ['currentPlanSnapshot', '_followUpId'], message: '追问计划 ID 不一致。' });
  }
  if (value.currentPlanSnapshot
    && !javaFollowUpPlanSnapshotSchema.safeParse(value.currentPlanSnapshot).success) {
    context.addIssue({
      code: 'custom',
      path: ['currentPlanSnapshot'],
      message: '当前追问计划不符合 java-follow-up-v1 执行契约。',
    });
  }
  if (value.currentPlanSnapshot
    && value.currentPlanSnapshot._referencedExecutionId !== value.referencedExecutionId) {
    context.addIssue({
      code: 'custom',
      path: ['currentPlanSnapshot', '_referencedExecutionId'],
      message: '追问计划来源执行不一致。',
    });
  }
});

const latestExecutionSchema = z.strictObject({
  executionId: z.string().min(1),
  status: jobStatusSchema,
  jobStatus: jobStatusSchema.nullable(),
  snapshotStatus: jobStatusSchema.nullable(),
  capabilityBinding: capabilityBindingSchema,
  conclusionState: conclusionStateSchema.nullable(),
  failurePoint: jsonObjectSchema.nullable(),
  errorCode: z.string().nullable(),
  jobError: z.string().nullable(),
  traceId: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((value, context) => {
  if (value.status === 'completed') {
    if ('source' in value.capabilityBinding) {
      context.addIssue({ code: 'custom', path: ['capabilityBinding'], message: '完成态必须携带具体能力绑定。' });
    } else if (!value.conclusionState) {
      context.addIssue({ code: 'custom', path: ['conclusionState'], message: '完成态必须携带结论。' });
    } else if (value.capabilityBinding.domainKey === 'property') {
      if (value.capabilityBinding.ontologyVersionId.length === 0) {
        context.addIssue({ code: 'custom', path: ['capabilityBinding', 'ontologyVersionId'], message: '能力绑定缺少本体版本。' });
      }
      addClaimKindIssues(value.conclusionState, propertyClaimKinds, context);
      addSourceCoverageIssues(value.conclusionState, propertyEvidenceSources, context, 3);
    } else if (value.capabilityBinding.domainKey === 'easyv') {
      addClaimKindIssues(value.conclusionState, easyVClaimKinds, context);
      addSourceCoverageIssues(value.conclusionState, easyVEvidenceSources, context, 4);
    } else {
      context.addIssue({ code: 'custom', path: ['capabilityBinding', 'domainKey'], message: '未注册的分析领域。' });
    }
  }
});

export const javaWorkspaceHomeSchema = z.strictObject({
  viewer: javaViewerSchema,
  sessions: z.array(z.strictObject({
    id: z.string().min(1),
    questionText: z.string().min(1),
    status: z.literal('pending'),
    scope: sessionScopeSchema,
    savedContext: jsonObjectSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    latestExecution: latestExecutionSchema.nullable(),
  })),
  projects: z.array(z.strictObject({
    id: z.string().min(1),
    code: z.string().nullable(),
    name: z.string().min(1),
    organizationId: z.string(),
    areaId: z.string().nullable(),
    areaName: z.string().nullable(),
  })),
});

const eventSchema = z.strictObject({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  executionId: z.string().min(1),
  sequence: z.number().int().positive(),
  kind: z.enum([
    'execution-status',
    'step-lifecycle',
    'stage-result',
    'step-started',
    'tool-started',
    'tool-completed',
    'tool-failed',
    'step-completed',
  ]),
  timestamp: z.string().min(1),
  status: jobStatusSchema.nullable(),
  message: z.string().nullable(),
  renderBlocks: z.array(jsonObjectSchema),
  metadata: jsonObjectSchema,
  errorCode: z.string().nullable(),
  traceId: z.string().nullable(),
});

const jobSchema = z.strictObject({
  executionId: z.string().min(1),
  status: jobStatusSchema,
  result: jsonObjectSchema.nullable(),
  error: z.string().nullable(),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  dispatchStatus: z.enum(['pending', 'published', 'failed']),
  traceId: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  startedAt: nullableInstantSchema,
  completedAt: nullableInstantSchema,
  failedAt: nullableInstantSchema,
});

export const javaExecutionSnapshotSchema = z.strictObject({
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  followUpId: z.string().nullable(),
  ontologyVersionId: z.string().nullable(),
  ontologyVersionBindingSource: z.enum([
    'grounded-context',
    'inherited',
    'switched',
    'legacy/unknown',
  ]),
  capabilityBinding: capabilityBindingSchema,
  status: jobStatusSchema,
  planSnapshot: javaExecutionPlanEnvelopeSchema,
  stepResults: z.array(jsonObjectSchema),
  conclusionState: conclusionStateSchema,
  resultBlocks: z.array(jsonObjectSchema),
  mobileProjection: jsonObjectSchema,
  failurePoint: jsonObjectSchema.nullable(),
  errorCode: z.string().nullable(),
  traceId: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).superRefine((value, context) => {
  if (value.status === 'completed' && !javaPlanSnapshotSchema.safeParse(value.planSnapshot).success) {
    context.addIssue({
      code: 'custom',
      path: ['planSnapshot'],
      message: '完成态必须保存完整的 canonical plan 与受控 _resolvedContext。',
    });
  }
  const executionContract = value.planSnapshot._executionContract;
  if (value.followUpId === null && executionContract !== 'java-initial-v1') {
    context.addIssue({
      code: 'custom',
      path: ['planSnapshot', '_executionContract'],
      message: '根轮次 snapshot 必须使用 java-initial-v1。',
    });
  }
  if (value.followUpId !== null && executionContract !== 'java-follow-up-v1') {
    context.addIssue({
      code: 'custom',
      path: ['planSnapshot', '_executionContract'],
      message: '追问轮次 snapshot 必须使用 java-follow-up-v1。',
    });
  }
  if (value.followUpId !== null && value.planSnapshot._followUpId !== value.followUpId) {
    context.addIssue({
      code: 'custom',
      path: ['planSnapshot', '_followUpId'],
      message: '追问 snapshot 的计划 ID 与 followUpId 不一致。',
    });
  }
  if (value.followUpId === null && (value.planSnapshot._followUpId
    || value.planSnapshot._referencedExecutionId)) {
    context.addIssue({
      code: 'custom',
      path: ['planSnapshot'],
      message: '根轮次计划不得携带追问绑定。',
    });
  }
  if (value.status === 'completed') {
    validateCapabilityPayload(value, context);
  }
});

const javaHistoryRoundSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(['initial', 'follow-up']),
  questionText: z.string().min(1),
  followUpId: z.string().min(1).nullable(),
  executionId: z.string().min(1).nullable(),
  status: jobStatusSchema.nullable(),
  ontologyVersionId: z.string().min(1).nullable(),
  ontologyVersionBindingSource: z.enum([
    'grounded-context',
    'inherited',
    'switched',
    'legacy/unknown',
  ]).nullable(),
  planSnapshot: javaExecutionPlanEnvelopeSchema.nullable(),
  conclusionState: conclusionStateSchema.nullable(),
  createdAt: z.string().min(1),
}).superRefine((value, context) => {
  if (value.kind === 'initial' && value.followUpId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['followUpId'],
      message: '根历史轮次不得携带 followUpId。',
    });
  }
  if (value.kind === 'follow-up' && value.followUpId === null) {
    context.addIssue({
      code: 'custom',
      path: ['followUpId'],
      message: '追问历史轮次必须携带 followUpId。',
    });
  }
  if (value.status === 'completed'
    && (!value.planSnapshot || !javaPlanSnapshotSchema.safeParse(value.planSnapshot).success)) {
    context.addIssue({
      code: 'custom',
      path: ['planSnapshot'],
      message: '完成历史轮次必须保存完整的 canonical plan。',
    });
  }
  if (value.planSnapshot) {
    if (value.kind === 'initial' && value.planSnapshot._executionContract !== 'java-initial-v1') {
      context.addIssue({ code: 'custom', path: ['planSnapshot', '_executionContract'], message: '根历史轮次计划契约错误。' });
    }
    if (value.kind === 'follow-up'
      && (value.planSnapshot._executionContract !== 'java-follow-up-v1'
        || value.planSnapshot._followUpId !== value.followUpId
        || !value.planSnapshot._referencedExecutionId)) {
      context.addIssue({ code: 'custom', path: ['planSnapshot'], message: '追问历史轮次计划绑定不完整。' });
    }
  }
});

export const javaAnalysisSessionSchema = z.strictObject({
  session: z.strictObject({
    id: z.string().min(1),
    questionText: z.string().min(1),
    status: z.literal('pending'),
    scope: sessionScopeSchema,
    savedContext: jsonObjectSchema,
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  }),
  followUps: z.array(javaAnalysisFollowUpSchema),
  history: z.array(javaHistoryRoundSchema).min(1),
  job: jobSchema.nullable(),
  events: z.array(eventSchema),
  snapshot: javaExecutionSnapshotSchema.nullable(),
  runtime: z.strictObject({
    requestedExecutionId: z.string().nullable(),
    resolvedExecutionId: z.string().nullable(),
    status: jobStatusSchema.nullable(),
    autoExecute: z.boolean(),
    streamEnabled: z.boolean(),
    terminal: z.boolean(),
    resumeAfterSequence: z.number().int().nonnegative(),
  }),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  value.followUps.forEach((followUp, index) => {
    if (followUp.sessionId !== value.session.id) {
      context.addIssue({
        code: 'custom',
        path: ['followUps', index, 'sessionId'],
        message: '追问不属于当前会话。',
      });
    }
    if (ids.has(followUp.id)) {
      context.addIssue({
        code: 'custom',
        path: ['followUps', index, 'id'],
        message: '追问 ID 重复。',
      });
    }
    ids.add(followUp.id);
  });

  if (value.history.length !== value.followUps.length + 1
    || value.history[0]?.kind !== 'initial') {
    context.addIssue({
      code: 'custom',
      path: ['history'],
      message: '历史必须包含一个根轮次以及每条追问对应的轮次。',
    });
  }

  const historyFollowUpIds = new Set<string>();
  value.history.forEach((round, index) => {
    if (round.kind !== 'follow-up' || !round.followUpId) return;
    if (historyFollowUpIds.has(round.followUpId)) {
      context.addIssue({
        code: 'custom',
        path: ['history', index, 'followUpId'],
        message: '同一追问不能生成重复历史轮次。',
      });
    }
    historyFollowUpIds.add(round.followUpId);
    const followUp = value.followUps.find((item) => item.id === round.followUpId);
    if (!followUp) {
      context.addIssue({
        code: 'custom',
        path: ['history', index, 'followUpId'],
        message: '历史轮次指向的追问不在当前会话聚合中。',
      });
    } else if (round.executionId && followUp.resultExecutionId
      && round.executionId !== followUp.resultExecutionId) {
      context.addIssue({
        code: 'custom',
        path: ['history', index, 'executionId'],
        message: '历史轮次执行与追问结果执行不一致。',
      });
    }
  });

  if (value.snapshot?.followUpId) {
    const followUp = value.followUps.find((item) => item.id === value.snapshot?.followUpId);
    if (!followUp) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot', 'followUpId'],
        message: 'snapshot 指向的追问不在当前会话聚合中。',
      });
    } else if (followUp.resultExecutionId !== value.snapshot.executionId) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot', 'executionId'],
        message: 'snapshot executionId 与追问结果执行不一致。',
      });
    }
  }
});

const errorSchema = z.object({
  error: z.string(),
  code: z.string(),
  traceId: z.string(),
});

export type JavaViewer = z.infer<typeof javaViewerSchema>;
export type JavaWorkspaceHome = z.infer<typeof javaWorkspaceHomeSchema>;
export type JavaAnalysisFollowUp = z.infer<typeof javaAnalysisFollowUpSchema>;
export type JavaExecutionSnapshot = z.infer<typeof javaExecutionSnapshotSchema>;
export type JavaAnalysisSession = z.infer<typeof javaAnalysisSessionSchema>;

export class JavaBackendHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly traceId: string,
  ) {
    super(message);
    this.name = 'JavaBackendHttpError';
  }
}

function backendUrl(path: string) {
  const configured = process.env.JAVA_BACKEND_URL?.trim();
  if (!configured) {
    throw new Error('JAVA_BACKEND_URL 未配置。');
  }

  return new URL(path, configured.endsWith('/') ? configured : `${configured}/`);
}

export async function readJavaBackend<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const incoming = await headers();
  const { correlationId } = resolveCorrelationIdFromHeaders(incoming);
  const requestHeaders = new Headers({
    accept: 'application/json',
    [CORRELATION_HEADER]: correlationId,
  });
  const sessionCookie = incoming.get('cookie')?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('dip3_session='));
  if (sessionCookie) requestHeaders.set('cookie', sessionCookie);

  let response: Response;
  try {
    response = await fetch(backendUrl(path), {
      headers: requestHeaders,
      cache: 'no-store',
    });
  } catch (error) {
    console.error('Java backend read failed', { correlationId, path, error });
    throw new JavaBackendHttpError(
      502,
      'JAVA_BACKEND_UNAVAILABLE',
      'Java 后端不可达。',
      correlationId,
    );
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(payload);
    throw new JavaBackendHttpError(
      response.status,
      parsed.success ? parsed.data.code : 'JAVA_BACKEND_ERROR_RESPONSE_INVALID',
      parsed.success ? parsed.data.error : 'Java 后端返回了无效错误响应。',
      parsed.success ? parsed.data.traceId : correlationId,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    console.error('Java backend contract invalid', {
      correlationId,
      path,
      issues: parsed.error.issues,
    });
    throw new JavaBackendHttpError(
      502,
      'JAVA_BACKEND_CONTRACT_INVALID',
      'Java 后端响应不符合已发布契约。',
      correlationId,
    );
  }

  return parsed.data;
}

export const javaAuthConfigSchema = z.strictObject({
  directoryAuthAvailable: z.boolean(),
  devAuthEnabled: z.boolean(),
  urlBridgeEnabled: z.boolean(),
});

export function getCurrentViewer() {
  return readJavaBackend('/api/auth/me', javaViewerSchema);
}

export function getAuthConfig() {
  return readJavaBackend('/api/auth/config', javaAuthConfigSchema);
}

export function getWorkspaceHome() {
  return readJavaBackend('/api/workspace/home', javaWorkspaceHomeSchema);
}

export function getAnalysisSession(sessionId: string, executionId?: string) {
  const path = `/api/analysis/sessions/${encodeURIComponent(sessionId)}`;
  const query = executionId
    ? `?executionId=${encodeURIComponent(executionId)}`
    : '';
  return readJavaBackend(`${path}${query}`, javaAnalysisSessionSchema);
}
