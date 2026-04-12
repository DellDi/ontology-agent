/**
 * Ontology Grounding 应用层 Use Cases
 *
 * 将自由文本 context 映射到 canonical ontology definitions
 */

import type { AnalysisContext } from '@/domain/analysis-context/models';
import type {
  GroundedEntity,
  GroundedFactor,
  GroundedMetric,
  GroundedTimeSemantic,
  GroundingStatus,
  OntologyGroundedContext,
  GroundingStrategy,
} from '@/domain/ontology/grounding';
import { DEFAULT_GROUNDING_STRATEGY } from '@/domain/ontology/grounding';
import {
  isGroundingBlocked,
  OntologyGroundingError,
} from '@/domain/ontology/grounding';
import type {
  OntologyEntityDefinition,
  OntologyFactorDefinition,
  OntologyMetricDefinition,
  OntologyMetricVariant,
  OntologyTimeSemantic,
  OntologyVersion,
} from '@/domain/ontology/models';
import { isActiveForRuntime } from '@/domain/ontology/models';

import type {
  OntologyEntityDefinitionStore,
  OntologyFactorDefinitionStore,
  OntologyMetricDefinitionStore,
  OntologyMetricVariantStore,
  OntologyTimeSemanticStore,
  OntologyVersionStore,
} from './ports';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export type OntologyGroundingDependencies = {
  versionStore: OntologyVersionStore;
  entityStore: OntologyEntityDefinitionStore;
  metricStore: OntologyMetricDefinitionStore;
  factorStore: OntologyFactorDefinitionStore;
  metricVariantStore: OntologyMetricVariantStore;
  timeSemanticStore: OntologyTimeSemanticStore;
};

// ---------------------------------------------------------------------------
// Grounding 结果存储端口（新增）
// ---------------------------------------------------------------------------

export type OntologyGroundedContextStore = {
  save(context: OntologyGroundedContext & { sessionId: string; ownerUserId: string }): Promise<void>;
  getLatest(sessionId: string): Promise<(OntologyGroundedContext & { sessionId: string; ownerUserId: string }) | null>;
  getByVersion(sessionId: string, version: number): Promise<(OntologyGroundedContext & { sessionId: string; ownerUserId: string }) | null>;
};

// ---------------------------------------------------------------------------
// Internal: 匹配逻辑
// ---------------------------------------------------------------------------

type MatchResult<T> =
  | { status: 'success'; item: T; confidence: number }
  | { status: 'ambiguous'; candidates: T[]; confidence: number }
  | { status: 'failed'; reason: string; confidence: number };

function matchEntity(
  text: string,
  definitions: OntologyEntityDefinition[],
  strategy: GroundingStrategy,
): MatchResult<OntologyEntityDefinition> {
  // 1. 精确匹配 businessKey
  const exactKeyMatch = definitions.find((d) => d.businessKey.toLowerCase() === text.toLowerCase());
  if (exactKeyMatch) {
    return { status: 'success', item: exactKeyMatch, confidence: 1.0 };
  }

  // 2. 精确匹配 displayName
  const exactNameMatch = definitions.find((d) => d.displayName.toLowerCase() === text.toLowerCase());
  if (exactNameMatch) {
    return { status: 'success', item: exactNameMatch, confidence: 0.95 };
  }

  // 3. 同义词匹配
  if (strategy.synonymMatchEnabled) {
    const synonymMatch = definitions.find((d) =>
      d.synonyms.some((s) => s.toLowerCase() === text.toLowerCase()),
    );
    if (synonymMatch) {
      return { status: 'success', item: synonymMatch, confidence: 0.9 };
    }
  }

  // 4. 部分匹配（简化实现：检查是否包含）
  const partialMatches = definitions.filter(
    (d) =>
      d.businessKey.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.businessKey.toLowerCase()) ||
      d.displayName.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.displayName.toLowerCase()),
  );

  if (partialMatches.length === 1) {
    return { status: 'success', item: partialMatches[0], confidence: 0.7 };
  }

  if (partialMatches.length > 1) {
    const topCandidates = partialMatches.slice(0, strategy.maxCandidatesToShow);
    return { status: 'ambiguous', candidates: topCandidates, confidence: 0.6 };
  }

  return { status: 'failed', reason: `未能找到与 "${text}" 匹配的实体定义`, confidence: 0 };
}

