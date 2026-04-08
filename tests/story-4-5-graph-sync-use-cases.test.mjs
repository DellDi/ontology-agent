import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: process.cwd() },
  );

  return JSON.parse(stdout.trim());
}

test('graph sync use case 会把 ERP 读模型组装为 Neo4j baseline batch 并提交写入', async () => {
  const result = await runTsSnippet(`
    import graphSyncUseCasesModule from './src/application/graph-sync/use-cases.ts';

    const { createGraphSyncUseCases } = graphSyncUseCasesModule;

    let receivedBatch = null;

    const useCases = createGraphSyncUseCases({
      erpReadUseCases: {
        async listOrganizations() {
          return [{ id: 'org-1', name: '组织A' }];
        },
        async listProjects() {
          return [{ id: 'project-1', name: '丰和园小区项目', organizationId: 'org-1' }];
        },
        async listCurrentOwners() {
          return [{ recordId: 'owner-record-1', ownerId: 'owner-1', ownerName: '业主A', ownerType: null, isCurrent: true, houseId: null, houseName: null, projectId: 'project-1', projectName: '丰和园小区项目', organizationId: 'org-1' }];
        },
        async listChargeItems() {
          return [{ id: 'charge-item-1', code: null, name: '物业费', typeCode: null, typeName: null, classCode: null, className: null, oneLevelName: null, organizationId: 'org-1' }];
        },
        async listReceivables() {
          return [{ recordId: 'receivable-1', organizationId: 'org-1', projectId: 'project-1', projectName: '丰和园小区项目', houseId: null, houseName: null, ownerId: null, ownerName: null, chargeItemId: 'charge-item-1', chargeItemCode: null, chargeItemName: '物业费', shouldAmount: 100, actualAmount: 100, paidAmount: 20, arrearsAmount: 80, discountAmount: 0, delayAmount: 0, delayDiscountAmount: 0, shouldChargeDate: null }];
        },
        async listPayments() {
          return [{ recordId: 'payment-1', organizationId: 'org-1', projectId: 'project-1', projectName: '丰和园小区项目', houseId: null, houseName: null, ownerId: null, ownerName: null, chargeItemId: 'charge-item-1', chargeItemCode: null, chargeItemName: '物业费', paidAmount: 20, discountAmount: 0, delayAmount: 0, operatorDate: null }];
        },
        async listServiceOrders() {
          return [{ id: 'service-1', organizationId: 'org-1', organizationPath: '/org-1/', projectId: 'project-1', projectName: '丰和园小区项目', houseId: null, customerId: null, customerName: null, serviceTypeName: null, serviceStyleName: '投诉', serviceKindName: null, serviceSourceName: null, status: null, statusName: null, content: null, createdAt: null, completedAt: null, satisfaction: null, satisfactionLevel: 4, isComplaint: true }];
        },
      },
      graphUseCases: {
        async syncBaseline(batch) {
          receivedBatch = batch;
          return {
            nodesWritten: batch.nodes.length,
            edgesWritten: batch.edges.length,
          };
        },
      },
    });

    const output = await useCases.syncBaseline({
      session: {
        userId: 'sync-user',
        displayName: 'sync-user',
        sessionId: 'sync-session',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: {
          organizationId: 'org-1',
          projectIds: [],
          areaIds: [],
          roleCodes: ['SYSTEM_SYNC'],
        },
      },
    });

    console.log(JSON.stringify({
      nodesWritten: output.nodesWritten,
      edgesWritten: output.edgesWritten,
      nodeKinds: receivedBatch.nodes.map((node) => node.kind),
      edgeKinds: receivedBatch.edges.map((edge) => edge.kind),
    }));
  `);

  assert.ok(result.nodesWritten > 0);
  assert.ok(result.edgesWritten > 0);
  assert.ok(result.nodeKinds.includes('project'));
  assert.ok(result.nodeKinds.includes('charge-item'));
  assert.ok(result.edgeKinds.includes('has-receivable'));
  assert.ok(result.edgeKinds.includes('has-payment'));
});

test('graph sync use case 会从 scoped 事实数据回补缺失的项目与收费项节点', async () => {
  const result = await runTsSnippet(`
    import graphSyncUseCasesModule from './src/application/graph-sync/use-cases.ts';

    const { createGraphSyncUseCases } = graphSyncUseCasesModule;

    let receivedBatch = null;

    const useCases = createGraphSyncUseCases({
      erpReadUseCases: {
        async listOrganizations() {
          return [{ id: '2857', name: '丰和园小区项目' }];
        },
        async listProjects() {
          return [];
        },
        async listCurrentOwners() {
          return [];
        },
        async listChargeItems() {
          return [];
        },
        async listReceivables() {
          return [{
            recordId: 'receivable-1',
            organizationId: '2857',
            projectId: '10030',
            projectName: '丰和园小区项目',
            houseId: null,
            houseName: null,
            ownerId: null,
            ownerName: null,
            chargeItemId: '20000004168',
            chargeItemCode: null,
            chargeItemName: '物业服务',
            shouldAmount: 100,
            actualAmount: 100,
            paidAmount: 20,
            arrearsAmount: 80,
            discountAmount: 0,
            delayAmount: 0,
            delayDiscountAmount: 0,
            shouldChargeDate: null
          }];
        },
        async listPayments() {
          return [{
            recordId: 'payment-1',
            organizationId: '2857',
            projectId: '10030',
            projectName: '丰和园小区项目',
            houseId: null,
            houseName: null,
            ownerId: null,
            ownerName: null,
            chargeItemId: '20000004168',
            chargeItemCode: null,
            chargeItemName: '物业服务',
            paidAmount: 20,
            discountAmount: 0,
            delayAmount: 0,
            operatorDate: null
          }];
        },
        async listServiceOrders() {
          return [];
        },
      },
      graphUseCases: {
        async syncBaseline(batch) {
          receivedBatch = batch;
          return {
            nodesWritten: batch.nodes.length,
            edgesWritten: batch.edges.length,
          };
        },
      },
    });

    const output = await useCases.syncBaseline({
      session: {
        userId: 'sync-user',
        displayName: 'sync-user',
        sessionId: 'sync-session',
        expiresAt: '2099-01-01T00:00:00.000Z',
        scope: {
          organizationId: '2857',
          projectIds: [],
          areaIds: [],
          roleCodes: ['SYSTEM_SYNC'],
        },
      },
    });

    const projectNode = receivedBatch.nodes.find((node) => node.kind === 'project');
    const chargeItemNode = receivedBatch.nodes.find((node) => node.kind === 'charge-item');

    console.log(JSON.stringify({
      nodesWritten: output.nodesWritten,
      edgesWritten: output.edgesWritten,
      projectNode,
      chargeItemNode,
      edgeKinds: receivedBatch.edges.map((edge) => edge.kind),
    }));
  `);

  assert.ok(result.nodesWritten > 0);
  assert.ok(result.edgesWritten > 0);
  assert.equal(result.projectNode.id, '10030');
  assert.equal(result.projectNode.label, '丰和园小区项目');
  assert.equal(result.chargeItemNode.id, '20000004168');
  assert.equal(result.chargeItemNode.label, '物业服务');
  assert.ok(result.edgeKinds.includes('has-receivable'));
  assert.ok(result.edgeKinds.includes('has-payment'));
  assert.ok(result.edgeKinds.includes('belongs-to'));
});
