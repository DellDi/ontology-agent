/**
 * Composition Root — 统一组装 Infrastructure → Application 依赖。
 *
 * 设计原则：
 * - app 层（page.tsx / route.ts / layout.tsx）只从此文件获取 use-case 实例，
 *   不再直接 import infrastructure 层的具体实现。
 * - 每次调用 createCompositionRoot() 创建新实例（请求级），避免跨请求状态泄漏。
 * - 横切关注点（rate-limit / observability / auth）保留在 infrastructure 层导出，
 *   composition root 仅重新导出以保持 import 一致性。
 *
 * 替代关系：
 * - infrastructure/analysis-intent 的 analysisIntentUseCases 单例 → 此处创建
 * - infrastructure/analysis-context 的 analysisContextUseCases 单例 → 此处创建
 * - infrastructure/analysis-planning 的 analysisPlanningUseCases 单例 → 此处创建
 * - infrastructure/audit 的 auditUseCases 单例 → 此处创建
 * - infrastructure/neo4j 的 graphUseCases 单例 → 此处创建
 * - infrastructure/factor-expansion 的 factorExpansionUseCases 单例 → 此处创建
 * - infrastructure/ontology/runtime 的 createOntologyRuntimeServices → 此处创建
 * - infrastructure/ontology-admin 的 createOntologyAdminRuntime → 此处创建
 * - infrastructure/job/runtime 的 withJobUseCases → 此处重新实现
 * - infrastructure/analysis-context-extraction 的 getLlmContextExtractionUseCases → 此处创建
 * - infrastructure/tooling 的 createAnalysisToolingServices → 此处组装
 */

import { createAnalysisSessionUseCases } from '@/application/analysis-session/use-cases';
import { createAnalysisExecutionStreamUseCases } from '@/application/analysis-execution/stream-use-cases';
import { createAnalysisExecutionPersistenceUseCases } from '@/application/analysis-execution/persistence-use-cases';

import { createAnalysisFollowUpUseCases } from '@/application/follow-up/use-cases';
import { createAnalysisIntentUseCases } from '@/application/analysis-intent/use-cases';
import { createAnalysisContextUseCases } from '@/application/analysis-context/use-cases';
import { createAnalysisPlanningUseCases } from '@/application/analysis-planning/use-cases';
import { createAnalysisUiMessageProjectionUseCases } from '@/application/analysis-message-projection/use-cases';
import { createErpReadUseCases } from '@/application/erp-read/use-cases';
import { createAuditUseCases } from '@/application/audit/use-cases';
import { createGraphUseCases } from '@/application/graph/use-cases';
import { createFactorExpansionUseCases } from '@/application/factor-expansion/use-cases';

import { createJobUseCases } from '@/application/job/use-cases';
import { createContextExtractionUseCases } from '@/application/analysis-context-extraction/use-cases';
import { createAnalysisToolRegistryUseCases } from '@/application/tooling/use-cases';
import { createAnalysisExecutionUseCases } from '@/application/analysis-execution/use-cases';
import { createAiRuntimeToolBridgeFromRegistry } from '@/application/ai-runtime/tool-runtime-bridge';
import { createAnalysisAiUseCases } from '@/application/analysis-ai/use-cases';
import { createOntologyGroundingUseCases } from '@/application/ontology/grounding';
import { createOntologyToolBindingUseCases } from '@/application/ontology/tool-binding-use-cases';
import { createOntologyAdminUseCases } from '@/application/ontology-admin/use-cases';
import { createGovernanceUseCases } from '@/application/ontology/governance-use-cases';
import type { RunInPublishTransaction } from '@/application/ontology/governance-use-cases';

import type { AnalysisIntentStore } from '@/application/analysis-intent/ports';
import type { AnalysisContextStore } from '@/application/analysis-context/ports';
import type { AnalysisSessionStore } from '@/application/analysis-session/ports';
import type { AuditEventStore } from '@/application/audit/ports';

import type { ErpReadPort } from '@/application/erp-read/ports';
import type { AnalysisExecutionSnapshotStore } from '@/application/analysis-execution/persistence-ports';
import type { AnalysisSessionFollowUpStore } from '@/application/follow-up/ports';
import type { OntologyVersionStore } from '@/application/ontology/ports';

