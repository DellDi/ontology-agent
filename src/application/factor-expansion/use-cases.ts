import type { AnalysisContextReadModel } from '@/application/analysis-context/use-cases';
import type { GraphCandidateFactor } from '@/domain/graph/models';
import {
  expandCandidateFactors,
  type CandidateFactor,
} from '@/domain/factor-expansion/models';
import type { AnalysisIntentType } from '@/domain/analysis-intent/models';
import type { ReturnTypeOfCreateGraphUseCases } from '@/shared/types/graph';
import { translateEdgeKind, translateDirection, translateEvidenceSource } from './graph-edge-translations';

export type CandidateFactorReadModel = {
  mode: 'expand' | 'skip';
  headline: string;
  disclaimer: string;
  skipReason?: string;
  basisLabel: string;
  factors: (CandidateFactor & {
    relationType?: string;
    direction?: string;
    source?: string;
  })[];
};

function normalizeGraphEvidenceText(factor: GraphCandidateFactor) {
  return [
    factor.factorKey,
    factor.factorLabel,
    factor.explanation,
    factor.relationType,
  ]
    .join(' ')
    .toLowerCase();
}

function buildReadableGraphFactor(
  factor: GraphCandidateFactor,
): CandidateFactorReadModel['factors'][number] {
  const evidenceText = normalizeGraphEvidenceText(factor);
  const relationType = translateEdgeKind(factor.relationType);
  const direction = translateDirection(factor.direction);
  const source = translateEvidenceSource(factor.source);

  if (evidenceText.includes('receivable')) {
    return {
      key: 'receivable-billing-scope',
      label: '应收账单与收费口径',
      rationale:
        '图谱显示当前项目与应收数据相连，需要核对应收金额、账单生成、收费项目和统计口径是否发生变化；这些变化会直接影响物业费收缴率的分母与可收金额。',
      relationType,
      direction,
      source,
    };
  }

  if (evidenceText.includes('payment')) {
    return {
      key: 'payment-posting-progress',
      label: '缴费入账与回款记录',
      rationale:
        '图谱显示当前项目与缴费记录相连，需要核对本期缴费是否已入账、是否存在延迟入账或回款批次变化；这些因素会影响收缴率的实际回款表现。',
      relationType,
      direction,
      source,
    };
  }

  if (
    evidenceText.includes('serviceorder') ||
    evidenceText.includes('service-order')
  ) {
    return {
      key: 'service-order-fulfillment',
      label: '工单服务履约影响',
      rationale:
        '图谱显示当前项目与工单记录相连，需要核对报修处理、服务响应和闭环时效是否影响业主缴费意愿；服务体验异常通常会间接影响物业费收缴。',
      relationType,
      direction,
      source,
    };
  }

  if (evidenceText.includes('complaint')) {
    return {
      key: 'complaint-service-experience',
      label: '投诉与服务体验',
      rationale:
        '图谱显示当前项目与投诉记录相连，需要核对投诉量、投诉类型和处理结果是否影响业主缴费意愿。',
      relationType,
      direction,
      source,
    };
  }

  if (evidenceText.includes('satisfaction')) {
    return {
      key: 'satisfaction-service-feedback',
      label: '满意度评价反馈',
      rationale:
        '图谱显示当前项目与满意度评价相连，需要核对满意度变化是否反映服务体验变化，并进一步判断其对缴费行为的影响。',
      relationType,
      direction,
      source,
    };
  }

  if (evidenceText.includes('owner')) {
    return {
      key: 'owner-payment-scope',
      label: '业主缴费主体范围',
      rationale:
        '图谱显示当前项目与业主信息相连，需要核对缴费主体范围、入住或业主状态是否变化；主体范围变化会影响可收户数和收缴率口径。',
      relationType,
      direction,
      source,
    };
  }

  return {
    key: factor.factorKey,
    label: factor.factorLabel,
    rationale: factor.explanation,
    relationType,
    direction,
    source,
  };
}

function mapGraphFactors(
  factors: readonly GraphCandidateFactor[],
): CandidateFactorReadModel['factors'] {
  const byKey = new Map<string, CandidateFactorReadModel['factors'][number]>();

  for (const factor of factors) {
    const readable = buildReadableGraphFactor(factor);
    if (byKey.has(readable.key)) continue;
    byKey.set(readable.key, readable);
  }

  return [...byKey.values()];
}

type GraphUseCases = {
  expandCandidateFactors: ReturnTypeOfCreateGraphUseCases['expandCandidateFactors'];
};

export function createFactorExpansionUseCases({
  graphUseCases,
}: {
  graphUseCases: GraphUseCases;
}) {
  return {
    async buildCandidateFactorReadModel({
      intentType,
      questionText,
      contextReadModel,
    }: {
      intentType: AnalysisIntentType;
      questionText: string;
      contextReadModel: AnalysisContextReadModel;
    }): Promise<CandidateFactorReadModel> {
      let graphResult:
        | Awaited<ReturnType<GraphUseCases['expandCandidateFactors']>>
        | null = null;
      let graphUnavailable = false;

      try {
        graphResult = await graphUseCases.expandCandidateFactors({
          intentType,
          metric: contextReadModel.context.targetMetric.value,
          entity: contextReadModel.context.entity.value,
          timeRange: contextReadModel.context.timeRange.value,
          questionText,
        });
      } catch {
        graphUnavailable = true;
      }

      if (graphResult?.mode === 'expand' && graphResult.factors.length > 0) {
        return {
          mode: 'expand',
          headline: '候选影响因素',
          disclaimer:
            '这些不是最终结论，而是系统把图谱节点归并成业务可理解的候选原因；后续会用指标、图谱和业务数据逐项验证。',
          basisLabel: '为什么它可能相关',
          factors: mapGraphFactors(graphResult.factors),
        };
      }

      const ruleFallback = expandCandidateFactors({
        intentType,
        questionText,
        context: contextReadModel.context,
      });

      return {
        mode: ruleFallback.mode,
        headline:
          ruleFallback.mode === 'expand' ? '候选影响因素' : '候选因素扩展已跳过',
        disclaimer: graphUnavailable
          ? '图谱候选因素暂不可用，系统已回退到治理规则候选方向。'
          : ruleFallback.disclaimer,
        skipReason: ruleFallback.skipReason,
        basisLabel: '与当前指标或实体的相关依据',
        factors: ruleFallback.factors.map((factor) => ({
          ...factor,
          source: translateEvidenceSource('governed-rule'),
        })),
      };
    },
  };
}
