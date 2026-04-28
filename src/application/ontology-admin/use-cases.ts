/**
 * 本体治理后台读模型 use cases（Story 9.5）。
 *
 * 仅消费 Story 9.4 的正式治理用例与 Story 9.1 / 9.2 的注册库 use cases，
 * 不直接读写数据表，也不自定义状态机。后台页面只能从这里取数据。
 */

import {
  type OntologyApprovalRecord,
  type OntologyChangeRequest,
  type OntologyPublishRecord,
  type ChangeRequestStatus,
} from '@/domain/ontology/governance';
import type {
  OntologyGovernanceDefinitions,
  OntologyVersion,
} from '@/domain/ontology/models';

import {
  getGovernanceDefinitionsByVersion,
  type OntologyGovernanceDeps,
} from '../ontology/use-cases';
import type { GovernanceUseCasesDeps } from '../ontology/governance-use-cases';
import { createGovernanceUseCases } from '../ontology/governance-use-cases';

export type OntologyAdminDeps = OntologyGovernanceDeps &
  Pick<GovernanceUseCasesDeps, 'changeRequestStore' | 'approvalRecordStore' | 'publishRecordStore'>;

export type OntologyAdminOverview = {
  currentPublishedVersion: OntologyVersion | null;
  latestApprovedVersion: OntologyVersion | null;
  pendingChangeRequests: OntologyChangeRequest[];
  approvedAwaitingPublish: OntologyChangeRequest[];
  recentPublishes: OntologyPublishRecord[];
  recentChangeRequests: OntologyChangeRequest[];
  riskNotes: string[];
};

export type OntologyAdminDefinitionsView = {
  version: OntologyVersion;
  definitions: OntologyGovernanceDefinitions;
};

export type OntologyAdminChangeRequestDetail = {
  changeRequest: OntologyChangeRequest;
  approvalHistory: OntologyApprovalRecord[];
  version: OntologyVersion | null;
};

export type OntologyAdminUseCases = {
  loadOverview(): Promise<OntologyAdminOverview>;
  listAllChangeRequests(limit?: number): Promise<OntologyChangeRequest[]>;
  listChangeRequestsByStatus(status: ChangeRequestStatus): Promise<OntologyChangeRequest[]>;
  getChangeRequestDetail(id: string): Promise<OntologyAdminChangeRequestDetail | null>;
  loadDefinitionsForCurrentVersion(): Promise<OntologyAdminDefinitionsView | null>;
  loadDefinitionsForVersion(versionId: string): Promise<OntologyAdminDefinitionsView | null>;
  listVersions(limit?: number): Promise<OntologyVersion[]>;
  listPublishHistory(limit?: number): Promise<OntologyPublishRecord[]>;
};

export function createOntologyAdminUseCases(
  deps: OntologyAdminDeps,
): OntologyAdminUseCases {
  const governance = createGovernanceUseCases(deps);

  async function resolveCurrentVersion(): Promise<OntologyVersion | null> {
    const published = await deps.versionStore.findCurrentPublished();
    if (published) return published;
    return deps.versionStore.findCurrentApproved();
  }

  async function loadOverview(): Promise<OntologyAdminOverview> {
    const [
      currentPublishedVersion,
      latestApprovedVersion,
      pending,
      recentPublishes,
      recentChangeRequests,
    ] = await Promise.all([
      deps.versionStore.findCurrentPublished(),
      deps.versionStore.findCurrentApproved(),
      governance.listPendingChangeRequests(),
      deps.publishRecordStore.listRecent(5),
      deps.changeRequestStore.listRecent(10),
    ]);

    let approvedAwaitingPublish: OntologyChangeRequest[] = [];
    if (latestApprovedVersion) {
      approvedAwaitingPublish = await deps.changeRequestStore.findByVersionAndStatus(
        latestApprovedVersion.id,
        'approved',
      );
    }

    const riskNotes: string[] = [];
    if (!currentPublishedVersion) {
      riskNotes.push('当前没有任何已发布的本体版本，运行时仍处于无受治理 ontology 的状态。');
    }
    if (pending.length > 0) {
      riskNotes.push(`有 ${pending.length} 个变更申请处于待审批状态。`);
    }
    if (
      latestApprovedVersion &&
      currentPublishedVersion &&
      latestApprovedVersion.id !== currentPublishedVersion.id &&
      !latestApprovedVersion.publishedAt
    ) {
      riskNotes.push(
        `已审批版本 ${latestApprovedVersion.semver} 尚未发布，默认运行时仍指向旧版本。`,
      );
    }

    return {
      currentPublishedVersion,
      latestApprovedVersion,
      pendingChangeRequests: pending,
      approvedAwaitingPublish,
      recentPublishes,
      recentChangeRequests,
      riskNotes,
    };
  }

  async function listAllChangeRequests(limit = 100): Promise<OntologyChangeRequest[]> {
    return deps.changeRequestStore.listRecent(limit);
  }

  async function listChangeRequestsByStatus(
    status: ChangeRequestStatus,
  ): Promise<OntologyChangeRequest[]> {
    return deps.changeRequestStore.findByStatus(status);
  }

  async function getChangeRequestDetail(
    id: string,
  ): Promise<OntologyAdminChangeRequestDetail | null> {
    const cr = await governance.getChangeRequestById(id);
    if (!cr) return null;

    const [approvalHistory, version] = await Promise.all([
      governance.getApprovalHistory(id),
      deps.versionStore.findById(cr.ontologyVersionId),
    ]);

    return {
      changeRequest: cr,
      approvalHistory,
      version,
    };
  }

  async function loadDefinitionsForVersion(
    versionId: string,
  ): Promise<OntologyAdminDefinitionsView | null> {
    const version = await deps.versionStore.findById(versionId);
    if (!version) return null;
    const definitions = await getGovernanceDefinitionsByVersion(deps, versionId);
    return { version, definitions };
  }

  async function loadDefinitionsForCurrentVersion(): Promise<
    OntologyAdminDefinitionsView | null
  > {
    const version = await resolveCurrentVersion();
    if (!version) return null;
    return loadDefinitionsForVersion(version.id);
  }

  async function listVersions(limit = 20): Promise<OntologyVersion[]> {
    if (!deps.versionStore.listRecent) return [];
    return deps.versionStore.listRecent(limit);
  }

  async function listPublishHistory(limit = 20): Promise<OntologyPublishRecord[]> {
    return deps.publishRecordStore.listRecent(limit);
  }

  return {
    loadOverview,
    listAllChangeRequests,
    listChangeRequestsByStatus,
    getChangeRequestDetail,
    loadDefinitionsForCurrentVersion,
    loadDefinitionsForVersion,
    listVersions,
    listPublishHistory,
  };
}
