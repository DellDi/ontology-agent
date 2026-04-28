import { randomUUID } from 'node:crypto';

import {
  canTransitionTo,
  ChangeRequestNotFoundError,
  InvalidChangeRequestTransitionError,
  OntologyVersionNotReadyForPublishError,
  type ApprovalDecision,
  type ChangeRequestStatus,
  type ChangeType,
  type CompatibilityType,
  type OntologyApprovalRecord,
  type OntologyChangeRequest,
  type OntologyPublishRecord,
  type TargetObjectType,
} from '@/domain/ontology/governance';

import type {
  OntologyApprovalRecordStore,
  OntologyChangeRequestStore,
  OntologyPublishRecordStore,
} from './governance-ports';
import type { OntologyVersionStore } from './ports';

/**
 * publishVersion 事务内所需的 store 子集。基础设施层在 `db.transaction` 内
 * 使用绑定到同一个事务上下文的 store 实例实现这个形状，保证 5 条 DB 写操作
 * （目标版本 status + publishedAt、前代版本 deprecated、N 条 CR status、发布记录）
 * 要么一起成功，要么全部回滚，绝不留下半发布状态。
 */
export type PublishTransactionStores = {
  versionStore: OntologyVersionStore;
  changeRequestStore: OntologyChangeRequestStore;
  publishRecordStore: OntologyPublishRecordStore;
};

export type RunInPublishTransaction = <T>(
  fn: (stores: PublishTransactionStores) => Promise<T>,
) => Promise<T>;

export type GovernanceUseCasesDeps = {
  changeRequestStore: OntologyChangeRequestStore;
  approvalRecordStore: OntologyApprovalRecordStore;
  publishRecordStore: OntologyPublishRecordStore;
  versionStore: OntologyVersionStore;
  /**
   * 可选：发布流程的事务边界 runner。生产环境（Postgres）会注入基于
   * `db.transaction` 的实现；测试 stub 可不提供，退化为无事务的顺序执行
   * （仅用于测试，生产路径必须注入）。
   */
  runInPublishTransaction?: RunInPublishTransaction;
  now?: () => Date;
};

export type SubmitChangeRequestInput = {
  ontologyVersionId: string;
  targetObjectType: TargetObjectType;
  targetObjectKey: string;
  changeType: ChangeType;
  title: string;
  description?: string | null;
  beforeSummary?: Record<string, unknown> | null;
  afterSummary?: Record<string, unknown> | null;
  impactScope: string[];
  compatibilityType: CompatibilityType;
  compatibilityNote?: string | null;
  submittedBy: string;
};

