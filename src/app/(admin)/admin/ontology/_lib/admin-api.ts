'use client';

import type {
  ApprovalDecision,
  ChangeRequestStatus,
  OntologyApprovalRecord,
  OntologyChangeRequest,
  OntologyPublishRecord,
} from '@/domain/ontology/governance';
import type { OntologyVersion } from '@/domain/ontology/models';
import type { OntologyGovernanceCapabilities } from '@/domain/ontology/governance';

export type AdminApiSuccess<T> = {
  ok: true;
  data: T;
};

export type AdminApiFailure = {
  ok: false;
  error: {
    message: string;
    reason: string;
  };
};

export type AdminApiResponse<T> = AdminApiSuccess<T> | AdminApiFailure;

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

export class AdminApiError extends Error {
  readonly reason: string;
  readonly status: number;

  constructor(message: string, reason: string, status: number) {
    super(message);
    this.name = 'AdminApiError';
    this.reason = reason;
    this.status = status;
  }
}

export const ontologyAdminQueryKeys = {
  changeRequests: {
    all: ['ontology-admin', 'change-requests'] as const,
    list: (status: ChangeRequestStatus | 'all') =>
      ['ontology-admin', 'change-requests', 'list', status] as const,
    detail: (id: string) => ['ontology-admin', 'change-requests', 'detail', id] as const,
  },
  publishes: {
    list: () => ['ontology-admin', 'publishes', 'list'] as const,
  },
};

async function parseAdminResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? ((await response.json()) as AdminApiResponse<T>)
    : null;

  if (!response.ok || !body?.ok) {
    const message = body && !body.ok
      ? body.error.message
      : `请求失败：HTTP ${response.status}`;
    const reason = body && !body.ok ? body.error.reason : 'http-error';
    throw new AdminApiError(message, reason, response.status);
  }

  return body.data;
}

export async function fetchAdminJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');

  const response = await fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
  });

  return parseAdminResponse<T>(response);
}

export async function listChangeRequests(
  status: ChangeRequestStatus | 'all',
): Promise<ChangeRequestListData> {
  const search = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
  return fetchAdminJson<ChangeRequestListData>(
    `/api/admin/ontology/change-requests${search}`,
  );
}

export async function getChangeRequestDetail(id: string): Promise<ChangeRequestDetailData> {
  return fetchAdminJson<ChangeRequestDetailData>(
    `/api/admin/ontology/change-requests/${encodeURIComponent(id)}`,
  );
}

export async function createChangeRequest(formData: FormData): Promise<{
  changeRequest: OntologyChangeRequest;
  message: string;
}> {
  return fetchAdminJson('/api/admin/ontology/change-requests', {
    method: 'POST',
    body: formData,
  });
}

export async function submitChangeRequest(id: string): Promise<{
  changeRequest: OntologyChangeRequest;
  message: string;
}> {
  return fetchAdminJson(
    `/api/admin/ontology/change-requests/${encodeURIComponent(id)}/submit`,
    { method: 'POST' },
  );
}

export async function reviewChangeRequest(input: {
  id: string;
  decision: ApprovalDecision;
  comment: string;
}): Promise<{
  changeRequest: OntologyChangeRequest;
  approvalRecord: OntologyApprovalRecord;
  message: string;
}> {
  const formData = new FormData();
  formData.set('decision', input.decision);
  formData.set('comment', input.comment);

  return fetchAdminJson(
    `/api/admin/ontology/change-requests/${encodeURIComponent(input.id)}/review`,
    {
      method: 'POST',
      body: formData,
    },
  );
}

export async function publishVersion(input: {
  versionId: string;
  publishNote: string;
}): Promise<{
  publishRecord: OntologyPublishRecord;
  message: string;
}> {
  const formData = new FormData();
  formData.set('publishNote', input.publishNote);

  return fetchAdminJson(
    `/api/admin/ontology/versions/${encodeURIComponent(input.versionId)}/publish`,
    {
      method: 'POST',
      body: formData,
    },
  );
}

export async function listPublishHistory(): Promise<PublishHistoryData> {
  return fetchAdminJson('/api/admin/ontology/publishes?limit=50');
}

export function getAdminApiErrorMessage(error: unknown): string {
  if (error instanceof AdminApiError) return error.message;
  if (error instanceof Error) return error.message;
  return '操作失败，请稍后重试。';
}
