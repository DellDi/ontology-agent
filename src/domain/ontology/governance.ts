/**
 * 本体变更治理领域模型
 *
 * 定义 change request / approval / publish 的状态机与领域类型。
 * Story 9.4 核心产物。
 */

export const CHANGE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'published',
  'superseded',
] as const;

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const CHANGE_TYPES = [
  'create',
  'update',
  'deprecate',
  'retire',
] as const;

export type ChangeType = (typeof CHANGE_TYPES)[number];

export const TARGET_OBJECT_TYPES = [
  'entity_definition',
  'metric_definition',
  'metric_variant',
  'factor_definition',
  'causality_edge',
  'plan_step_template',
  'tool_capability_binding',
  'time_semantic',
  'evidence_type_definition',
] as const;

export type TargetObjectType = (typeof TARGET_OBJECT_TYPES)[number];

export const COMPATIBILITY_TYPES = [
  'backward_compatible',
  'breaking',
] as const;

export type CompatibilityType = (typeof COMPATIBILITY_TYPES)[number];

export const APPROVAL_DECISIONS = [
  'approved',
  'rejected',
] as const;

export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export type OntologyChangeRequest = {
  id: string;
  ontologyVersionId: string;
  targetObjectType: TargetObjectType;
  targetObjectKey: string;
  changeType: ChangeType;
  status: ChangeRequestStatus;
  title: string;
  description: string | null;
  beforeSummary: Record<string, unknown> | null;
  afterSummary: Record<string, unknown> | null;
  impactScope: string[];
  compatibilityType: CompatibilityType;
  compatibilityNote: string | null;
  submittedBy: string;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OntologyApprovalRecord = {
  id: string;
  changeRequestId: string;
  decision: ApprovalDecision;
  reviewedBy: string;
  comment: string | null;
  createdAt: string;
};

export type OntologyPublishRecord = {
  id: string;
  ontologyVersionId: string;
  publishedBy: string;
  previousVersionId: string | null;
  changeRequestIds: string[];
  publishNote: string | null;
  createdAt: string;
};

const TERMINAL_STATUSES: ReadonlySet<ChangeRequestStatus> = new Set([
  'published',
  'superseded',
  'rejected',
]);

const VALID_TRANSITIONS: Record<ChangeRequestStatus, readonly ChangeRequestStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['published', 'superseded'],
  rejected: [],
  published: ['superseded'],
  superseded: [],
};

export function isTerminalStatus(status: ChangeRequestStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransitionTo(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export class InvalidChangeRequestTransitionError extends Error {
  constructor(from: ChangeRequestStatus, to: ChangeRequestStatus) {
    super(`变更申请状态转换无效：无法从 "${from}" 转换到 "${to}"。`);
    this.name = 'InvalidChangeRequestTransitionError';
  }
}

export class ChangeRequestNotFoundError extends Error {
  constructor(id: string) {
    super(`变更申请不存在：${id}`);
    this.name = 'ChangeRequestNotFoundError';
  }
}

export class ChangeRequestNotApprovedError extends Error {
  constructor(id: string) {
    super(`变更申请尚未通过审批，无法发布：${id}`);
    this.name = 'ChangeRequestNotApprovedError';
  }
}

export class OntologyVersionNotReadyForPublishError extends Error {
  constructor(versionId: string, reason: string) {
    super(`本体版本 "${versionId}" 无法发布：${reason}`);
    this.name = 'OntologyVersionNotReadyForPublishError';
  }
}
