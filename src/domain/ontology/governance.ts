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

/**
 * 本体治理后台角色与权限边界（Story 9.5）。
 *
 * 与 Epic 7 的 PLATFORM_ADMIN 主线对齐：PLATFORM_ADMIN 默认拥有全部治理权限；
 * 业务方可继续按 Story 7.1 引入更细粒度的角色而无需改动这一层判定。
 */
export const ONTOLOGY_GOVERNANCE_ROLES = {
  PLATFORM_ADMIN: 'PLATFORM_ADMIN',
  VIEWER: 'ONTOLOGY_VIEWER',
  AUTHOR: 'ONTOLOGY_AUTHOR',
  APPROVER: 'ONTOLOGY_APPROVER',
  PUBLISHER: 'ONTOLOGY_PUBLISHER',
} as const;

const SUPER = ONTOLOGY_GOVERNANCE_ROLES.PLATFORM_ADMIN;

function hasRole(roleCodes: readonly string[], role: string): boolean {
  return roleCodes.includes(role) || roleCodes.includes(SUPER);
}

export function canViewOntologyGovernance(roleCodes: readonly string[]): boolean {
  return (
    roleCodes.includes(SUPER) ||
    roleCodes.includes(ONTOLOGY_GOVERNANCE_ROLES.VIEWER) ||
    roleCodes.includes(ONTOLOGY_GOVERNANCE_ROLES.AUTHOR) ||
    roleCodes.includes(ONTOLOGY_GOVERNANCE_ROLES.APPROVER) ||
    roleCodes.includes(ONTOLOGY_GOVERNANCE_ROLES.PUBLISHER)
  );
}

export function canSubmitChangeRequest(roleCodes: readonly string[]): boolean {
  return hasRole(roleCodes, ONTOLOGY_GOVERNANCE_ROLES.AUTHOR);
}

export function canReviewChangeRequest(roleCodes: readonly string[]): boolean {
  return hasRole(roleCodes, ONTOLOGY_GOVERNANCE_ROLES.APPROVER);
}

export function canPublishOntologyVersion(roleCodes: readonly string[]): boolean {
  return hasRole(roleCodes, ONTOLOGY_GOVERNANCE_ROLES.PUBLISHER);
}

export type OntologyGovernanceCapabilities = {
  canView: boolean;
  canAuthor: boolean;
  canReview: boolean;
  canPublish: boolean;
};

export function resolveGovernanceCapabilities(
  roleCodes: readonly string[],
): OntologyGovernanceCapabilities {
  return {
    canView: canViewOntologyGovernance(roleCodes),
    canAuthor: canSubmitChangeRequest(roleCodes),
    canReview: canReviewChangeRequest(roleCodes),
    canPublish: canPublishOntologyVersion(roleCodes),
  };
}

export class OntologyGovernanceForbiddenError extends Error {
  constructor(action: string) {
    super(`当前账号没有执行该治理操作的权限：${action}`);
    this.name = 'OntologyGovernanceForbiddenError';
  }
}
