import { z } from 'zod';

import type { AuthSession } from '@/domain/auth/models';
import {
  ANALYSIS_AI_TASK_TYPES,
  type AnalysisAiTaskType,
} from '@/domain/analysis-ai/models';
import type { MetricQueryRequest } from '@/application/semantic-query/models';
import type { GraphCandidateFactorQuery } from '@/domain/graph/models';

export const llmStructuredAnalysisInputSchema = z.object({
  taskType: z.enum(ANALYSIS_AI_TASK_TYPES) satisfies z.ZodType<AnalysisAiTaskType>,
  input: z.unknown(),
  context: z.object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    purpose: z.string().min(1),
    timeoutMs: z.number().int().positive().optional(),
    sessionId: z.string().min(1).optional(),
  }),
  model: z.string().min(1).optional(),
});

export const llmStructuredAnalysisOutputSchema = z.object({
  taskType: z.string().min(1),
  ok: z.boolean(),
  value: z.unknown(),
  issues: z.array(
    z.object({
      path: z.string().min(1),
      message: z.string().min(1),
    }),
  ),
  provider: z.string().min(1),
  model: z.string().min(1),
  finishReason: z.string().nullable(),
});

const permissionScopeSchema = z.object({
  organizationId: z.string().min(1),
  projectIds: z.array(z.string()),
  areaIds: z.array(z.string()),
  roleCodes: z.array(z.string()),
});

const authSessionSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  scope: permissionScopeSchema,
  sessionId: z.string().min(1),
  expiresAt: z.string().min(1),
}) satisfies z.ZodType<AuthSession>;

export const erpReadToolInputSchema = z.object({
  resource: z.enum([
    'organizations',
    'projects',
    'owners',
    'charge-items',
    'receivables',
    'payments',
    'service-orders',
  ]),
  session: authSessionSchema,
});

export type ErpReadToolInput = z.infer<typeof erpReadToolInputSchema>;

export const erpReadToolOutputSchema = z.object({
  resource: z.string().min(1),
  count: z.number().int().nonnegative(),
  items: z.array(z.record(z.string(), z.unknown())),
});

const metricQueryScopeSchema = z.object({
  organizationId: z.string().min(1),
  projectIds: z.array(z.string()),
});

const metricDateRangeSchema = z.object({
  dimension: z.enum(['business-date', 'created-at', 'completed-at']),
  from: z.string().min(1),
  to: z.string().min(1),
});

const metricFilterSchema = z.object({
  dimension: z.enum([
    'organization-id',
    'project-id',
    'project-name',
    'charge-item-name',
    'service-style-name',
    'service-type-name',
  ]),
  values: z.array(z.string()),
});

export const cubeSemanticQueryInputSchema = z.object({
  metric: z.enum([
    'collection-rate',
    'receivable-amount',
    'paid-amount',
    'service-order-count',
    'complaint-count',
    'average-satisfaction',
    'average-close-duration-hours',
    'average-response-duration-hours',
  ]),
  scope: metricQueryScopeSchema,
  dateRange: metricDateRangeSchema.optional(),
  granularity: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
  groupBy: z
    .array(
      z.enum([
        'organization-id',
        'project-id',
        'project-name',
        'charge-item-name',
        'service-style-name',
        'service-type-name',
      ]),
    )
    .optional(),
  filters: z.array(metricFilterSchema).optional(),
  limit: z.number().int().positive().optional(),
}) satisfies z.ZodType<MetricQueryRequest>;

export const cubeSemanticQueryOutputSchema = z.object({
  metric: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      value: z.number().nullable(),
      time: z.string().nullable(),
      dimensions: z.record(z.string(), z.string().nullable()),
    }),
  ),
});

export const neo4jGraphQueryInputSchema = z.object({
  intentType: z.enum([
    'fee-analysis',
    'work-order-analysis',
    'complaint-analysis',
    'satisfaction-analysis',
    'general-analysis',
  ]),
  metric: z.string().min(1),
  entity: z.string().min(1),
  timeRange: z.string().min(1),
  questionText: z.string().min(1),
}) satisfies z.ZodType<GraphCandidateFactorQuery>;

export const neo4jGraphQueryOutputSchema = z.object({
  mode: z.enum(['expand', 'skip']),
  factors: z.array(
    z.object({
      factorKey: z.string().min(1),
      factorLabel: z.string().min(1),
      explanation: z.string().min(1),
      relationType: z.string().min(1),
      direction: z.string().min(1),
      source: z.string().min(1),
    }),
  ),
});

export const platformCapabilityStatusInputSchema = z.object({});

export const platformCapabilityStatusOutputSchema = z.object({
  checkedAt: z.string().min(1),
  capabilities: z.object({
    llm: z.object({
      status: z.enum(['ready', 'degraded']),
      detail: z.string().min(1).optional(),
    }),
    erp: z.object({
      status: z.enum(['ready', 'degraded']),
      detail: z.string().min(1).optional(),
    }),
    cube: z.object({
      status: z.enum(['ready', 'degraded']),
      detail: z.string().min(1).optional(),
    }),
    neo4j: z.object({
      status: z.enum(['ready', 'degraded']),
      detail: z.string().min(1).optional(),
    }),
  }),
});
