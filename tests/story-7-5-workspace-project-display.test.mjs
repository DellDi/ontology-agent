import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
    },
  );

  return JSON.parse(stdout.trim());
}

test('workspace home model 应输出项目数量摘要与项目名称列表，而不是只暴露项目 ID 串', async () => {
  const result = await runTsSnippet(`
    import workspaceHomeModule from './src/application/workspace/home.ts';

    const { createWorkspaceHomeModel } = workspaceHomeModule;

    const model = createWorkspaceHomeModel(
      {
        userId: 'u-1',
        displayName: '李分析',
        sessionId: 's-1',
        expiresAt: new Date().toISOString(),
        scope: {
          organizationId: '240',
          projectIds: ['10030', '10040'],
          areaIds: [],
          roleCodes: ['PROPERTY_ANALYST'],
        },
      },
      [],
      [
        { id: '10030', name: '丰和园小区项目' },
        { id: '10040', name: '访客模式' },
      ],
    );

    console.log(
      JSON.stringify({
        projectScopeSummary: model.projectScopeSummary,
        projectDisplayNames: model.projectDisplayNames,
      }),
    );
  `);

  assert.equal(result.projectScopeSummary, '已覆盖 2 个项目');
  assert.deepEqual(result.projectDisplayNames, ['丰和园小区项目', '访客模式']);
});

test('workspace 首页应显示项目数量摘要和查看详情入口，不应直接平铺项目 ID', async () => {
  const result = await runTsSnippet(`
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import workspaceHomeModule from './src/application/workspace/home.ts';
    import workspaceShellModule from './src/app/(workspace)/_components/workspace-home-shell.tsx';

    const { createWorkspaceHomeModel } = workspaceHomeModule;
    const { WorkspaceHomeShell } = workspaceShellModule;

    const model = createWorkspaceHomeModel(
      {
        userId: 'u-1',
        displayName: '李分析',
        sessionId: 's-1',
        expiresAt: new Date().toISOString(),
        scope: {
          organizationId: '240',
          projectIds: ['10030', '10040', '750010'],
          areaIds: [],
          roleCodes: ['PROPERTY_ANALYST'],
        },
      },
      [],
      [
        { id: '10030', name: '丰和园小区项目' },
        { id: '10040', name: '访客模式' },
        { id: '750010', name: '石油大厦物业服务项目' },
      ],
    );

    const html = renderToStaticMarkup(
      React.createElement(WorkspaceHomeShell, { model }),
    );

    console.log(JSON.stringify({ html }));
  `);

  assert.match(result.html, /已覆盖 3 个项目/);
  assert.match(result.html, /查看项目详情/);
  assert.doesNotMatch(result.html, />10030</);
  assert.doesNotMatch(result.html, />10040</);
  assert.doesNotMatch(result.html, />750010</);
});
