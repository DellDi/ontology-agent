import type { AuthSession } from '@/domain/auth/models';
import { buildGraphSyncBatch } from '@/infrastructure/sync/neo4j-graph-sync';

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
};

export function createGraphSyncUseCases({
  erpReadUseCases,
  graphUseCases,
}: {
  erpReadUseCases: ErpReadUseCases;
  graphUseCases: GraphUseCases;
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
  };
}

const graphSyncUseCasesModule = {
  createGraphSyncUseCases,
};

export default graphSyncUseCasesModule;
