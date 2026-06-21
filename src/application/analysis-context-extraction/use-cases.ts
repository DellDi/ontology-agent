import type { AnalysisContext } from '@/domain/analysis-context/models';
import { extractAnalysisContext } from '@/domain/analysis-context/models';

import { normalizeLlmExtractionOutput } from './normalization';
import type { ContextExtractionPort } from './ports';
import type {
  LlmContextExtractionInput,
  LlmContextExtractionOutput,
} from './schemas';

export type ExtractionIssue = {
  field: string;
  message: string;
  severity: 'warning' | 'error';
};

export type ContextExtractionResult = {
  context: AnalysisContext;
  source: 'llm' | 'rule-fallback' | 'rule-only';
  confidence: number;
  assumptions: string[];
  needsClarification: boolean;
  issues: ExtractionIssue[];
};

type UseCaseDependencies = {
  extractionPort: ContextExtractionPort;
};

/**
 * 创建上下文抽取用例集合。
 *
 * 执行流程：
 * 1. 调用 extractionPort 进行 LLM 结构化抽取
 * 2. 成功 → 标准化为 AnalysisContext
 * 3. 失败 → 降级到基于规则的 extractAnalysisContext
 * 4. 通过 source 字段区分来源，附带 issues 用于可观测性
 */
export function createContextExtractionUseCases({
  extractionPort,
}: UseCaseDependencies) {
  async function extractContext(
    input: LlmContextExtractionInput,
  ): Promise<ContextExtractionResult> {
    const issues: ExtractionIssue[] = [];
    let llmOutput: LlmContextExtractionOutput | null = null;

    try {
      llmOutput = await extractionPort.extract(input);
    } catch (error) {
      issues.push({
        field: 'llm',
        message:
          error instanceof Error
            ? `智能理解服务不可用：${error.message}`
            : '智能理解服务不可用。',
        severity: 'error',
      });
    }

    if (llmOutput) {
      const normalized = normalizeLlmExtractionOutput(llmOutput, {
        projectNames: input.projectNames,
        metricDictionary: input.metricDictionary,
      });
      const ruleContext = extractAnalysisContext(input.questionText);
      const calibratedContext = { ...normalized.context };

      if (
        !calibratedContext.granularity &&
        ruleContext.granularity?.state === 'confirmed'
      ) {
        calibratedContext.granularity = ruleContext.granularity;
        issues.push({
          field: 'granularity',
          message: `LLM 未返回时间粒度，已根据问题中的「${ruleContext.granularity.label}」表达补齐为 ${ruleContext.granularity.value}。`,
          severity: 'warning',
        });
      }

      return {
        context: calibratedContext,
        source: 'llm',
        confidence: normalized.confidence,
        assumptions: llmOutput.assumptions,
        needsClarification: llmOutput.needsClarification,
        issues,
      };
    }

    // 降级：规则抽取
    const ruleContext = extractAnalysisContext(input.questionText);
    const missingFields: string[] = [];
    if (ruleContext.targetMetric.state === 'missing') {
      missingFields.push('指标');
    }
    if (ruleContext.entity.state === 'missing') {
      missingFields.push('实体');
    }
    if (ruleContext.timeRange.state === 'missing') {
      missingFields.push('时间范围');
    }

    const ruleConfidence =
      missingFields.length === 0
        ? 0.6
        : missingFields.length === 1
          ? 0.4
          : 0.2;

    return {
      context: ruleContext,
      source: issues.length > 0 ? 'rule-fallback' : 'rule-only',
      confidence: ruleConfidence,
      assumptions: [],
      needsClarification: missingFields.length > 0,
      issues: [
        ...issues,
        ...(missingFields.length > 0
          ? [
              {
                field: 'rule',
                message: `规则抽取未能识别：${missingFields.join('、')}。`,
                severity: 'warning' as const,
              },
            ]
          : []),
      ],
    };
  }

  return { extractContext };
}
