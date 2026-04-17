/**
 * Ontology Grounding 领域模型
 *
 * 将自由文本的 analysis context 映射到 canonical ontology definitions，
 * 为 planner 和 tool selection 提供基于本体约束的输入。
 */

import type {
  OntologyEntityDefinition,
  OntologyFactorDefinition,
  OntologyMetricDefinition,
  OntologyMetricVariant,
  OntologyTimeSemantic,
} from './models';

// ---------------------------------------------------------------------------
// Grounding 状态与结果类型
// ---------------------------------------------------------------------------

export const GROUNDING_STATUS = [
  'success',      // 成功映射到 canonical definitions
  'ambiguous',    // 多候选命中，需要用户选择
  'failed',       // 无法映射，明确缺失
  'partial',      // 部分成功，部分字段 grounding 失败
] as const;

export type GroundingStatus = (typeof GROUNDING_STATUS)[number];

export type GroundedEntity = {
  status: 'success' | 'ambiguous' | 'failed';
  originalText: string;
  canonicalDefinition: OntologyEntityDefinition | null;
  candidates: OntologyEntityDefinition[]; // ambiguous 时填充候选列表
  confidence: number; // 0-1
  failureReason?: string; // failed 时的原因
};

export type GroundedMetric = {
  status: 'success' | 'ambiguous' | 'failed';
  originalText: string;
  canonicalDefinition: OntologyMetricDefinition | null;
  variant: OntologyMetricVariant | null; // 如有 variant 治理定义
  candidates: OntologyMetricDefinition[];
  confidence: number;
  failureReason?: string;
};

export type GroundedFactor = {
  status: 'success' | 'ambiguous' | 'failed';
  originalText: string;
  canonicalDefinition: OntologyFactorDefinition | null;
  candidates: OntologyFactorDefinition[];
  confidence: number;
  failureReason?: string;
};

export type GroundedTimeSemantic = {
  status: 'success' | 'ambiguous' | 'failed';
  originalText: string;
  canonicalDefinition: OntologyTimeSemantic | null;
  candidates: OntologyTimeSemantic[];
  confidence: number;
  failureReason?: string;
};

// ---------------------------------------------------------------------------
// Grounding 上下文：供 planner 消费的受控 read model
// ---------------------------------------------------------------------------

export type OntologyGroundedContext = {
  ontologyVersionId: string;
  groundingStatus: GroundingStatus;

  // 核心 grounding 结果
  entities: GroundedEntity[];
  metrics: GroundedMetric[];
  factors: GroundedFactor[];
  timeSemantics: GroundedTimeSemantic[];

  // 原始自由文本的引用（供显示和追问）
  originalMergedContext: string;

  // grounding 元数据
  groundedAt: string;
  groundingStrategy: 'exact-match' | 'synonym-match' | 'semantic-similarity' | 'llm-assisted';

  // 失败/歧义时的诊断信息
  diagnostics?: {
    unmatchedEntities: string[];
    unmatchedMetrics: string[];
    unmatchedFactors: string[];
    ambiguousMatches: Array<{
      type: 'entity' | 'metric' | 'factor' | 'time';
      originalText: string;
      candidateCount: number;
    }>;
  };
};

// ---------------------------------------------------------------------------
// Grounding 失败类型
// ---------------------------------------------------------------------------

export class OntologyGroundingError extends Error {
  constructor(
    message: string,
    public readonly status: GroundingStatus,
    public readonly details: {
      ontologyVersionId: string;
      failedItems: Array<{
        type: 'entity' | 'metric' | 'factor' | 'time' | 'version' | 'permission';
        text: string;
        reason: string;
      }>;
      ambiguousItems?: Array<{
        type: 'entity' | 'metric' | 'factor' | 'time' | 'version' | 'permission';
        text: string;
        candidates: string[];
      }>;
    },
  ) {
    super(message);
    this.name = 'OntologyGroundingError';
  }
}

// ---------------------------------------------------------------------------
// Grounding 策略类型
// ---------------------------------------------------------------------------

export type GroundingStrategy = {
  // 匹配策略配置
  exactMatchKeys: string[]; // 优先精确匹配的业务键
  synonymMatchEnabled: boolean;
  semanticSimilarityThreshold: number; // 0-1

  // 歧义处理策略
  maxCandidatesToShow: number; // ambiguous 时展示的最大候选数
  minConfidenceThreshold: number; // 低于此值视为 failed

  // 回退策略（仅在 transitional path 中启用）
  allowFallbackToFreeText: boolean; // 默认 false，临时兼容路径
};

export const DEFAULT_GROUNDING_STRATEGY: GroundingStrategy = {
  exactMatchKeys: ['businessKey', 'displayName'],
  synonymMatchEnabled: true,
  semanticSimilarityThreshold: 0.7,
  maxCandidatesToShow: 3,
  minConfidenceThreshold: 0.5,
  allowFallbackToFreeText: false, // 默认关闭，9.3 后不应静默回退
};

