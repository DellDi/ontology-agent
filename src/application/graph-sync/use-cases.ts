import { randomUUID } from 'node:crypto';

import type { AuthSession } from '@/domain/auth/models';
import type { GraphSyncRun, GraphSyncCursorSnapshot } from '@/domain/graph-sync/models';
import { buildGraphSyncBatch } from '@/infrastructure/sync/neo4j-graph-sync';
import { attachGraphSyncRuntimeMetadata } from '@/infrastructure/sync/neo4j-graph-sync';
import type { GraphSyncRunStore } from './runtime-ports';

type ErpReadUseCases = {
  listOrganizations: (session: AuthSession) => Promise<{ id: string; name: string }[]>;
  listProjects: (
    session: AuthSession,
  ) => Promise<{ id: string; name: string; organizationId: string }[]>;
  listCurrentOwners: (
    session: AuthSession,
  ) => Promise<
    {
      ownerId: string;
      ownerName: string;
      projectId: string;
      projectName?: string | null;
      organizationId?: string | null;
    }[]
  >;
  listChargeItems: (
    session: AuthSession,
  ) => Promise<
    {
      id: string;
      code?: string | null;
      name: string;
      typeCode?: string | null;
      typeName?: string | null;
      classCode?: string | null;
      className?: string | null;
      oneLevelName?: string | null;
      organizationId?: string | null;
    }[]
  >;
  listReceivables: (
    session: AuthSession,
  ) => Promise<
    {
      recordId: string;
      organizationId?: string | null;
      projectId: string | null;
      projectName?: string | null;
      chargeItemId: string | null;
      chargeItemName?: string | null;
    }[]
  >;
  listPayments: (
    session: AuthSession,
  ) => Promise<
    {
      recordId: string;
      organizationId?: string | null;
      projectId: string | null;
      projectName?: string | null;
      chargeItemId: string | null;
      chargeItemName?: string | null;
    }[]
  >;
  listServiceOrders: (
    session: AuthSession,
  ) => Promise<{
    id: string;
    organizationId?: string | null;
    projectId: string | null;
    projectName?: string | null;
    isComplaint: boolean;
    satisfactionLevel: number | null;
  }[]>;
};

type GraphUseCases = {
  syncBaseline: (batch: ReturnType<typeof buildGraphSyncBatch>) => Promise<{
    nodesWritten: number;
    edgesWritten: number;
  }>;
  cleanupScopedData?: (input: {
    scopeOrgId: string;
    lastSeenRunId: string;
  }) => Promise<{
    deletedNodes: number;
    deletedEdges: number;
  }>;
};

function buildGraphSyncRun(input: {
  id?: string;
  mode: GraphSyncRun['mode'];
  status: GraphSyncRun['status'];
  scopeKey: string;
  triggerType: GraphSyncRun['triggerType'];
  triggeredBy: string;
  cursorSnapshot: GraphSyncCursorSnapshot;
  nodesWritten?: number;
  edgesWritten?: number;
  errorSummary?: string | null;
  errorDetail?: Record<string, unknown> | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt?: string;
}) {
  const now = new Date().toISOString();

  return {
    id: input.id ?? randomUUID(),
    mode: input.mode,
    status: input.status,
    scopeType: 'organization' as const,
    scopeKey: input.scopeKey,
    triggerType: input.triggerType,
    triggeredBy: input.triggeredBy,
    cursorSnapshot: input.cursorSnapshot,
    nodesWritten: input.nodesWritten ?? 0,
    edgesWritten: input.edgesWritten ?? 0,
    errorSummary: input.errorSummary ?? null,
    errorDetail: input.errorDetail ?? null,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  } satisfies GraphSyncRun;
}

