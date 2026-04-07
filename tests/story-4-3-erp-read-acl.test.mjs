import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function runTsx(code) {
  const { stdout } = await execFileAsync(
    'npx',
    ['tsx', '--eval', code],
    {
      cwd: repoRoot,
      env: process.env,
    },
  );

  return stdout.trim();
}

const requiredPaths = [
  'src/domain/erp-read/models.ts',
  'src/application/erp-read/ports.ts',
  'src/application/erp-read/use-cases.ts',
  'src/infrastructure/erp/postgres-erp-read-repository.ts',
  'src/infrastructure/postgres/schema/erp-staging.ts',
];

for (const relativePath of requiredPaths) {
  test(`Story 4.3 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('ERP staging schema 定义最小物业主题表，不把平台自有表混进去', async () => {
  const schemaSource = await readRepoFile(
    'src/infrastructure/postgres/schema/erp-staging.ts',
  );

  assert.match(schemaSource, /pgSchema\('erp_staging'\)/);

  for (const tableName of [
    'erpOrganizations',
    'erpPrecincts',
    'erpOwners',
    'erpChargeItems',
    'erpReceivables',
    'erpPayments',
    'erpServiceOrders',
  ]) {
    assert.match(
      schemaSource,
      new RegExp(`export const ${tableName}`),
      `应定义 ${tableName} staging 表`,
    );
  }

  assert.doesNotMatch(
    schemaSource,
    /platformSchema/,
    'ERP staging schema 不应复用 platform schema',
  );
});

test('application 层通过端口消费 ERP 读模型，而不是直接依赖 Postgres/Drizzle', async () => {
  const portsSource = await readRepoFile('src/application/erp-read/ports.ts');
  const useCasesSource = await readRepoFile('src/application/erp-read/use-cases.ts');

  assert.match(portsSource, /interface ErpReadPort/);
  assert.match(useCasesSource, /createErpReadUseCases/);
  assert.match(useCasesSource, /erpReadPort: ErpReadPort/);
  assert.doesNotMatch(useCasesSource, /drizzle|pg\.|Pool|pgSchema/);
});

test('防腐层仓储复用 Postgres client 与 erp_staging schema，并返回平台领域模型', async () => {
  const repositorySource = await readRepoFile(
    'src/infrastructure/erp/postgres-erp-read-repository.ts',
  );

  assert.match(repositorySource, /createPostgresErpReadRepository/);
  assert.match(repositorySource, /createPostgresDb/);
  assert.match(repositorySource, /from ['"]@\/infrastructure\/postgres\/schema/);
  assert.match(repositorySource, /ErpReadPort/);
  assert.match(repositorySource, /mapOrganizationRow|mapPrecinctRow|mapServiceOrderRow/);
  assert.doesNotMatch(
    repositorySource,
    /dw_datacenter_/,
    'ERP 原始表名不应泄漏到 application/domain 消费侧',
  );
});

test('ERP 领域模型与 scope 过滤规则显式存在，并支持组织 / 项目裁剪', async () => {
  const domainSource = await readRepoFile('src/domain/erp-read/models.ts');

  for (const symbolName of [
    'ErpOrganization',
    'ErpProject',
    'ErpChargeItem',
    'ErpServiceOrder',
    'ErpPermissionScope',
    'canAccessErpScope',
  ]) {
    assert.match(domainSource, new RegExp(symbolName));
  }

  assert.match(domainSource, /organizationId/);
  assert.match(domainSource, /projectId/);
  assert.match(domainSource, /organizationPath/);
  assert.doesNotMatch(
    domainSource,
    /areaIds:\s*normalizeScopeList\(scope\.areaIds\)/,
    'ERP 读取权限不应再基于 areaIds 做裁剪',
  );
});

test('投诉与满意度继续复用工单 staging，不额外要求独立物理表', async () => {
  const repositorySource = await readRepoFile(
    'src/infrastructure/erp/postgres-erp-read-repository.ts',
  );
  const domainSource = await readRepoFile('src/domain/erp-read/models.ts');

  assert.match(repositorySource, /serviceStyleName/);
  assert.match(domainSource, /isComplaintServiceOrder|toComplaintKind/);
  assert.match(domainSource, /satisfaction|satisfactionLevel/);
});

test('4.3 契约明确处理脏数据与缺失字段，不把 null/删除态直接暴露给上层', async () => {
  const repositorySource = await readRepoFile(
    'src/infrastructure/erp/postgres-erp-read-repository.ts',
  );

  assert.match(repositorySource, /isDeleted|deleteFlag|isCurrent|isDelete/);
  assert.match(repositorySource, /coalesce|trim|normalize|safe/i);
});

test('受限项目 scope 会拒绝缺少 projectId 的事实记录', async () => {
  const output = await runTsx(`
    import { canAccessErpScope } from './src/domain/erp-read/models.ts';

    const scope = {
      organizationId: 'org-parent',
      projectIds: ['project-001'],
    };

    const missingProject = canAccessErpScope(scope, {
      organizationId: 'org-parent',
    });

    const completeRecord = canAccessErpScope(scope, {
      organizationId: 'org-parent',
      projectId: 'project-001',
    });

    console.log(JSON.stringify({
      missingProject,
      completeRecord,
    }));
  `);

  assert.deepStrictEqual(JSON.parse(output), {
    missingProject: false,
    completeRecord: true,
  });
});

test('ChargeItem 读取不做权限控制', async () => {
  const output = await runTsx(`
    import { createPostgresErpReadRepository } from './src/infrastructure/erp/postgres-erp-read-repository.ts';
    import { erpChargeItems } from './src/infrastructure/postgres/schema/index.ts';

    const fakeDb = {
      select() {
        return {
          from(table) {
            if (table === erpChargeItems) {
              return Promise.resolve([
                {
                  chargeItemId: 'item-org-a',
                  chargeItemCode: 'A001',
                  chargeItemName: '物业费',
                  chargeItemType: null,
                  chargeItemTypeName: null,
                  chargeItemClass: null,
                  chargeItemClassName: null,
                  oneLevelChargeItemName: null,
                  organizationId: 'org-unrelated',
                },
              ]);
            }

            return Promise.resolve([]);
          },
        };
      },
    };

    const repository = createPostgresErpReadRepository(fakeDb);

    void (async () => {
      const chargeItems = await repository.listChargeItems({
        organizationId: 'org-parent',
        projectIds: ['project-001'],
      });

      console.log(JSON.stringify(chargeItems.map((item) => item.id)));
    })();
  `);

  assert.deepStrictEqual(JSON.parse(output), ['item-org-a']);
});

test('上级组织可通过组织路径继承访问下级项目与收费事实', async () => {
  const output = await runTsx(`
    import { createPostgresErpReadRepository } from './src/infrastructure/erp/postgres-erp-read-repository.ts';
    import {
      erpOrganizations,
      erpPrecincts,
      erpReceivables,
    } from './src/infrastructure/postgres/schema/index.ts';

    const fakeDb = {
      select() {
        return {
          from(table) {
            if (table === erpOrganizations) {
                return Promise.resolve([
                  {
                    sourceId: BigInt(1001),
                    organizationParentId: 'org-district',
                    organizationPath: '/org-root/org-city/org-district/org-project/',
                    organizationLevel: 5,
                    organizationName: '项目组织',
                    organizationShortName: '项目',
                    organizationNature: 'propertyProject',
                    enterpriseId: BigInt(1),
                    groupId: null,
                    companyId: null,
                    departmentId: null,
                    organizationEnableState: 1,
                    isDeleted: 0,
                      },
                    ]);
            }

            if (table === erpPrecincts) {
                return Promise.resolve([
                  {
                    recordId: BigInt(2001),
                    precinctId: 'project-001',
                    precinctNo: 'P001',
                    precinctName: '金色佳园',
                    orgId: 'org-project',
                    organizationId: BigInt(1001),
                    enterpriseId: 'ent-1',
                    areaId: 'area-east',
                    areaName: '东区',
                    precinctType: 'residential',
                    precinctTypeName: '住宅',
                    deliveryTime: null,
                    contractArea: '100',
                    nozzleArea: '90',
                    payChargeArea: '88',
                    totalHouseHolder: 120,
                    isDelete: 0,
                    deleteFlag: 0,
                      },
                    ]);
            }

            if (table === erpReceivables) {
                return Promise.resolve([
                  {
                    recordId: BigInt(3001),
                    organizationId: '1001',
                    precinctId: 'project-001',
                    precinctName: '金色佳园',
                    houseId: 'house-1',
                    houseName: '1-101',
                    ownerId: 'owner-1',
                    ownerName: '张三',
                    chargeItemId: 'item-1',
                    chargeItemCode: 'CI001',
                    chargeItemName: '物业费',
                    chargeSum: '100',
                    actualChargeSum: '100',
                    paidChargeSum: '0',
                    arrears: '100',
                    discount: '0',
                    delaySum: '0',
                    delayDiscount: '0',
                    shouldChargeDate: null,
                    calcStartDate: null,
                    calcEndDate: null,
                    calcEndYear: 2026,
                    shouldAccountBook: 202604,
                    createDate: null,
                    updateDate: null,
                    syncDate: null,
                    isCheck: '1',
                    isDelete: 0,
                    isFreezed: 0,
                      },
                    ]);
            }

            return Promise.resolve([]);
              },
            };
          },
        };

    const repository = createPostgresErpReadRepository(fakeDb);
    const scope = {
      organizationId: 'org-district',
      projectIds: ['project-001'],
    };

    void (async () => {
      const [projects, receivables] = await Promise.all([
        repository.listProjects(scope),
        repository.listReceivables(scope),
      ]);

      console.log(JSON.stringify({
        projectIds: projects.map((item) => item.id),
        receivableIds: receivables.map((item) => item.recordId),
      }));
    })();
  `);

  assert.deepStrictEqual(JSON.parse(output), {
    projectIds: ['project-001'],
    receivableIds: ['3001'],
  });
});
