/**
 * 本体治理后台 use cases wiring（Story 9.5）。
 *
 * 集中装配后台所需的依赖，避免页面/路由文件直接 new 仓储。
 */

import type {
  PublishTransactionStores,
  RunInPublishTransaction,
} from '@/application/ontology/governance-use-cases';
import { createGovernanceUseCases } from '@/application/ontology/governance-use-cases';
import { createOntologyAdminUseCases } from '@/application/ontology-admin/use-cases';
import { createPostgresOntologyApprovalRecordStore } from '@/infrastructure/ontology/postgres-ontology-approval-record-store';
import { createPostgresOntologyCausalityEdgeStore } from '@/infrastructure/ontology/postgres-ontology-causality-edge-store';
import { createPostgresOntologyChangeRequestStore } from '@/infrastructure/ontology/postgres-ontology-change-request-store';
import { createPostgresOntologyEntityDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-entity-definition-store';
import { createPostgresOntologyEvidenceTypeDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-evidence-type-definition-store';
import { createPostgresOntologyFactorDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-factor-definition-store';
import { createPostgresOntologyMetricDefinitionStore } from '@/infrastructure/ontology/postgres-ontology-metric-definition-store';
import { createPostgresOntologyMetricVariantStore } from '@/infrastructure/ontology/postgres-ontology-metric-variant-store';
import { createPostgresOntologyPlanStepTemplateStore } from '@/infrastructure/ontology/postgres-ontology-plan-step-template-store';
import { createPostgresOntologyPublishRecordStore } from '@/infrastructure/ontology/postgres-ontology-publish-record-store';
import { createPostgresOntologyTimeSemanticStore } from '@/infrastructure/ontology/postgres-ontology-time-semantic-store';
import { createPostgresOntologyVersionStore } from '@/infrastructure/ontology/postgres-ontology-version-store';
import { createPostgresDb, type PostgresDb } from '@/infrastructure/postgres/client';

/**
 * 构造 publishVersion 的事务运行器。
 *
 * 在 `db.transaction` 回调内用同一个事务上下文 `tx` 重建三个 store 实例，保证
 * publishVersion 内部的多张表写入（ontology_versions、ontology_change_requests、
 * ontology_publish_records）作为一个原子单元提交或整体回滚，避免 Story 9.5 Review
 * 发现的 "half-published state" 风险。
 *
 * 注：drizzle 的 transaction callback tx 与 PostgresDb 在查询方法集合上同构，
 * 类型系统没有暴露公共父类型，这里用一次显式受控 cast，store 实现只依赖 query 方法。
 */
function createRunInPublishTransaction(db: PostgresDb): RunInPublishTransaction {
  return async <T>(fn: (stores: PublishTransactionStores) => Promise<T>): Promise<T> => {
    return db.transaction(async (tx) => {
      const txDb = tx as unknown as PostgresDb;
      const stores: PublishTransactionStores = {
        versionStore: createPostgresOntologyVersionStore(txDb),
        changeRequestStore: createPostgresOntologyChangeRequestStore(txDb),
        publishRecordStore: createPostgresOntologyPublishRecordStore(txDb),
      };
      return fn(stores);
    });
  };
}

function buildDeps() {
  const { db } = createPostgresDb();
  return {
    versionStore: createPostgresOntologyVersionStore(db),
    entityStore: createPostgresOntologyEntityDefinitionStore(db),
    metricStore: createPostgresOntologyMetricDefinitionStore(db),
    factorStore: createPostgresOntologyFactorDefinitionStore(db),
    planStepStore: createPostgresOntologyPlanStepTemplateStore(db),
    metricVariantStore: createPostgresOntologyMetricVariantStore(db),
    timeSemanticStore: createPostgresOntologyTimeSemanticStore(db),
    causalityEdgeStore: createPostgresOntologyCausalityEdgeStore(db),
    evidenceTypeStore: createPostgresOntologyEvidenceTypeDefinitionStore(db),
    changeRequestStore: createPostgresOntologyChangeRequestStore(db),
    approvalRecordStore: createPostgresOntologyApprovalRecordStore(db),
    publishRecordStore: createPostgresOntologyPublishRecordStore(db),
    runInPublishTransaction: createRunInPublishTransaction(db),
  };
}

export function createOntologyAdminRuntime() {
  const deps = buildDeps();
  return {
    adminUseCases: createOntologyAdminUseCases(deps),
    governanceUseCases: createGovernanceUseCases(deps),
  };
}

let cachedRuntime: ReturnType<typeof createOntologyAdminRuntime> | null = null;

export function getOntologyAdminRuntime() {
  if (!cachedRuntime) {
    cachedRuntime = createOntologyAdminRuntime();
  }
  return cachedRuntime;
}
