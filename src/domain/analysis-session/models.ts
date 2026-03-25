import {
  getUnsupportedScopeMessage,
  isUnsupportedAnalysisQuestion,
} from '@/domain/scope-boundary/policy';

export type AnalysisSessionStatus = 'pending';

export type AnalysisSession = {
  id: string;
  ownerUserId: string;
  questionText: string;
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
