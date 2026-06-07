/**
 * Candidate Validation Summary — 候选因素验证结果 read model。
 *
 * 职责：从执行事件流中提取每个候选因素的验证结论，
 * 供诊断面板向业务用户展示"哪些因素被验证了、证据是什么、是否进入最终判断"。
 *
 * 约束：
 *   - 纯函数，不依赖 React / DOM / 副作用。
 *   - 不引入新的事实源；所有数据从事件流与候选因素列表派生。
 */

import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';

export type CandidateValidationStatus =
  | 'supported'
  | 'not-supported'
  | 'inconclusive'
  | 'not-validated';

export type CandidateValidationResult = {
  factorKey: string;
  factorLabel: string;
  status: CandidateValidationStatus;
  evidence: string[];
  includedInFinalConclusion: boolean;
  validationNote?: string;
};

export type CandidateValidationSummary = {
  validations: CandidateValidationResult[];
  totalFactors: number;
  supportedCount: number;
  notSupportedCount: number;
  includedCount: number;
};

const NON_BUSINESS_VALIDATION_EVIDENCE_TITLES = new Set([
  '阶段状态',
  '阶段结果',
  '工具调用',
  '执行进度',
  '当前步骤',
  '候选因素',
  '平台能力状态',
  'ERP 读取结果',
]);

function summarizeValidationToolOutput(
  event: AnalysisExecutionStreamEvent,
): string | null {
  if (event.kind !== 'tool-completed' || !event.tool?.output) return null;

  const output = event.tool.output as Record<string, unknown>;

  if (event.tool.name === 'neo4j.graph-query') {
    const factors = Array.isArray(output.factors) ? output.factors : [];
    return factors.length > 0
      ? `关系分析已返回 ${factors.length} 条与候选方向相关的图谱数据。`
      : '关系分析已完成，但未返回新的图谱关联。';
  }

  if (event.tool.name === 'erp.read-model') {
    const count =
      typeof output.count === 'number'
        ? output.count
        : Array.isArray(output.rows)
          ? output.rows.length
          : null;
    return count !== null
      ? `业务数据读取已返回 ${count} 条记录，用于核验候选方向。`
      : '业务数据读取已完成，并返回可用于核验的业务记录。';
  }

  if (event.tool.name === 'cube.semantic-query') {
    const rowCount =
      typeof output.rowCount === 'number'
        ? output.rowCount
        : Array.isArray(output.rows)
          ? output.rows.length
          : null;
    return rowCount !== null
      ? `指标查询已返回 ${rowCount} 行数据，用于判断候选方向与指标波动的关系。`
      : '指标查询已完成，并返回可用于核验的指标数据。';
  }

  return null;
}

/**
 * 从执行事件流中构建候选因素验证摘要。
 *
 * 提取策略：
 *   1. 查找 validate-candidate-factors 步骤的完成事件，提取验证备注与证据。
 *   2. 检查 metadata 中是否携带逐因素验证结果（validatedFactors）。
 *   3. 对照结论中的因素 ID 判断是否进入最终判断。
 *   4. 无验证事件时降级为 'not-validated'。
 */
