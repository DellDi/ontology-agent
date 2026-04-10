import type { PermissionScope } from '@/domain/auth/models';

export const SUPPORTED_ANALYSIS_TOPICS = [
  '收费',
  '工单',
  '投诉',
  '满意度',
] as const;

export const UNSUPPORTED_ANALYSIS_AREAS = [
  '客服系统',
  'CRM',
  '营销',
  '呼叫中心',
] as const;

function normalizeBoundaryText(questionText: string) {
  return questionText.normalize('NFKC').replace(/[\s\u3000]+/g, '').toLowerCase();
}

const UNSUPPORTED_PATTERNS: Array<{
  label: (typeof UNSUPPORTED_ANALYSIS_AREAS)[number];
  pattern: RegExp;
}> = [
  {
    label: '客服系统',
    pattern: /客服|客服系统|客服会话/i,
  },
  {
    label: 'CRM',
    pattern: /crm/i,
  },
  {
    label: '营销',
    pattern: /营销|转化/i,
  },
  {
    label: '呼叫中心',
    pattern: /呼叫中心|热线|坐席|通话/i,
  },
];

export function findUnsupportedAnalysisAreas(questionText: string) {
  const normalizedQuestionText = normalizeBoundaryText(questionText);
  const hits = new Set<(typeof UNSUPPORTED_ANALYSIS_AREAS)[number]>();

  for (const rule of UNSUPPORTED_PATTERNS) {
    if (rule.pattern.test(normalizedQuestionText)) {
      hits.add(rule.label);
    }
  }

  return Array.from(hits);
}

export function isUnsupportedAnalysisQuestion(questionText: string) {
  return findUnsupportedAnalysisAreas(questionText).length > 0;
}

export function getUnsupportedScopeMessage() {
  return '当前版本仅支持物业分析场景，暂不支持客服系统、CRM、营销、呼叫中心等业务。请聚焦收费、工单、投诉、满意度等物业数据问题。';
}

export class AnalysisAuthorizationError extends Error {
  constructor(message = '会话不存在或无权访问。') {
    super(message);
    this.name = 'AnalysisAuthorizationError';
  }
}

export type AnalysisScopeBoundResource = {
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
};

export function getAnalysisAccessDeniedMessage() {
  return '会话不存在或无权访问。';
}

export function canAccessAnalysisScope(
  resource: AnalysisScopeBoundResource,
  viewer: {
    userId: string;
    scope: Pick<PermissionScope, 'organizationId' | 'projectIds' | 'areaIds'>;
  },
) {
  if (resource.ownerUserId !== viewer.userId) {
    return false;
  }

  const isLegacyMigratedSession =
    !resource.organizationId &&
    resource.projectIds.length === 0 &&
    resource.areaIds.length === 0;

  if (isLegacyMigratedSession) {
    return true;
  }

  if (resource.organizationId !== viewer.scope.organizationId) {
    return false;
  }

  const hasProjectAccess = resource.projectIds.every((projectId) =>
    viewer.scope.projectIds.includes(projectId),
  );
  const hasAreaAccess = resource.areaIds.every((areaId) =>
    viewer.scope.areaIds.includes(areaId),
  );

  return hasProjectAccess && hasAreaAccess;
}

export function assertCanAccessAnalysisScope(
  resource: AnalysisScopeBoundResource,
  viewer: {
    userId: string;
    scope: Pick<PermissionScope, 'organizationId' | 'projectIds' | 'areaIds'>;
  },
) {
  if (!canAccessAnalysisScope(resource, viewer)) {
    throw new AnalysisAuthorizationError(getAnalysisAccessDeniedMessage());
  }
}