function matchMetric(
  text: string,
  definitions: OntologyMetricDefinition[],
  strategy: GroundingStrategy,
): MatchResult<OntologyMetricDefinition> {
  // 与 entity 类似的匹配逻辑
  const exactKeyMatch = definitions.find((d) => d.businessKey.toLowerCase() === text.toLowerCase());
  if (exactKeyMatch) {
    return { status: 'success', item: exactKeyMatch, confidence: 1.0 };
  }

  const exactNameMatch = definitions.find((d) => d.displayName.toLowerCase() === text.toLowerCase());
  if (exactNameMatch) {
    return { status: 'success', item: exactNameMatch, confidence: 0.95 };
  }

  const partialMatches = definitions.filter(
    (d) =>
      d.businessKey.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.businessKey.toLowerCase()) ||
      d.displayName.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.displayName.toLowerCase()),
  );

  if (partialMatches.length === 1) {
    return { status: 'success', item: partialMatches[0], confidence: 0.7 };
  }

  if (partialMatches.length > 1) {
    const topCandidates = partialMatches.slice(0, strategy.maxCandidatesToShow);
    return { status: 'ambiguous', candidates: topCandidates, confidence: 0.6 };
  }

  return { status: 'failed', reason: `未能找到与 "${text}" 匹配的指标定义`, confidence: 0 };
}

function matchFactor(
  text: string,
  definitions: OntologyFactorDefinition[],
  strategy: GroundingStrategy,
): MatchResult<OntologyFactorDefinition> {
  const exactKeyMatch = definitions.find((d) => d.businessKey.toLowerCase() === text.toLowerCase());
  if (exactKeyMatch) {
    return { status: 'success', item: exactKeyMatch, confidence: 1.0 };
  }

  const exactNameMatch = definitions.find((d) => d.displayName.toLowerCase() === text.toLowerCase());
  if (exactNameMatch) {
    return { status: 'success', item: exactNameMatch, confidence: 0.95 };
  }

  const partialMatches = definitions.filter(
    (d) =>
      d.businessKey.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.businessKey.toLowerCase()) ||
      d.displayName.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.displayName.toLowerCase()),
  );

  if (partialMatches.length === 1) {
    return { status: 'success', item: partialMatches[0], confidence: 0.7 };
  }

  if (partialMatches.length > 1) {
    const topCandidates = partialMatches.slice(0, strategy.maxCandidatesToShow);
    return { status: 'ambiguous', candidates: topCandidates, confidence: 0.6 };
  }

  return { status: 'failed', reason: `未能找到与 "${text}" 匹配的因素定义`, confidence: 0 };
}

function matchTimeSemantic(
  text: string,
  definitions: OntologyTimeSemantic[],
  strategy: GroundingStrategy,
): MatchResult<OntologyTimeSemantic> {
  const exactKeyMatch = definitions.find((d) => d.businessKey.toLowerCase() === text.toLowerCase());
  if (exactKeyMatch) {
    return { status: 'success', item: exactKeyMatch, confidence: 1.0 };
  }

  const exactNameMatch = definitions.find((d) => d.displayName.toLowerCase() === text.toLowerCase());
  if (exactNameMatch) {
    return { status: 'success', item: exactNameMatch, confidence: 0.95 };
  }

  // 时间语义的特殊匹配：检查语义类型
  const semanticTypeMatch = definitions.find((d) => d.semanticType.toLowerCase() === text.toLowerCase());
  if (semanticTypeMatch) {
    return { status: 'success', item: semanticTypeMatch, confidence: 0.85 };
  }

  const partialMatches = definitions.filter(
    (d) =>
      d.businessKey.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.businessKey.toLowerCase()) ||
      d.displayName.toLowerCase().includes(text.toLowerCase()) ||
      text.toLowerCase().includes(d.displayName.toLowerCase()),
  );

  if (partialMatches.length === 1) {
    return { status: 'success', item: partialMatches[0], confidence: 0.7 };
  }

  if (partialMatches.length > 1) {
    const topCandidates = partialMatches.slice(0, strategy.maxCandidatesToShow);
    return { status: 'ambiguous', candidates: topCandidates, confidence: 0.6 };
  }

  return { status: 'failed', reason: `未能找到与 "${text}" 匹配的时间语义定义`, confidence: 0 };
}

