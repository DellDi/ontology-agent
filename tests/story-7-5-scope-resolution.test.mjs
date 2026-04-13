import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
      },
    },
  );

  return JSON.parse(stdout.trim());
}

test('Story 7.5 组织 240 的目录 scope 解析必须展开出真实项目范围', async () => {
  const result = await runTsSnippet(`
    import scopeResolverModule from './src/infrastructure/erp-auth/erp-scope-resolver.ts';

    const { createErpScopeResolver } = scopeResolverModule;
    const scopeResolver = createErpScopeResolver();

    const scope = await scopeResolver.resolveUserScope('240-test-user', 240n);

    console.log(JSON.stringify(scope));
  `);

  assert.equal(result.organizationId, '240');
  assert.deepEqual(result.areaIds, [], '目录登录 scope 不应再注入 areaIds');
  assert.ok(
    Array.isArray(result.projectIds) && result.projectIds.length > 0,
    '组织 240 登录后必须自动解析出项目范围，不能只停留在 organizationId',
  );
  assert.ok(
    result.projectIds.includes('10030'),
    '应能覆盖丰和园小区项目 10030',
  );
  assert.ok(
    result.projectIds.includes('10040'),
    '应能覆盖访客模式项目 10040',
  );
});

test('Story 7.5 workspace 范围判断不再把 areaIds 当成有效分析范围', async () => {
  const result = await runTsSnippet(`
    import authModelsModule from './src/domain/auth/models.ts';

    const { hasScopedTargets, hasWorkspaceAccess } = authModelsModule;

    const session = {
      userId: 'u-1',
      displayName: 'tester',
      sessionId: 's-1',
      expiresAt: new Date().toISOString(),
      scope: {
        organizationId: '240',
        projectIds: [],
        areaIds: ['1000002'],
        roleCodes: [],
      },
    };

    console.log(JSON.stringify({
      hasScopedTargets: hasScopedTargets(session),
      hasWorkspaceAccess: hasWorkspaceAccess(session),
    }));
  `);

  assert.equal(
    result.hasScopedTargets,
    false,
    'areaIds 不应继续被当成可分析范围',
  );
  assert.equal(
    result.hasWorkspaceAccess,
    false,
    '只有 areaIds 时不应被判定为具备工作台分析权限',
  );
});

test('Story 7.5 项目读取链路必须能把 scope.projectIds 映射回真实项目名称', async () => {
  const result = await runTsSnippet(`
    import scopeResolverModule from './src/infrastructure/erp-auth/erp-scope-resolver.ts';
    import erpRepoModule from './src/infrastructure/erp/postgres-erp-read-repository.ts';

    const { createErpScopeResolver } = scopeResolverModule;
    const { createPostgresErpReadRepository } = erpRepoModule;

    const scopeResolver = createErpScopeResolver();
    const repo = createPostgresErpReadRepository();
    const scope = await scopeResolver.resolveUserScope('240-test-user', 240n);
    const projects = await repo.listProjects({
      organizationId: scope.organizationId,
      projectIds: scope.projectIds,
    });

    console.log(JSON.stringify({
      projectCount: projects.length,
      allProjectPairs: projects.map((item) => ({
        id: item.id,
        name: item.name,
        organizationId: item.organizationId,
      })),
    }));
  `);

  assert.ok(result.projectCount > 0, '项目读取链路不应返回空列表');
  assert.ok(
    result.allProjectPairs.some(
      (item) => item.id === '10030' && item.name === '丰和园小区项目',
    ),
    '应能从 projectId 10030 映射回丰和园小区项目',
  );
});