// ---------------------------------------------------------------------------
// Helper 函数
// ---------------------------------------------------------------------------

export function isGroundingSuccess(context: OntologyGroundedContext): boolean {
  return context.groundingStatus === 'success';
}

export function isGroundingBlocked(context: OntologyGroundedContext): boolean {
  return context.groundingStatus === 'ambiguous' || context.groundingStatus === 'failed';
}

export function getGroundingFailures(context: OntologyGroundedContext): Array<{
  type: 'entity' | 'metric' | 'factor' | 'time';
  originalText: string;
  reason: string;
}> {
  const failures: Array<{ type: 'entity' | 'metric' | 'factor' | 'time'; originalText: string; reason: string }> = [];

  context.entities
    .filter((e) => e.status === 'failed')
    .forEach((e) => failures.push({ type: 'entity', originalText: e.originalText, reason: e.failureReason ?? '未匹配' }));

  context.metrics
    .filter((m) => m.status === 'failed')
    .forEach((m) => failures.push({ type: 'metric', originalText: m.originalText, reason: m.failureReason ?? '未匹配' }));

  context.factors
    .filter((f) => f.status === 'failed')
    .forEach((f) => failures.push({ type: 'factor', originalText: f.originalText, reason: f.failureReason ?? '未匹配' }));

  context.timeSemantics
    .filter((t) => t.status === 'failed')
    .forEach((t) => failures.push({ type: 'time', originalText: t.originalText, reason: t.failureReason ?? '未匹配' }));

  return failures;
}

export function getGroundingAmbiguities(context: OntologyGroundedContext): Array<{
  type: 'entity' | 'metric' | 'factor' | 'time';
  originalText: string;
  candidates: Array<{ key: string; displayName: string }>;
}> {
  const ambiguities: Array<{ type: 'entity' | 'metric' | 'factor' | 'time'; originalText: string; candidates: Array<{ key: string; displayName: string }> }> = [];

  context.entities
    .filter((e) => e.status === 'ambiguous')
    .forEach((e) => ambiguities.push({
      type: 'entity',
      originalText: e.originalText,
      candidates: e.candidates.map((c) => ({ key: c.businessKey, displayName: c.displayName })),
    }));

  context.metrics
    .filter((m) => m.status === 'ambiguous')
    .forEach((m) => ambiguities.push({
      type: 'metric',
      originalText: m.originalText,
      candidates: m.candidates.map((c) => ({ key: c.businessKey, displayName: c.displayName })),
    }));

  context.factors
    .filter((f) => f.status === 'ambiguous')
    .forEach((f) => ambiguities.push({
      type: 'factor',
      originalText: f.originalText,
      candidates: f.candidates.map((c) => ({ key: c.businessKey, displayName: c.displayName })),
    }));

  context.timeSemantics
    .filter((t) => t.status === 'ambiguous')
    .forEach((t) => ambiguities.push({
      type: 'time',
      originalText: t.originalText,
      candidates: t.candidates.map((c) => ({ key: c.businessKey, displayName: c.displayName })),
    }));

  return ambiguities;
}

// ---------------------------------------------------------------------------
// 遗留兼容投影（transitional path）
// ---------------------------------------------------------------------------

/**
 * 用于渐进迁移：从 grounded context 提取 legacy context 格式
 * 标记为 transitional，明确这是临时兼容而非主路径
 */
export function toLegacyContextProjection(
  groundedContext: OntologyGroundedContext,
): {
  entityKeys: string[];
  metricKeys: string[];
  factorKeys: string[];
  timeSemanticKeys: string[];
  freeTextSummary: string;
  _transitional: true;
  _groundedSource: string; // grounded context 版本引用
} {
  return {
    entityKeys: groundedContext.entities
      .filter((e) => e.status === 'success' && e.canonicalDefinition)
      .map((e) => e.canonicalDefinition!.businessKey),
    metricKeys: groundedContext.metrics
      .filter((m) => m.status === 'success' && m.canonicalDefinition)
      .map((m) => m.canonicalDefinition!.businessKey),
    factorKeys: groundedContext.factors
      .filter((f) => f.status === 'success' && f.canonicalDefinition)
      .map((f) => f.canonicalDefinition!.businessKey),
    timeSemanticKeys: groundedContext.timeSemantics
      .filter((t) => t.status === 'success' && t.canonicalDefinition)
      .map((t) => t.canonicalDefinition!.businessKey),
    freeTextSummary: groundedContext.originalMergedContext,
    _transitional: true,
    _groundedSource: groundedContext.ontologyVersionId,
  };
}