// ---------------------------------------------------------------------------
// Use Cases
// ---------------------------------------------------------------------------

export function createOntologyGroundingUseCases(
  deps: OntologyGroundingDependencies,
  strategy: GroundingStrategy = DEFAULT_GROUNDING_STRATEGY,
) {
  return {
    /**
     * 将 AnalysisContext 映射到 OntologyGroundedContext
     *
     * AC1: context extraction 后必须先 grounding 再进入 planner
     */
    /* eslint-disable @typescript-eslint/no-unused-vars */
    async groundAnalysisContext({
      sessionId, // 将来用于保存到 grounded context store
      ownerUserId, // 将来用于权限校验和保存
      analysisContext,
      preferredVersionId,
    }: {
      sessionId: string;
      ownerUserId: string;
      analysisContext: AnalysisContext;
      preferredVersionId?: string; // 如指定，使用特定版本；否则使用当前 approved 版本
    }): Promise<OntologyGroundedContext> {
      // 1. 获取 ontology version
      let version: OntologyVersion | null;
      if (preferredVersionId) {
        version = await deps.versionStore.findById(preferredVersionId);
      } else {
        version = await deps.versionStore.findCurrentApproved();
      }

      if (!version) {
        throw new OntologyGroundingError(
          '无法找到可用的 Ontology Version',
          'failed',
          {
            ontologyVersionId: preferredVersionId ?? 'current-approved',
            failedItems: [{ type: 'version', text: 'ontology-version', reason: '无可用版本' }],
          },
        );
      }

      // 2. 获取该版本下的所有 approved definitions
      const [entities, metrics, factors, timeSemantics, metricVariants] = await Promise.all([
        deps.entityStore.findByVersionId(version.id),
        deps.metricStore.findByVersionId(version.id),
        deps.factorStore.findByVersionId(version.id),
        deps.timeSemanticStore.findByVersionId(version.id),
        deps.metricVariantStore.findByVersionId(version.id),
      ]);

      // 过滤出 runtime active 的定义
      const activeEntities = entities.filter((e) => isActiveForRuntime(e.status));
      const activeMetrics = metrics.filter((m) => isActiveForRuntime(m.status));
      const activeFactors = factors.filter((f) => isActiveForRuntime(f.status));
      const activeTimeSemantics = timeSemantics.filter((t) => isActiveForRuntime(t.status));
      const activeMetricVariants = metricVariants.filter((v) => isActiveForRuntime(v.status));

      // 3. 逐个 grounding
      const groundedEntities: GroundedEntity[] = [];
      const groundedMetrics: GroundedMetric[] = [];
      const groundedFactors: GroundedFactor[] = [];
      const groundedTimeSemantics: GroundedTimeSemantic[] = [];

      // Ground entity (从 analysisContext.entity 提取)
      if (analysisContext.entity.value && analysisContext.entity.value !== '待补充实体对象') {
        const match = matchEntity(analysisContext.entity.value, activeEntities, strategy);
        groundedEntities.push({
          status: match.status,
          originalText: analysisContext.entity.value,
          canonicalDefinition: match.status === 'success' ? match.item : null,
          candidates: match.status === 'ambiguous' ? match.candidates : [],
          confidence: match.confidence,
          failureReason: match.status === 'failed' ? match.reason : undefined,
        });
      }

      // Ground metrics (从 analysisContext.targetMetric 提取)
      if (analysisContext.targetMetric.value && analysisContext.targetMetric.value !== '待补充目标指标') {
        const match = matchMetric(analysisContext.targetMetric.value, activeMetrics, strategy);
        const matchedMetric = match.status === 'success' ? match.item : null;

        // 查找关联的 variant
        let matchedVariant: OntologyMetricVariant | null = null;
        if (matchedMetric) {
          matchedVariant =
            activeMetricVariants.find((v) => v.parentMetricDefinitionId === matchedMetric.id) ?? null;
        }

        groundedMetrics.push({
          status: match.status,
          originalText: analysisContext.targetMetric.value,
          canonicalDefinition: matchedMetric,
          variant: matchedVariant,
          candidates: match.status === 'ambiguous' ? match.candidates : [],
          confidence: match.confidence,
          failureReason: match.status === 'failed' ? match.reason : undefined,
        });
      }

      // Ground factors (从 constraints 中提取可能的 factor 相关约束)
      const factorConstraints = analysisContext.constraints.filter(
        (c) => c.label.includes('因素') || c.label.includes('因子') || c.label.includes('维度')
      );
      for (const constraint of factorConstraints) {
        const match = matchFactor(constraint.value, activeFactors, strategy);
        groundedFactors.push({
          status: match.status,
          originalText: constraint.value,
          canonicalDefinition: match.status === 'success' ? match.item : null,
          candidates: match.status === 'ambiguous' ? match.candidates : [],
          confidence: match.confidence,
          failureReason: match.status === 'failed' ? match.reason : undefined,
        });
      }

      // Ground time semantics (从 analysisContext.timeRange 提取)
      if (analysisContext.timeRange.value && analysisContext.timeRange.value !== '待补充时间范围') {
        const match = matchTimeSemantic(analysisContext.timeRange.value, activeTimeSemantics, strategy);
        groundedTimeSemantics.push({
          status: match.status,
          originalText: analysisContext.timeRange.value,
          canonicalDefinition: match.status === 'success' ? match.item : null,
          candidates: match.status === 'ambiguous' ? match.candidates : [],
          confidence: match.confidence,
          failureReason: match.status === 'failed' ? match.reason : undefined,
        });
      }

      // 4. 计算整体 grounding status
      let groundingStatus: GroundingStatus = 'success';
      const allResults = [...groundedEntities, ...groundedMetrics, ...groundedFactors, ...groundedTimeSemantics];

      const failedCount = allResults.filter((r) => r.status === 'failed').length;
      const ambiguousCount = allResults.filter((r) => r.status === 'ambiguous').length;
      const successCount = allResults.filter((r) => r.status === 'success').length;

      if (failedCount > 0 && successCount === 0) {
        groundingStatus = 'failed';
      } else if (failedCount > 0 && successCount > 0) {
        groundingStatus = 'partial';
      } else if (ambiguousCount > 0) {
        groundingStatus = 'ambiguous';
      }

      // 5. 构建 merged context 文本（保留原始自由文本）
      const originalMergedContext = `
目标指标: ${analysisContext.targetMetric.value}
实体对象: ${analysisContext.entity.value}
时间范围: ${analysisContext.timeRange.value}
比较方式: ${analysisContext.comparison.value}
约束条件: ${analysisContext.constraints.map((c: { label: string; value: string }) => `${c.label}: ${c.value}`).join(', ')}
      `.trim();

      // 6. 构建 diagnostics
      const diagnostics = {
        unmatchedEntities: groundedEntities.filter((e) => e.status === 'failed').map((e) => e.originalText),
        unmatchedMetrics: groundedMetrics.filter((m) => m.status === 'failed').map((m) => m.originalText),
        unmatchedFactors: groundedFactors.filter((f) => f.status === 'failed').map((f) => f.originalText),
        ambiguousMatches: [
          ...groundedEntities.filter((e) => e.status === 'ambiguous').map((e) => ({ type: 'entity' as const, originalText: e.originalText, candidateCount: e.candidates.length })),
          ...groundedMetrics.filter((m) => m.status === 'ambiguous').map((m) => ({ type: 'metric' as const, originalText: m.originalText, candidateCount: m.candidates.length })),
          ...groundedFactors.filter((f) => f.status === 'ambiguous').map((f) => ({ type: 'factor' as const, originalText: f.originalText, candidateCount: f.candidates.length })),
          ...groundedTimeSemantics.filter((t) => t.status === 'ambiguous').map((t) => ({ type: 'time' as const, originalText: t.originalText, candidateCount: t.candidates.length })),
        ],
      };

      const groundedContext: OntologyGroundedContext = {
        ontologyVersionId: version.id,
        groundingStatus,
        entities: groundedEntities,
        metrics: groundedMetrics,
        factors: groundedFactors,
        timeSemantics: groundedTimeSemantics,
        originalMergedContext,
        groundedAt: new Date().toISOString(),
        groundingStrategy: 'exact-match', // 简化：记录主要策略
        diagnostics,
      };

      // 7. 如 grounding 被阻断（ambiguous 或完全 failed），抛出错误供上层处理
      if (isGroundingBlocked(groundedContext) && !strategy.allowFallbackToFreeText) {
        throw new OntologyGroundingError(
          `Ontology grounding ${groundingStatus}: 无法继续生成分析计划`,
          groundingStatus,
          {
            ontologyVersionId: version.id,
            failedItems: allResults
              .filter((r) => r.status === 'failed')
              .map((r) => ({ type: 'unknown', text: r.originalText, reason: r.failureReason ?? '匹配失败' })),
            ambiguousItems: allResults
              .filter((r) => r.status === 'ambiguous')
              .map((r) => ({ type: 'unknown', text: r.originalText, candidates: r.candidates.map((c) => c.businessKey) })),
          },
        );
      }

      return groundedContext;
      /* eslint-enable @typescript-eslint/no-unused-vars */
    },

    /**
     * 获取当前 approved version 的 grounded definitions（用于 tool selection 等场景）
     */
    async getCurrentApprovedDefinitions(): Promise<{
      version: OntologyVersion;
      entities: OntologyEntityDefinition[];
      metrics: OntologyMetricDefinition[];
      factors: OntologyFactorDefinition[];
      timeSemantics: OntologyTimeSemantic[];
      metricVariants: OntologyMetricVariant[];
    } | null> {
      const version = await deps.versionStore.findCurrentApproved();
      if (!version) {
        return null;
      }

      const [entities, metrics, factors, timeSemantics, metricVariants] = await Promise.all([
        deps.entityStore.findByVersionId(version.id),
        deps.metricStore.findByVersionId(version.id),
        deps.factorStore.findByVersionId(version.id),
        deps.timeSemanticStore.findByVersionId(version.id),
        deps.metricVariantStore.findByVersionId(version.id),
      ]);

      return {
        version,
        entities: entities.filter((e) => isActiveForRuntime(e.status)),
        metrics: metrics.filter((m) => isActiveForRuntime(m.status)),
        factors: factors.filter((f) => isActiveForRuntime(f.status)),
        timeSemantics: timeSemantics.filter((t) => isActiveForRuntime(t.status)),
        metricVariants: metricVariants.filter((v) => isActiveForRuntime(v.status)),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Bootstrap / Initialize Use Cases
// ---------------------------------------------------------------------------

export type OntologyBootstrapResult = {
  version: OntologyVersion;
  entitiesCreated: number;
  metricsCreated: number;
  factorsCreated: number;
  planStepTemplatesCreated: number;
  metricVariantsCreated: number;
  timeSemanticsCreated: number;
  causalityEdgesCreated: number;
  evidenceTypesCreated: number;
  skipped: boolean; // 如已存在同版本，则跳过
  message: string;
};

export function createOntologyBootstrapUseCases(deps: OntologyGroundingDependencies) {
  return {
    /**
     * 幂等的 bootstrap 流程：确保 canonical definitions 被装载到 platform schema
     *
     * 满足 AC:
     * - 幂等
     * - 不重复写入同版本 canonical definitions
     * - 不覆盖已发布或已治理版本
     * - 失败时给出明确诊断
     */
    async bootstrapCanonicalDefinitions({
      seedDefinitions,
      requestedVersionId,
      requestedSemver,
      createdBy,
    }: {
      seedDefinitions: {
        entities: Parameters<OntologyEntityDefinitionStore['bulkCreate']>[0];
        metrics: Parameters<OntologyMetricDefinitionStore['bulkCreate']>[0];
        factors: Parameters<OntologyFactorDefinitionStore['bulkCreate']>[0];
        planStepTemplates: Parameters<OntologyPlanStepTemplateStore['bulkCreate']>[0];
        metricVariants: Parameters<OntologyMetricVariantStore['bulkCreate']>[0];
        timeSemantics: Parameters<OntologyTimeSemanticStore['bulkCreate']>[0];
        causalityEdges: Parameters<OntologyCausalityEdgeStore['bulkCreate']>[0];
        evidenceTypes: Parameters<OntologyEvidenceTypeDefinitionStore['bulkCreate']>[0];
      };
      requestedVersionId: string;
      requestedSemver: string;
      createdBy: string;
    }): Promise<OntologyBootstrapResult> {
      const now = new Date().toISOString();

      // 1. 检查是否已存在同 version ID
      const existingVersion = await deps.versionStore.findById(requestedVersionId);

      if (existingVersion) {
        // 版本已存在，检查状态
        if (existingVersion.status === 'approved' || existingVersion.status === 'retired') {
          return {
            version: existingVersion,
            entitiesCreated: 0,
            metricsCreated: 0,
            factorsCreated: 0,
            planStepTemplatesCreated: 0,
            metricVariantsCreated: 0,
            timeSemanticsCreated: 0,
            causalityEdgesCreated: 0,
            evidenceTypesCreated: 0,
            skipped: true,
            message: `Ontology version ${requestedVersionId} (${requestedSemver}) 已存在且已发布/退役，跳过 bootstrap`,
          };
        }

        // 版本存在但未发布（draft/review），不允许覆盖，给出明确诊断
        throw new OntologyGroundingError(
          `Ontology version ${requestedVersionId} 已存在且状态为 ${existingVersion.status}，无法自动覆盖`,
          'failed',
          {
            ontologyVersionId: requestedVersionId,
            failedItems: [{ type: 'version', text: requestedVersionId, reason: `版本已存在，状态: ${existingVersion.status}` }],
          },
        );
      }

      // 2. 创建 ontology version（先创建为 draft，然后更新为 approved）
      let version = await deps.versionStore.create({
        id: requestedVersionId,
        semver: requestedSemver,
        displayName: `Bootstrap ${requestedSemver}`,
        description: '通过 bootstrap 流程初始化的 canonical definitions',
        createdBy,
        createdAt: now,
        updatedAt: now,
      });

      // 更新为 approved 状态
      version = await deps.versionStore.updateStatus(
        version.id,
        'approved',
        now,
        { publishedAt: now, deprecatedAt: null, retiredAt: null },
      );

      // 3. 批量写入 definitions
      const [entities, metrics, factors, metricVariants, timeSemantics] = await Promise.all([
        deps.entityStore.bulkCreate(seedDefinitions.entities),
        deps.metricStore.bulkCreate(seedDefinitions.metrics),
        deps.factorStore.bulkCreate(seedDefinitions.factors),
        deps.metricVariantStore.bulkCreate(seedDefinitions.metricVariants),
        deps.timeSemanticStore.bulkCreate(seedDefinitions.timeSemantics),
      ]);

      // 注意：planStepTemplates, causalityEdges, evidenceTypes 需要额外的 stores
      // 这里简化处理，假设它们已在 seed 中定义但可能需要后续补充

      return {
        version,
        entitiesCreated: entities.length,
        metricsCreated: metrics.length,
        factorsCreated: factors.length,
        planStepTemplatesCreated: 0, // 需补充 store
        metricVariantsCreated: metricVariants.length,
        timeSemanticsCreated: timeSemantics.length,
        causalityEdgesCreated: 0, // 需补充 store
        evidenceTypesCreated: 0, // 需补充 store
        skipped: false,
        message: `成功 bootstrap Ontology version ${requestedVersionId} (${requestedSemver})`,
      };
    },

    /**
     * 检查 bootstrap 状态：返回当前是否已有可用的 approved ontology version
     */
    async checkBootstrapStatus(): Promise<{
      hasApprovedVersion: boolean;
      currentVersion: OntologyVersion | null;
      definitionsCount: {
        entities: number;
        metrics: number;
        factors: number;
        metricVariants: number;
        timeSemantics: number;
      } | null;
    }> {
      const version = await deps.versionStore.findCurrentApproved();

      if (!version) {
        return {
          hasApprovedVersion: false,
          currentVersion: null,
          definitionsCount: null,
        };
      }

      const [entities, metrics, factors, metricVariants, timeSemantics] = await Promise.all([
        deps.entityStore.findByVersionId(version.id),
        deps.metricStore.findByVersionId(version.id),
        deps.factorStore.findByVersionId(version.id),
        deps.metricVariantStore.findByVersionId(version.id),
        deps.timeSemanticStore.findByVersionId(version.id),
      ]);

      return {
        hasApprovedVersion: true,
        currentVersion: version,
        definitionsCount: {
          entities: entities.length,
          metrics: metrics.length,
          factors: factors.length,
          metricVariants: metricVariants.length,
          timeSemantics: timeSemantics.length,
        },
      };
    },
  };
}

// 补充导入
import type { OntologyCausalityEdgeStore, OntologyPlanStepTemplateStore, OntologyEvidenceTypeDefinitionStore } from './ports';