export function createGovernanceUseCases(deps: GovernanceUseCasesDeps) {
  const now = deps.now ?? (() => new Date());

  async function createChangeRequest(
    input: SubmitChangeRequestInput,
  ): Promise<OntologyChangeRequest> {
    const timestamp = now().toISOString();
    return deps.changeRequestStore.create({
      id: randomUUID(),
      ontologyVersionId: input.ontologyVersionId,
      targetObjectType: input.targetObjectType,
      targetObjectKey: input.targetObjectKey,
      changeType: input.changeType,
      title: input.title,
      description: input.description ?? null,
      beforeSummary: input.beforeSummary ?? null,
      afterSummary: input.afterSummary ?? null,
      impactScope: input.impactScope,
      compatibilityType: input.compatibilityType,
      compatibilityNote: input.compatibilityNote ?? null,
      submittedBy: input.submittedBy,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async function submitChangeRequest(
    changeRequestId: string,
  ): Promise<OntologyChangeRequest> {
    const cr = await deps.changeRequestStore.findById(changeRequestId);
    if (!cr) throw new ChangeRequestNotFoundError(changeRequestId);
    assertTransition(cr.status, 'submitted');

    const timestamp = now().toISOString();
    return deps.changeRequestStore.updateStatus(
      changeRequestId,
      'submitted',
      timestamp,
      timestamp,
    );
  }

  async function reviewChangeRequest(input: {
    changeRequestId: string;
    decision: ApprovalDecision;
    reviewedBy: string;
    comment?: string | null;
  }): Promise<{ changeRequest: OntologyChangeRequest; approvalRecord: OntologyApprovalRecord }> {
    const cr = await deps.changeRequestStore.findById(input.changeRequestId);
    if (!cr) throw new ChangeRequestNotFoundError(input.changeRequestId);

    const targetStatus: ChangeRequestStatus =
      input.decision === 'approved' ? 'approved' : 'rejected';
    assertTransition(cr.status, targetStatus);

    const timestamp = now().toISOString();
    const approvalRecord = await deps.approvalRecordStore.create({
      id: randomUUID(),
      changeRequestId: input.changeRequestId,
      decision: input.decision,
      reviewedBy: input.reviewedBy,
      comment: input.comment ?? null,
      createdAt: timestamp,
    });

    const changeRequest = await deps.changeRequestStore.updateStatus(
      input.changeRequestId,
      targetStatus,
      timestamp,
    );

    return { changeRequest, approvalRecord };
  }

  async function publishVersion(input: {
    ontologyVersionId: string;
    publishedBy: string;
    publishNote?: string | null;
  }): Promise<{ publishRecord: OntologyPublishRecord }> {
    const version = await deps.versionStore.findById(input.ontologyVersionId);
    if (!version) {
      throw new OntologyVersionNotReadyForPublishError(
        input.ontologyVersionId,
        '版本不存在。',
      );
    }

    const approvedRequests = await deps.changeRequestStore.findByVersionAndStatus(
      input.ontologyVersionId,
      'approved',
    );

    const pendingSubmitted = await deps.changeRequestStore.findByVersionAndStatus(
      input.ontologyVersionId,
      'submitted',
    );
    if (pendingSubmitted.length > 0) {
      throw new OntologyVersionNotReadyForPublishError(
        input.ontologyVersionId,
        `仍有 ${pendingSubmitted.length} 个待审批的变更申请。`,
      );
    }

    const currentPublished = await deps.versionStore.findCurrentPublished();
    const timestamp = now().toISOString();

    if (version.status !== 'approved') {
      throw new OntologyVersionNotReadyForPublishError(
        input.ontologyVersionId,
        `版本状态为 "${version.status}"，只有 "approved" 状态的版本才能发布。`,
      );
    }

    if (version.publishedAt) {
      throw new OntologyVersionNotReadyForPublishError(
        input.ontologyVersionId,
        '该版本已经发布，不能重复发布。',
      );
    }

    const changeRequestIds = approvedRequests.map((cr) => cr.id);
    const publishRecordId = randomUUID();

    // 所有 DB 写操作必须发生在同一个事务内，避免半发布状态：
    //   1) 目标版本切换为 published（写入 publishedAt）
    //   2) 前代 published 版本切换为 deprecated
    //   3) 关联的 approved CR 状态批量切换为 published
    //   4) 写入 ontology_publish_records 审计记录
    // 任一步失败都必须整体回滚；若未注入事务 runner，则仅用于测试 stub，
    // 明确记录降级语义。
    const executePublishMutations = async (
      stores: PublishTransactionStores,
    ): Promise<OntologyPublishRecord> => {
      await stores.versionStore.updateStatus(
        input.ontologyVersionId,
        'approved',
        timestamp,
        { publishedAt: timestamp },
      );

      if (currentPublished && currentPublished.id !== input.ontologyVersionId) {
        await stores.versionStore.updateStatus(
          currentPublished.id,
          'deprecated',
          timestamp,
          { deprecatedAt: timestamp },
        );
      }

      for (const crId of changeRequestIds) {
        await stores.changeRequestStore.updateStatus(crId, 'published', timestamp);
      }

      return stores.publishRecordStore.create({
        id: publishRecordId,
        ontologyVersionId: input.ontologyVersionId,
        publishedBy: input.publishedBy,
        previousVersionId: currentPublished?.id ?? null,
        changeRequestIds,
        publishNote: input.publishNote ?? null,
        createdAt: timestamp,
      });
    };

    const publishRecord = deps.runInPublishTransaction
      ? await deps.runInPublishTransaction(executePublishMutations)
      : await executePublishMutations({
          versionStore: deps.versionStore,
          changeRequestStore: deps.changeRequestStore,
          publishRecordStore: deps.publishRecordStore,
        });

    return { publishRecord };
  }

  async function listPendingChangeRequests(): Promise<OntologyChangeRequest[]> {
    return deps.changeRequestStore.findByStatus('submitted');
  }

  async function listPublishedVersions(): Promise<OntologyPublishRecord[]> {
    const latest = await deps.publishRecordStore.findLatest();
    return latest ? [latest] : [];
  }

  async function getChangeRequestById(id: string): Promise<OntologyChangeRequest | null> {
    return deps.changeRequestStore.findById(id);
  }

  async function getApprovalHistory(
    changeRequestId: string,
  ): Promise<OntologyApprovalRecord[]> {
    return deps.approvalRecordStore.findByChangeRequestId(changeRequestId);
  }

  return {
    createChangeRequest,
    submitChangeRequest,
    reviewChangeRequest,
    publishVersion,
    listPendingChangeRequests,
    listPublishedVersions,
    getChangeRequestById,
    getApprovalHistory,
  };
}

function assertTransition(from: ChangeRequestStatus, to: ChangeRequestStatus): void {
  if (!canTransitionTo(from, to)) {
    throw new InvalidChangeRequestTransitionError(from, to);
  }
}
