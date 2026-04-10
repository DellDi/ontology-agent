import {
  canAccessAnalysisScope,
  getUnsupportedScopeMessage,
  isUnsupportedAnalysisQuestion,
} from '@/domain/scope-boundary/policy';
import type { AnalysisContext } from '@/domain/analysis-context/models';
import type { PermissionScope } from '@/domain/auth/models';

export type AnalysisSessionStatus = 'pending';

export type AnalysisSessionScopeSnapshot = Pick<
  PermissionScope,
  'organizationId' | 'projectIds' | 'areaIds'
>;

export type AnalysisSession = {
  id: string;
  ownerUserId: string;
  organizationId: string;
  projectIds: string[];
  areaIds: string[];
  questionText: string;
  savedContext: AnalysisContext;
  status: AnalysisSessionStatus;
  createdAt: string;
  updatedAt: string;
};

const MAX_QUESTION_LENGTH = 300;
export function normalizeQuestionText(questionText: string) {
  return questionText.replace(/\s+/g, ' ').trim();
}

export function isOutOfScopeQuestion(questionText: string) {
  return isUnsupportedAnalysisQuestion(questionText);
}

export function validateQuestionText(questionText: string) {
  const normalizedQuestion = normalizeQuestionText(questionText);

  if (!normalizedQuestion) {
    return '请输入要分析的问题。';
  }

  if (normalizedQuestion.length > MAX_QUESTION_LENGTH) {
    return `问题长度不能超过 ${MAX_QUESTION_LENGTH} 个字符。`;
  }

  if (isOutOfScopeQuestion(normalizedQuestion)) {
    return getUnsupportedScopeMessage();
  }

  return null;
}

export function getMissingScopedTargetsMessage() {
  return '当前账号还没有可直接发起分析的项目或区域范围。';
}

export function isSessionAccessibleInScope(
  session: Pick<
    AnalysisSession,
    'ownerUserId' | 'organizationId' | 'projectIds' | 'areaIds'
  >,
  viewer: {
    userId: string;
    scope: AnalysisSessionScopeSnapshot;
  },
) {
  return canAccessAnalysisScope(session, viewer);
}

export function getAnalysisSessionStatusLabel(
  status: AnalysisSessionStatus,
) {
  switch (status) {
    case 'pending':
      return '待分析';
    default:
      return status;
  }
}

export function createAnalysisSessionTitle(questionText: string) {
  const normalizedQuestion = normalizeQuestionText(questionText);

  if (normalizedQuestion.length <= 28) {
    return normalizedQuestion;
  }

  return `${normalizedQuestion.slice(0, 28)}...`;
}