export function createGraphSyncUseCases({
  erpReadUseCases,
  graphUseCases,
  graphSyncRunStore,
}: {
  erpReadUseCases: ErpReadUseCases;
  graphUseCases: GraphUseCases;
  graphSyncRunStore?: GraphSyncRunStore;
}) {
  function mergeProjects(input: {
    projects: Awaited<ReturnType<ErpReadUseCases['listProjects']>>;
    owners: Awaited<ReturnType<ErpReadUseCases['listCurrentOwners']>>;
    receivables: Awaited<ReturnType<ErpReadUseCases['listReceivables']>>;
    payments: Awaited<ReturnType<ErpReadUseCases['listPayments']>>;
    serviceOrders: Awaited<ReturnType<ErpReadUseCases['listServiceOrders']>>;
    organizationId: string;
  }) {
    const projectMap = new Map(
      input.projects.map((project) => [project.id, project]),
    );

    const rememberProject = (
      projectId: string | null | undefined,
      projectName: string | null | undefined,
      organizationId?: string | null,
    ) => {
      const normalizedProjectId = projectId?.trim();

      if (!normalizedProjectId || projectMap.has(normalizedProjectId)) {
        return;
      }

      projectMap.set(normalizedProjectId, {
        id: normalizedProjectId,
        name: projectName?.trim() || normalizedProjectId,
        organizationId: organizationId?.trim() || input.organizationId,
      });
    };

    for (const owner of input.owners) {
      rememberProject(owner.projectId, owner.projectName, owner.organizationId);
    }

    for (const receivable of input.receivables) {
      rememberProject(
        receivable.projectId,
        receivable.projectName,
        receivable.organizationId,
      );
    }

    for (const payment of input.payments) {
      rememberProject(payment.projectId, payment.projectName, payment.organizationId);
    }

    for (const serviceOrder of input.serviceOrders) {
      rememberProject(
        serviceOrder.projectId,
        serviceOrder.projectName,
        serviceOrder.organizationId,
      );
    }

    return [...projectMap.values()];
  }

  function mergeChargeItems(input: {
    chargeItems: Awaited<ReturnType<ErpReadUseCases['listChargeItems']>>;
    receivables: Awaited<ReturnType<ErpReadUseCases['listReceivables']>>;
    payments: Awaited<ReturnType<ErpReadUseCases['listPayments']>>;
    organizationId: string;
  }) {
    const chargeItemMap = new Map(
      input.chargeItems.map((chargeItem) => [chargeItem.id, chargeItem]),
    );

    const rememberChargeItem = (
      chargeItemId: string | null | undefined,
      chargeItemName: string | null | undefined,
      organizationId?: string | null,
    ) => {
      const normalizedChargeItemId = chargeItemId?.trim();

      if (!normalizedChargeItemId || chargeItemMap.has(normalizedChargeItemId)) {
        return;
      }

      chargeItemMap.set(normalizedChargeItemId, {
        id: normalizedChargeItemId,
        code: null,
        name: chargeItemName?.trim() || normalizedChargeItemId,
        typeCode: null,
        typeName: null,
        classCode: null,
        className: null,
        oneLevelName: null,
        organizationId: organizationId?.trim() || input.organizationId,
      });
    };

    for (const receivable of input.receivables) {
      rememberChargeItem(
        receivable.chargeItemId,
        receivable.chargeItemName,
        receivable.organizationId,
      );
    }

    for (const payment of input.payments) {
      rememberChargeItem(
        payment.chargeItemId,
        payment.chargeItemName,
        payment.organizationId,
      );
    }

    return [...chargeItemMap.values()];
  }

  return {
    async buildBatch({ session }: { session: AuthSession }) {
      const [
        organizations,
        projects,
        owners,
        chargeItems,
        receivables,
        payments,
        serviceOrders,
      ] = await Promise.all([
        erpReadUseCases.listOrganizations(session),
        erpReadUseCases.listProjects(session),
        erpReadUseCases.listCurrentOwners(session),
        erpReadUseCases.listChargeItems(session),
        erpReadUseCases.listReceivables(session),
        erpReadUseCases.listPayments(session),
        erpReadUseCases.listServiceOrders(session),
      ]);
      const mergedProjects = mergeProjects({
        projects,
        owners,
        receivables,
        payments,
        serviceOrders,
        organizationId: session.scope.organizationId,
      });
      const mergedChargeItems = mergeChargeItems({
        chargeItems,
        receivables,
        payments,
        organizationId: session.scope.organizationId,
      });

      return buildGraphSyncBatch({
        organizations,
        projects: mergedProjects,
        owners,
        chargeItems: mergedChargeItems,
        receivables,
        payments,
        serviceOrders: serviceOrders.map((serviceOrder) => ({
          id: serviceOrder.id,
          projectId: serviceOrder.projectId,
          isComplaint: serviceOrder.isComplaint,
          hasSatisfaction: serviceOrder.satisfactionLevel !== null,
        })),
      });
    },

    async syncBaseline({ session }: { session: AuthSession }) {
      const batch = await this.buildBatch({
        session,
      });

      return await graphUseCases.syncBaseline(batch);
    },

    async runOrganizationRebuild(input: {
      session: AuthSession;
      mode: GraphSyncRun['mode'];
      triggerType: GraphSyncRun['triggerType'];
      triggeredBy: string;
      cursorSnapshot: GraphSyncCursorSnapshot;
    }) {
      if (!graphSyncRunStore) {
        throw new Error('Graph sync run store is not configured.');
      }
      if (!graphUseCases.cleanupScopedData) {
        throw new Error('Graph scoped cleanup is not configured.');
      }

      const scopeOrgId = input.session.scope.organizationId;
      const scopeKey = `organization:${scopeOrgId}`;
      const pendingRun = buildGraphSyncRun({
        mode: input.mode,
        status: 'pending',
        scopeKey,
        triggerType: input.triggerType,
        triggeredBy: input.triggeredBy,
        cursorSnapshot: input.cursorSnapshot,
      });

      await graphSyncRunStore.save(pendingRun);

      const runningStartedAt = new Date().toISOString();
      const runningRun = buildGraphSyncRun({
        ...pendingRun,
        status: 'running',
        startedAt: runningStartedAt,
        createdAt: pendingRun.createdAt,
      });

      await graphSyncRunStore.save(runningRun);

      let syncResult:
        | Awaited<ReturnType<GraphUseCases['syncBaseline']>>
        | null = null;

      try {
        const batch = await this.buildBatch({
          session: input.session,
        });
        const enrichedBatch = attachGraphSyncRuntimeMetadata(batch, {
          scopeOrgId,
          lastSeenRunId: runningRun.id,
          lastSeenAt: runningRun.updatedAt,
        });
        syncResult = await graphUseCases.syncBaseline(enrichedBatch);
        await graphUseCases.cleanupScopedData({
          scopeOrgId,
          lastSeenRunId: runningRun.id,
        });

        const completedRun = buildGraphSyncRun({
          ...runningRun,
          status: 'completed',
          nodesWritten: syncResult.nodesWritten,
          edgesWritten: syncResult.edgesWritten,
          startedAt: runningStartedAt,
          finishedAt: new Date().toISOString(),
          createdAt: pendingRun.createdAt,
        });

        await graphSyncRunStore.save(completedRun);

        return {
          run: completedRun,
          nodesWritten: syncResult.nodesWritten,
          edgesWritten: syncResult.edgesWritten,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Graph sync org rebuild failed.';
        const failedRun = buildGraphSyncRun({
          ...runningRun,
          status: syncResult ? 'partial' : 'failed',
          nodesWritten: syncResult?.nodesWritten ?? 0,
          edgesWritten: syncResult?.edgesWritten ?? 0,
          errorSummary: message,
          errorDetail:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                }
              : {
                  message,
                },
          startedAt: runningStartedAt,
          finishedAt: new Date().toISOString(),
          createdAt: pendingRun.createdAt,
        });

        await graphSyncRunStore.save(failedRun);
        throw error;
      }
    },
  };
}

const graphSyncUseCasesModule = {
  createGraphSyncUseCases,
};

export default graphSyncUseCasesModule;
