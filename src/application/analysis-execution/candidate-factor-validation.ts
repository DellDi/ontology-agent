import type {
  AnalysisToolInvocationResult,
  OrchestrationStepExecutionResult,
} from '@/domain/tooling/models';

export type ExecutionCandidateFactor = {
  key: string;
  label: string;
};

export type CandidateFactorValidationMetadata = {
  factorKey: string;
  status: 'supported' | 'not-supported' | 'inconclusive';
  note: string;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function stringifyEvidence(value: unknown): string {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(stringifyEvidence).filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${stringifyEvidence(item)}`)
      .filter((item) => item.trim().length > 0)
      .join(' ');
  }

  return '';
}

function extractSuccessEvidence(
  event: Extract<AnalysisToolInvocationResult, { ok: true }>,
) {
  const text = stringifyEvidence(event.output);

  return {
    toolName: event.toolName,
    text,
    normalizedText: normalizeText(text),
  };
}

function hasExplicitFactorMatch(input: {
  factor: ExecutionCandidateFactor;
  evidence: ReturnType<typeof extractSuccessEvidence>;
}) {
  const aliases = buildFactorAliases(input.factor).map(normalizeText);

  return aliases.some((alias) => input.evidence.normalizedText.includes(alias));
}

function buildFactorAliases(factor: ExecutionCandidateFactor) {
  const raw = `${factor.key} ${factor.label}`.toLowerCase();
  const aliases = [factor.key, factor.label];

  if (raw.includes('receivable') || raw.includes('应收') || raw.includes('账单')) {
    aliases.push('receivable', '应收', '账单', '收费口径');
  }

  if (raw.includes('payment') || raw.includes('缴费') || raw.includes('回款')) {
    aliases.push('payment', '缴费', '回款', '入账');
  }

  if (raw.includes('service') || raw.includes('工单') || raw.includes('履约')) {
    aliases.push('serviceorder', 'service-order', '工单', '服务履约');
  }

  if (raw.includes('complaint') || raw.includes('投诉')) {
    aliases.push('complaint', '投诉');
  }

  if (raw.includes('satisfaction') || raw.includes('满意')) {
    aliases.push('satisfaction', '满意度');
  }

  if (raw.includes('owner') || raw.includes('业主')) {
    aliases.push('owner', '业主');
  }

  return aliases.filter((alias) => alias.trim().length > 0);
}

function summarizeEvidenceForNote(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';

  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact;
}

/**
 * 从 validate-candidate-factors 步骤的真实工具结果派生逐因素验证元数据。
 *
 * 规则保持保守：
 * - 明确命中因素 key/label 的工具结果才标 supported；
 * - 工具全部为空结果时标 not-supported；
 * - 工具执行了但没有因素级命中时标 inconclusive，避免误导用户。
 */
export function deriveCandidateFactorValidations(input: {
  candidateFactors: readonly ExecutionCandidateFactor[];
  result: OrchestrationStepExecutionResult;
}): CandidateFactorValidationMetadata[] {
  if (input.candidateFactors.length === 0) {
    return [];
  }

  if (input.result.status !== 'completed') {
    return input.candidateFactors.map((factor) => ({
      factorKey: factor.key,
      status: 'inconclusive' as const,
      note: '验证步骤未成功完成，无法形成逐因素判断。',
    }));
  }

  const successEvidence = input.result.events
    .filter((event): event is Extract<AnalysisToolInvocationResult, { ok: true }> => event.ok)
    .map(extractSuccessEvidence)
    .filter((evidence) => evidence.normalizedText.length > 0);
  const emptyResultFailures = input.result.events.filter(
    (event) => !event.ok && event.error.code === 'tool-empty-result',
  );

  return input.candidateFactors.map((factor) => {
    const matchedEvidence = successEvidence.find((evidence) =>
      hasExplicitFactorMatch({ factor, evidence }),
    );

    if (matchedEvidence) {
      const evidenceSummary = summarizeEvidenceForNote(matchedEvidence.text);

      return {
        factorKey: factor.key,
        status: 'supported' as const,
        note: evidenceSummary
          ? `验证工具返回了与「${factor.label}」相关的证据：${evidenceSummary}`
          : `验证工具返回了与「${factor.label}」相关的证据。`,
      };
    }

    if (successEvidence.length > 0) {
      return {
        factorKey: factor.key,
        status: 'inconclusive' as const,
        note: `验证步骤已执行并返回了业务数据，但没有命中「${factor.label}」的因素级证据，不能判定为已支持。`,
      };
    }

    if (emptyResultFailures.length > 0) {
      return {
        factorKey: factor.key,
        status: 'not-supported' as const,
        note: `验证步骤已执行，但工具未返回与「${factor.label}」相关的数据。`,
      };
    }

    return {
      factorKey: factor.key,
      status: 'inconclusive' as const,
      note: `验证步骤已执行，但没有生成可用于判断「${factor.label}」的证据。`,
    };
  });
}
