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

export type GovernanceUseCasesDeps = {
  changeRequestStore: OntologyChangeRequestStore;
  approvalRecordStore: OntologyApprovalRecordStore;
  publishRecordStore: OntologyPublishRecordStore;
  versionStore: OntologyVersionStore;
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

    const currentPublished = await deps.versionStore.findCurrentApproved();
    const timestamp = now().toISOString();

    if (version.status !== 'approved') {
      await deps.versionStore.updateStatus(
        input.ontologyVersionId,
        'approved',
        timestamp,
        { publishedAt: timestamp },
      );
    } else {
      await deps.versionStore.updateStatus(
        input.ontologyVersionId,
        'approved',
        timestamp,
        { publishedAt: timestamp },
      );
    }

    if (currentPublished && currentPublished.id !== input.ontologyVersionId) {
      await deps.versionStore.updateStatus(
        currentPublished.id,
        'deprecated',
        timestamp,
        { deprecatedAt: timestamp },
      );
    }

    const changeRequestIds = approvedRequests.map((cr) => cr.id);

    for (const crId of changeRequestIds) {
      await deps.changeRequestStore.updateStatus(crId, 'published', timestamp);
    }

    const publishRecord = await deps.publishRecordStore.create({
      id: randomUUID(),
      ontologyVersionId: input.ontologyVersionId,
      publishedBy: input.publishedBy,
      previousVersionId: currentPublished?.id ?? null,
      changeRequestIds,
      publishNote: input.publishNote ?? null,
      createdAt: timestamp,
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
