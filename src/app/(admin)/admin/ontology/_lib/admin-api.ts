'use client';

import { z } from 'zod';

import type {
  ApprovalDecision,
  ChangeRequestStatus,
  OntologyApprovalRecord,
  OntologyChangeRequest,
  OntologyPublishRecord,
  OntologyGovernanceCapabilities,
} from '@/domain/ontology/governance';
import type { OntologyVersion } from '@/domain/ontology/models';
import {
  governanceChangeRequestDetailSchema,
  governanceChangeRequestListSchema,
  governancePublishHistorySchema,
  governanceReviewResultSchema,
  governanceVersionListSchema,
  ontologyChangeRequestSchema,
  ontologyPublishRecordSchema,
} from '@/infrastructure/java-backend/governance-schema';

export type ChangeRequestListData = {
  items: OntologyChangeRequest[];
  allItems: OntologyChangeRequest[];
  activeStatus: ChangeRequestStatus | 'all';
  statusCounts: Record<string, number>;
  capabilities: OntologyGovernanceCapabilities;
};

export type ChangeRequestDetailData = {
  changeRequest: OntologyChangeRequest;
  approvalHistory: OntologyApprovalRecord[];
  version: OntologyVersion | null;
  capabilities: OntologyGovernanceCapabilities;
};

export type PublishHistoryData = {
  records: OntologyPublishRecord[];
  versions: OntologyVersion[];
  capabilities: OntologyGovernanceCapabilities;
};

const backendErrorSchema = z.strictObject({
  error: z.string().min(1),
  code: z.string().min(1),
  traceId: z.string().min(1),
});

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly status: number,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

export const ontologyAdminQueryKeys = {
  changeRequests: {
    all: ['ontology-admin', 'change-requests'] as const,
    list: (status: ChangeRequestStatus | 'all') =>
      ['ontology-admin', 'change-requests', 'list', status] as const,
    detail: (id: string) => ['ontology-admin', 'change-requests', 'detail', id] as const,
  },
  publishes: { list: () => ['ontology-admin', 'publishes', 'list'] as const },
};

async function fetchAdmin<T>(
  input: RequestInfo | URL,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = backendErrorSchema.safeParse(payload);
    throw new AdminApiError(
      parsed.success ? parsed.data.error : `Java 后端返回了无效错误响应（HTTP ${response.status}）。`,
      parsed.success ? parsed.data.code : 'JAVA_BACKEND_ERROR_RESPONSE_INVALID',
      response.status,
      parsed.success ? parsed.data.traceId : response.headers.get('x-correlation-id') ?? undefined,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AdminApiError(
      'Java 后端响应不符合已发布治理契约。',
      'JAVA_BACKEND_CONTRACT_INVALID',
      502,
      response.headers.get('x-correlation-id') ?? undefined,
    );
  }
  return parsed.data;
}

function statusCounts(items: OntologyChangeRequest[]) {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

export async function listChangeRequests(
  status: ChangeRequestStatus | 'all',
): Promise<ChangeRequestListData> {
  const allPromise = fetchAdmin(
    '/api/admin/ontology/change-requests?limit=100',
    governanceChangeRequestListSchema,
  );
  const selectedPromise = status === 'all'
    ? allPromise
    : fetchAdmin(
        `/api/admin/ontology/change-requests?status=${encodeURIComponent(status)}&limit=100`,
        governanceChangeRequestListSchema,
      );
  const [all, selected] = await Promise.all([allPromise, selectedPromise]);
  return {
    items: selected.items,
    allItems: all.items,
    activeStatus: status,
    statusCounts: statusCounts(all.items),
    capabilities: all.capabilities,
  };
}

export async function getChangeRequestDetail(id: string): Promise<ChangeRequestDetailData> {
  const [detail, versions] = await Promise.all([
    fetchAdmin(
      `/api/admin/ontology/change-requests/${encodeURIComponent(id)}`,
      governanceChangeRequestDetailSchema,
    ),
    fetchAdmin('/api/admin/ontology/versions?limit=100', governanceVersionListSchema),
  ]);
  return {
    changeRequest: detail.changeRequest,
    approvalHistory: detail.approvals,
    version: versions.items.find((item) => item.id === detail.changeRequest.ontologyVersionId) ?? null,
    capabilities: detail.capabilities,
  };
}

function optionalJson(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? '').trim();
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // The explicit error below is the public contract.
  }
  throw new AdminApiError(`字段“${key}”必须是合法 JSON 对象。`, 'INVALID_JSON_FIELD', 400);
}

export async function createChangeRequest(formData: FormData): Promise<{
  changeRequest: OntologyChangeRequest;
  message: string;
}> {
  const text = (key: string) => String(formData.get(key) ?? '').trim();
  const changeRequest = await fetchAdmin('/api/admin/ontology/change-requests', ontologyChangeRequestSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ontologyVersionId: text('ontologyVersionId'),
      targetObjectType: text('targetObjectType'),
      targetObjectKey: text('targetObjectKey'),
      changeType: text('changeType'),
      title: text('title'),
      description: text('description') || null,
      beforeSummary: optionalJson(formData, 'beforeSummary'),
      afterSummary: optionalJson(formData, 'afterSummary'),
      impactScope: text('impactScope').split(/[\n,]+/).map((item) => item.trim()).filter(Boolean),
      compatibilityType: text('compatibilityType'),
      compatibilityNote: text('compatibilityNote') || null,
    }),
  });
  return { changeRequest, message: `变更申请已创建：${changeRequest.title}` };
}

export async function submitChangeRequest(id: string): Promise<{
  changeRequest: OntologyChangeRequest;
  message: string;
}> {
  const changeRequest = await fetchAdmin(
    `/api/admin/ontology/change-requests/${encodeURIComponent(id)}/submit`,
    ontologyChangeRequestSchema,
    { method: 'POST' },
  );
  return { changeRequest, message: '已提交进入审批。' };
}

export async function reviewChangeRequest(input: {
  id: string;
  decision: ApprovalDecision;
  comment: string;
}) {
  const result = await fetchAdmin(
    `/api/admin/ontology/change-requests/${encodeURIComponent(input.id)}/review`,
    governanceReviewResultSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision: input.decision, comment: input.comment }),
    },
  );
  return {
    ...result,
    message: input.decision === 'approved' ? '已审批通过。' : '已驳回。',
  };
}

export async function publishVersion(input: { versionId: string; publishNote: string }) {
  const publishRecord = await fetchAdmin(
    `/api/admin/ontology/versions/${encodeURIComponent(input.versionId)}/publish`,
    ontologyPublishRecordSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishNote: input.publishNote.trim() || null }),
    },
  );
  return { publishRecord, message: '版本已发布并切换为当前生效版本。' };
}

export async function listPublishHistory(): Promise<PublishHistoryData> {
  const [history, versions] = await Promise.all([
    fetchAdmin('/api/admin/ontology/publishes?limit=50', governancePublishHistorySchema),
    fetchAdmin('/api/admin/ontology/versions?limit=100', governanceVersionListSchema),
  ]);
  return {
    records: history.items,
    versions: versions.items,
    capabilities: history.capabilities,
  };
}

export function getAdminApiErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    return error.traceId ? `${error.message}（追踪号：${error.traceId}）` : error.message;
  }
  if (error instanceof Error) return error.message;
  return '操作失败。';
}