import { createMemoryAnalysisIntentStore} from '@/infrastructure/analysis-intent/memory-analysis-intent-store';
import { createMemoryAnalysisContextStore } from '@/infrastructure/analysis-context/memory-analysis-context-store';
import { createPostgresAnalysisSessionStore } from '@/infrastructure/analysis-session/postgres-analysis-session-store';
import { createPostgresAnalysisSessionFollowUpStore } from '@/infrastructure/analysis-session/postgres-analysis-session-follow-up-store';
import { createPostgresAnalysisExecutionSnapshotStore } from '@/infrastructure/analysis-execution/postgres-analysis-execution-snapshot-store';
import { createPostgresAnalysisUiMessageProjectionStore } from '@/infrastructure/analysis-message-projection/postgres-analysis-ui-message-projection-store';
import { createRedisAnalysisExecutionEventStore } from '@/infrastructure/analysis-execution/redis-analysis-execution-event-store';
import { createPostgresAuditEventStore } from '@/infrastructure/audit/postgres-audit-event-store';
import { createNeo4jGraphAdapter } from '@/infrastructure/neo4j/neo4j-graph-adapter';
import { createPostgresErpReadRepository } from '@/infrastructure/erp/postgres-erp-read-repository';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';
import { getSharedRedisClient, ensureRedisConnected, type RedisClient } from '@/infrastructure/redis/client';
import { createPostgresBackedJobQueue } from '@/infrastructure/job/postgres-backed-job-queue';
import { createOpenAiCompatibleLlmProvider } from '@/infrastructure/llm';
import { createLlmContextExtractionAdapter } from '@/infrastructure/analysis-context-extraction/llm-context-extraction-adapter';
import { createAnalysisAiContractPort } from '@/infrastructure/analysis-ai/contract-port';

import { createCubeSemanticQueryServices } from '@/infrastructure/cube';