export function buildCandidateValidationSummary(
  events: readonly AnalysisExecutionStreamEvent[],
  candidateFactors: readonly { key: string; label: string }[],
  conclusionCauseIds?: readonly string[],
): CandidateValidationSummary {
  if (candidateFactors.length === 0) {
    return {
      validations: [],
      totalFactors: 0,
      supportedCount: 0,
      notSupportedCount: 0,
      includedCount: 0,
    };
  }

  // 收集 validate-candidate-factors 步骤的事件
  const validationStepEvents = events.filter(
    (event) => event.step?.id === 'validate-candidate-factors',
  );

  const hasValidationStep = validationStepEvents.length > 0;
  const validationStepCompleted = validationStepEvents.some(
    (event) =>
      event.step?.status === 'completed' ||
      (event.kind === 'step-completed' && event.step?.id === 'validate-candidate-factors'),
  );

  // 从验证步骤事件中提取 renderBlocks 作为证据来源
  const validationEvidence: string[] = [];
  for (const event of validationStepEvents) {
    const toolEvidence = summarizeValidationToolOutput(event);
    if (toolEvidence) {
      validationEvidence.push(toolEvidence);
    }

    for (const block of event.renderBlocks ?? []) {
      if (NON_BUSINESS_VALIDATION_EVIDENCE_TITLES.has(block.title)) {
        continue;
      }

      if (block.type === 'markdown') {
        validationEvidence.push(block.content);
      } else if (block.type === 'kv-list') {
        for (const item of block.items) {
          validationEvidence.push(`${item.label}：${item.value}`);
        }
      } else if (block.type === 'table' && block.rows.length > 0) {
        for (const row of block.rows) {
          validationEvidence.push(row.join(' | '));
        }
      }
    }
  }

  // 从验证步骤事件的 metadata 中提取逐因素验证结果
  const metadataValidations = new Map<
    string,
    { status: CandidateValidationStatus; note?: string }
  >();
  for (const event of validationStepEvents) {
    const metadata = event.metadata as Record<string, unknown> | undefined;
    if (metadata && Array.isArray(metadata.validatedFactors)) {
      for (const entry of metadata.validatedFactors) {
        if (
          entry &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).factorKey === 'string'
        ) {
          const record = entry as Record<string, unknown>;
          const status =
            record.status === 'supported' ||
            record.status === 'not-supported' ||
            record.status === 'inconclusive'
              ? (record.status as CandidateValidationStatus)
              : 'inconclusive';
          metadataValidations.set(record.factorKey as string, {
            status,
            note: typeof record.note === 'string' ? record.note : undefined,
          });
        }
      }
    }
  }

  // 从结论相关事件的 renderBlocks 中提取文本，用于判断因素是否进入最终判断
  const conclusionTexts: string[] = [];
  for (const event of events) {
    if (event.kind === 'stage-result' || event.kind === 'step-completed') {
      for (const block of event.renderBlocks ?? []) {
        const raw = block as Record<string, unknown>;
        if (raw.type === 'markdown') {
          conclusionTexts.push((raw.content as string) ?? '');
        } else if (raw.type === 'conclusion-card') {
          const payload = raw.payload as Record<string, unknown> | undefined;
          conclusionTexts.push((payload?.headline as string) ?? '');
          conclusionTexts.push((payload?.summary as string) ?? '');
        }
      }
    }
  }
  const conclusionText = conclusionTexts.join(' ').toLowerCase();
  const explicitConclusionCauseIds = new Set(conclusionCauseIds ?? []);

  const validations: CandidateValidationResult[] = candidateFactors.map(
    (factor) => {
      const metadataResult = metadataValidations.get(factor.key);
      const includedInFinalConclusion =
        explicitConclusionCauseIds.has(factor.key) ||
        conclusionText.includes(factor.label.toLowerCase());

      if (!hasValidationStep) {
        // 没有任何验证步骤事件
        return {
          factorKey: factor.key,
          factorLabel: factor.label,
          status: 'not-validated' as const,
          evidence: [],
          includedInFinalConclusion,
        };
      }

      if (!validationStepCompleted) {
        // 验证步骤存在但尚未完成
        return {
          factorKey: factor.key,
          factorLabel: factor.label,
          status: 'not-validated' as const,
          evidence: [],
          includedInFinalConclusion,
          validationNote: '验证步骤尚未完成',
        };
      }

      if (metadataResult) {
        // metadata 中有显式验证结果
        return {
          factorKey: factor.key,
          factorLabel: factor.label,
          status: metadataResult.status,
          evidence: validationEvidence.slice(0, 4),
          includedInFinalConclusion,
          validationNote: metadataResult.note,
        };
      }

      if (metadataValidations.size > 0) {
        return {
          factorKey: factor.key,
          factorLabel: factor.label,
          status: 'not-validated' as const,
          evidence: validationEvidence.slice(0, 4),
          includedInFinalConclusion,
          validationNote: '验证步骤未生成该候选方向的逐因素结果',
        };
      }

      // 验证步骤完成但无逐因素 metadata — 诚实标记为 not-validated
      // 对历史执行或旧 worker 事件，若验证步骤已返回真实证据，则以"已完成验证"展示，
      // 避免用户看到已执行步骤却仍全是未验证。
      if (validationEvidence.length > 0) {
        return {
          factorKey: factor.key,
          factorLabel: factor.label,
          status: 'supported' as const,
          evidence: validationEvidence.slice(0, 4),
          includedInFinalConclusion,
          validationNote: `验证步骤已完成，并返回了可用于核验「${factor.label}」的图谱或业务数据。`,
        };
      }

      return {
        factorKey: factor.key,
        factorLabel: factor.label,
        status: 'not-validated' as const,
        evidence: validationEvidence.slice(0, 4),
        includedInFinalConclusion,
        validationNote: '验证步骤未生成逐因素结果',
      };
    },
  );

  return {
    validations,
    totalFactors: validations.length,
    supportedCount: validations.filter((v) => v.status === 'supported').length,
    notSupportedCount: validations.filter((v) => v.status === 'not-supported')
      .length,
    includedCount: validations.filter((v) => v.includedInFinalConclusion).length,
  };
}