import { createPostgresOntologyChangeRequestStore } from '@/infrastructure/ontology/postgres-ontology-change-request-store';
import { createPostgresOntologyApprovalRecordStore } from '@/infrastructure/ontology/postgres-ontology-approval-record-store';
import { createPostgresOntologyPublishRecordStore } from '@/infrastructure/ontology/postgres-ontology-publish-record-store';
import { createPostgresOntologyEntityDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-entity-definition-store';
import { createPostgresOntologyFactorDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-factor-definition-store';
import { createPostgresOntologyMetricDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-metric-definition-store';
import { createPostgresOntologyMetricVariantStore } from '@/infrastructure/ontology/postgres-ontology-metric-variant-store';
import { createPostgresOntologyTimeSemanticStore } from '@/infrastructure/ontology/postgres-ontology-time-semantic-store';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { createPostgresGroundedContextStore } from '@/infrastructure/ontology/postgres-grounded-context-store';
import { createPostgresOntologyToolCapabilityBindingStore } from '@/infrastructure/ontology/postgres-ontology-tool-capability-binding-store';
import { createPostgresOntologyCausalityEdgeStore } from '@/infrastructure/ontology/postgres-ontology-causality-edge-store';
import { createPostgresOntologyEvidenceTypeDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-evidence-type-definition-store';
import { createPostgresOntologyPlanStepTemplateStore } from '@/infrastructure/ontology/postgres-ontology-plan-step-template-store';
import { createAnalysisToolingServices } from '@/infrastructure/tooling';

// ---------------------------------------------------------------------------
// Auth helpers (re-exported from infrastructure to avoid direct import in app)
// ---------------------------------------------------------------------------

export {
  getRequestSession,
  requireRequestSession,
  requireWorkspaceSession,
  getWorkspaceSessionState,
  logoutCurrentSession,
  createSessionFromLoginForm,
  createSessionFromCallback,
  createSessionFromDirectoryLogin,
  createSessionFromUrlBridge,
  getDevAuthPageState,
  isDirectoryAuthAvailable,
  isUrlBridgeAvailable,
  mapAuthErrorToMessage,
  mapDirectoryAuthErrorToMessage,
  type WorkspaceSessionState,
} from '@/infrastructure/session/server-auth';

export {
  getOntologyAdminSessionState,
  requireOntologyAdminSession,
  type OntologyAdminSessionState,
} from '@/infrastructure/session/admin-auth';

// ---------------------------------------------------------------------------
// Observability (cross-cutting, kept as infrastructure re-export)
// ---------------------------------------------------------------------------

export {
  createLogger,
  rootLogger,
  getCurrentCorrelationId,
  generateCorrelationId,
  withCorrelation,
  withCorrelationAsync,
  withRequestObservability,
  metrics,
} from '@/infrastructure/observability';

// ---------------------------------------------------------------------------
// Rate-limit (cross-cutting, kept as infrastructure re-export)
// ---------------------------------------------------------------------------

export {
  checkRateLimit,
  buildRateLimitRejectedResponse,
  EXECUTION_RATE_LIMIT,
  FOLLOW_UP_RATE_LIMIT,
  type RateLimitConfig,
  type RateLimitResult,
} from '@/infrastructure/api/rate-limit-middleware';

// ---------------------------------------------------------------------------
// Domain model re-exports (commonly used in app layer)
// ---------------------------------------------------------------------------

export { resolveOntologyVersionBindingForDisplay } from '@/domain/ontology/version-binding';
export { getIntentTypeLabel } from '@/domain/analysis-intent/models';
export { buildAnalysisConclusionReadModel } from '@/domain/analysis-result/models';
export type { AnalysisSessionFollowUp } from '@/domain/analysis-session/follow-up-models';

// ---------------------------------------------------------------------------
// Composition Root
// ---------------------------------------------------------------------------

export interface CompositionRoot {
  // --- analysis-session ---
  analysisSessionUseCases: ReturnType<typeof createAnalysisSessionUseCases>;
  analysisSessionStore: AnalysisSessionStore;

  // --- analysis-execution ---
  analysisExecutionStreamUseCases: ReturnType<typeof createAnalysisExecutionStreamUseCases>;
  analysisExecutionPersistenceUseCases: ReturnType<typeof createAnalysisExecutionPersistenceUseCases>;
  analysisExecutionSnapshotStore: AnalysisExecutionSnapshotStore;

  // --- analysis-follow-up ---
  analysisFollowUpUseCases: ReturnType<typeof createAnalysisFollowUpUseCases>;
  analysisSessionFollowUpStore: AnalysisSessionFollowUpStore;

  // --- analysis-intent ---
  analysisIntentUseCases: ReturnType<typeof createAnalysisIntentUseCases>;

  // --- analysis-context ---
  analysisContextUseCases: ReturnType<typeof createAnalysisContextUseCases>;

  // --- analysis-planning ---
  analysisPlanningUseCases: ReturnType<typeof createAnalysisPlanningUseCases>;

  // --- analysis-message-projection ---
  analysisUiMessageProjectionUseCases: ReturnType<typeof createAnalysisUiMessageProjectionUseCases>;

  // --- factor-expansion ---
  factorExpansionUseCases: ReturnType<typeof createFactorExpansionUseCases>;

  // --- erp-read ---
  erpReadUseCases: ReturnType<typeof createErpReadUseCases>;
  erpReadPort: ErpReadPort;

  // --- audit ---
  auditUseCases: ReturnType<typeof createAuditUseCases>;

  // --- graph ---
  graphUseCases: ReturnType<typeof createGraphUseCases>;

  // --- ontology runtime ---
  ontologyRuntimeServices: {
    versionStore: OntologyVersionStore;
    groundedContextStore: ReturnType<typeof createPostgresGroundedContextStore>;
    groundingUseCases: ReturnType<typeof createOntologyGroundingUseCases>;
    toolBindingUseCases: ReturnType<typeof createOntologyToolBindingUseCases>;
  };

  // --- ontology admin ---
  ontologyAdminRuntime: {
    adminUseCases: ReturnType<typeof createOntologyAdminUseCases>;
    governanceUseCases: ReturnType<typeof createGovernanceUseCases>;
  };

  // --- llm context extraction ---
  llmContextExtractionUseCases: ReturnType<typeof createContextExtractionUseCases>;

  // --- analysis-tooling ---
  analysisToolingServices: {
    toolRegistryUseCases: ReturnType<typeof createAnalysisToolRegistryUseCases>;
    analysisExecutionUseCases: ReturnType<typeof createAnalysisExecutionUseCases>;
    aiRuntimeToolBridge: ReturnType<typeof createAiRuntimeToolBridgeFromRegistry>;
  };

  // --- infrastructure accessors ---
  redisClient: RedisClient;
  ensureRedisConnected: () => Promise<void>;
  withJobUseCases: <T>(
    execute: (services: {
      jobUseCases: ReturnType<typeof createJobUseCases>;
      analysisExecutionStreamUseCases: ReturnType<typeof createAnalysisExecutionStreamUseCases>;
    }) => Promise<T>,
  ) => Promise<T>;
}

/**
 * 创建请求级 Composition Root。
 *
 * 使用方式：
 *   const root = createCompositionRoot();
 *   await root.ensureRedisConnected();
 *   const session = await root.analysisSessionUseCases.getOwnedSession(...);
 */
export function createCompositionRoot(): CompositionRoot {
  const { db } = createPostgresDb();

  // --- stores (request-scoped, all Postgres except intent/context which lack Postgres impl) ---

  const analysisIntentStore: AnalysisIntentStore = createMemoryAnalysisIntentStore();
  const analysisContextStore: AnalysisContextStore = createMemoryAnalysisContextStore();
  const analysisSessionStore = createPostgresAnalysisSessionStore(db);
  const analysisSessionFollowUpStore = createPostgresAnalysisSessionFollowUpStore(db);
  const analysisExecutionSnapshotStore = createPostgresAnalysisExecutionSnapshotStore(db);
  const analysisUiMessageProjectionStore = createPostgresAnalysisUiMessageProjectionStore(db);
  const auditEventStore: AuditEventStore = createPostgresAuditEventStore(db);
  const erpReadPort: ErpReadPort = createPostgresErpReadRepository(db);
  const ontologyVersionStore = createPostgresOntologyVersionStore(db);

  // Redis client (shared singleton)
  const redisClient = getSharedRedisClient();
  const analysisExecutionEventStore = createRedisAnalysisExecutionEventStore(redisClient.redis);

  // Neo4j graph adapter (shared)
  const graphPort = createNeo4jGraphAdapter();

  // --- use-cases (assembled from ports) ---

  const analysisIntentUseCases = createAnalysisIntentUseCases({
    analysisIntentStore,
  });

  const analysisContextUseCases = createAnalysisContextUseCases({
    analysisContextStore,
  });

  const analysisPlanningUseCases = createAnalysisPlanningUseCases();

  const factorExpansionUseCases = createFactorExpansionUseCases({
    graphUseCases: createGraphUseCases({
      graphReadPort: graphPort,
      graphWritePort: graphPort,
    }),
  });

  const analysisSessionUseCases = createAnalysisSessionUseCases({
    analysisSessionStore,
  });

  const analysisExecutionStreamUseCases = createAnalysisExecutionStreamUseCases({
    eventStore: analysisExecutionEventStore,
  });

  const analysisExecutionPersistenceUseCases = createAnalysisExecutionPersistenceUseCases({
    snapshotStore: analysisExecutionSnapshotStore,
    ontologyVersionStore,
  });

  const analysisFollowUpUseCases = createAnalysisFollowUpUseCases({
    followUpStore: analysisSessionFollowUpStore,
    ontologyVersionStore,
  });

  const analysisUiMessageProjectionUseCases = createAnalysisUiMessageProjectionUseCases({
    projectionStore: analysisUiMessageProjectionStore,
  });

  const erpReadUseCases = createErpReadUseCases({
    erpReadPort,
  });

  const auditUseCases = createAuditUseCases({
    auditEventStore,
  });

  const graphUseCases = createGraphUseCases({
    graphReadPort: graphPort,
    graphWritePort: graphPort,
  });

  // --- ontology runtime ---

  const groundedContextStore = createPostgresGroundedContextStore(db);
  const groundedEntityStore = createPostgresOntologyEntityDefinitionStore(db);
  const groundedMetricStore = createPostgresOntologyMetricDefinitionStore(db);
  const groundedFactorStore = createPostgresOntologyFactorDefinitionStore(db);
  const groundedMetricVariantStore = createPostgresOntologyMetricVariantStore(db);
  const groundedTimeSemanticStore = createPostgresOntologyTimeSemanticStore(db);
  const toolCapabilityBindingStore = createPostgresOntologyToolCapabilityBindingStore(db);

  const ontologyRuntimeServices = {
    versionStore: ontologyVersionStore,
    groundedContextStore,
    groundingUseCases: createOntologyGroundingUseCases({
      versionStore: ontologyVersionStore,
      entityStore: groundedEntityStore,
      metricStore: groundedMetricStore,
      factorStore: groundedFactorStore,
      metricVariantStore: groundedMetricVariantStore,
      timeSemanticStore: groundedTimeSemanticStore,
    }),
    toolBindingUseCases: createOntologyToolBindingUseCases({
      versionStore: ontologyVersionStore,
      toolCapabilityBindingStore,
    }),
  };

  // --- ontology admin ---

  function createRunInPublishTransaction(txDb: PostgresDb): RunInPublishTransaction {
    return async <T>(fn: (stores: import('@/application/ontology/governance-use-cases').PublishTransactionStores) => Promise<T>): Promise<T> => {
      return txDb.transaction(async (tx) => {
        const txx = tx as unknown as PostgresDb;
        const stores: import('@/application/ontology/governance-use-cases').PublishTransactionStores = {
          versionStore: createPostgresOntologyVersionStore(txx),
          changeRequestStore: createPostgresOntologyChangeRequestStore(txx),
          publishRecordStore: createPostgresOntologyPublishRecordStore(txx),
        };
        return fn(stores);
      });
    };
  }

  const ontologyAdminDeps = {
    versionStore: ontologyVersionStore,
    entityStore: groundedEntityStore,
    metricStore: groundedMetricStore,
    factorStore: groundedFactorStore,
    planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
    metricVariantStore: groundedMetricVariantStore,
    timeSemanticStore: groundedTimeSemanticStore,
    causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
    evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
    changeRequestStore: createPostgresOntologyChangeRequestStore(db),
    approvalRecordStore: createPostgresOntologyApprovalRecordStore(db),
    publishRecordStore: createPostgresOntologyPublishRecordStore(db),
  };

  const ontologyAdminRuntime = {
    adminUseCases: createOntologyAdminUseCases(ontologyAdminDeps),
    governanceUseCases: createGovernanceUseCases({
      ...ontologyAdminDeps,
      runInPublishTransaction: createRunInPublishTransaction(db),
    }),
  };

  // --- llm context extraction ---

  const llmProvider = createOpenAiCompatibleLlmProvider();
  const extractionPort = createLlmContextExtractionAdapter({ llmProvider });
  const llmContextExtractionUseCases = createContextExtractionUseCases({ extractionPort });

  // --- analysis AI ---

  const analysisAiUseCases = createAnalysisAiUseCases({
    llmUseCases: llmProvider,
    contractPort: createAnalysisAiContractPort(),
  });

  // --- analysis tooling ---

  // NOTE: analysisToolingServices delegates to infrastructure/tooling for tool registry assembly,
  // as the tool definitions and their type mappings are infrastructure-layer concerns.
  // The composition root provides the already-assembled use-case instances as inputs.
  const cubeServices = createCubeSemanticQueryServices();
  const analysisToolingServices = createAnalysisToolingServices({
    analysisAiUseCases,
    erpReadUseCases: erpReadUseCases as Parameters<typeof createAnalysisToolingServices>[0]['erpReadUseCases'],
    semanticQueryUseCases: cubeServices.useCases as Parameters<typeof createAnalysisToolingServices>[0]['semanticQueryUseCases'],
    graphUseCases: graphUseCases as Parameters<typeof createAnalysisToolingServices>[0]['graphUseCases'],
  });

  // --- job use cases (async pattern) ---

  async function withJobUseCases<T>(
    execute: (services: {
      jobUseCases: ReturnType<typeof createJobUseCases>;
      analysisExecutionStreamUseCases: ReturnType<typeof createAnalysisExecutionStreamUseCases>;
    }) => Promise<T>,
  ): Promise<T> {
    const jobUseCases = createJobUseCases({
      jobQueue: createPostgresBackedJobQueue({ redis: redisClient.redis, db }),
    });
    return await execute({
      jobUseCases,
      analysisExecutionStreamUseCases: createAnalysisExecutionStreamUseCases({
        eventStore: createRedisAnalysisExecutionEventStore(redisClient.redis),
      }),
    });
  }

  return {
    analysisSessionUseCases,
    analysisSessionStore,
    analysisExecutionStreamUseCases,
    analysisExecutionPersistenceUseCases,
    analysisExecutionSnapshotStore,
    analysisFollowUpUseCases,
    analysisSessionFollowUpStore,
    analysisIntentUseCases,
    analysisContextUseCases,
    analysisPlanningUseCases,
    analysisUiMessageProjectionUseCases,
    factorExpansionUseCases,
    erpReadUseCases,
    erpReadPort,
    auditUseCases,
    graphUseCases,
    ontologyRuntimeServices,
    ontologyAdminRuntime,
    llmContextExtractionUseCases,
    analysisToolingServices,
    redisClient,
    ensureRedisConnected: () => ensureRedisConnected(redisClient.redis),
    withJobUseCases,
  };
}

