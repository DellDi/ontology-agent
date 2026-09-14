import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function renderPanel(snapshot) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import panelModule from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-runtime-contract-panel.tsx';
      const { AnalysisRuntimeContractPanel } = panelModule;

      const html = renderToStaticMarkup(
        React.createElement(AnalysisRuntimeContractPanel, {
          snapshot: ${JSON.stringify(snapshot)},
        }),
      );

      console.log(JSON.stringify({ html }));
    `],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_OPTIONS: '',
      },
    },
  );

  return JSON.parse(stdout.trim()).html;
}

test('M6 runtime contract projection displays Property binding, plan, evidence coverage and failure fields', async () => {
  const html = await renderPanel({
    status: 'completed',
    ontologyVersionId: 'property-ontology-v2',
    capabilityBinding: {
      domainKey: 'property',
      capabilityKey: 'collection-rate-analysis',
      ontologyVersionId: 'property-ontology-v2',
      resolvedScope: {
        domainKey: 'property',
        schemaVersion: 1,
        values: {
          organizationId: 'org-1',
          projectIds: ['project-1'],
          areaIds: [],
        },
      },
    },
    planSnapshot: {
      mode: 'multi-step',
      summary: '物业收缴率分析计划',
      steps: [{
        id: 'read-property-facts',
        order: 1,
        title: '读取物业事实',
        objective: '校验授权范围内的收费事实',
        dependencyIds: [],
      }],
    },
    conclusionState: {
      causes: [],
      renderBlocks: [],
      evidence: [{
        source: 'cube',
        title: 'Cube 指标',
        rowCount: 1,
        rows: [{
          freshnessAt: '1999-01-01T00:00:00Z',
          numerator: 80,
          denominator: 100,
        }],
        ontologyVersionId: 'property-ontology-v2',
        datasetVersionSetId: 'property-set-1',
        freshnessAt: '2026-09-01T09:00:00Z',
        productVersionIds: { 'property-receivable': 'receivable-v1', 'property-payment': 'payment-v1' },
      }],
    },
    failurePoint: null,
    errorCode: null,
    traceId: null,
  });

  assert.match(html, /data-testid="analysis-runtime-contract-panel"/);
  assert.match(html, />Property</);
  assert.match(html, /collection-rate-analysis/);
  assert.match(html, /property-ontology-v2/);
  assert.match(html, /物业收缴率分析计划/);
  assert.match(html, /2026\/09\/01 17:00:00/);
  assert.match(html, /证据行 1\/1/);
  assert.doesNotMatch(html, /1999-01-01/);
  assert.match(html, /property-set-1/);
  assert.match(html, /receivable-v1/);
  assert.match(html, /payment-v1/);
  assert.match(html, /<summary/);
  assert.doesNotMatch(html, /<details[^>]*open=/);
  assert.match(html, /未提供/);
});

test('M6 runtime contract projection displays EasyV plan, freshness coverage and failurePoint diagnostics', async () => {
  const html = await renderPanel({
    status: 'failed',
    ontologyVersionId: 'ontology-multidomain-v2',
    capabilityBinding: {
      domainKey: 'easyv',
      capabilityKey: 'generation-quality-analysis',
      ontologyVersionId: 'ontology-multidomain-v2',
      resolvedScope: {
        domainKey: 'easyv',
        schemaVersion: 1,
        values: {
          userId: '123',
          accessMode: 'all',
        },
      },
    },
    planSnapshot: {
      mode: 'deterministic-read-only',
      summary: 'EasyV 生成质量分析',
      steps: [{
        id: 'read-easyv-pipeline-node',
        order: 1,
        kind: 'aggregate-facts',
      }],
    },
    conclusionState: {
      causes: [],
      renderBlocks: [],
      evidence: [{
        source: 'easyv-pipeline-node',
        title: 'EasyV 原型阶段聚合',
        rowCount: 1,
        rows: [{
          freshnessAt: '2026-09-01T09:30:00Z',
          timedNodeCount: 2,
          mainNodeCount: 3,
        }],
        ontologyVersionId: 'ontology-multidomain-v2',
        datasetVersionSetId: 'easyv-set-1',
        freshnessAt: '2026-09-01T09:30:00Z',
        productVersionIds: { 'easyv-pipeline-node': 'pipeline-v1' },
      }],
    },
    failurePoint: {
      id: 'facts',
      code: 'EASYV_FACTS_EMPTY',
      traceId: 'trace-from-failure-point',
    },
    errorCode: null,
    traceId: null,
  });

  assert.match(html, />EasyV</);
  assert.match(html, /generation-quality-analysis/);
  assert.match(html, /ontology-multidomain-v2/);
  assert.match(html, /deterministic-read-only/);
  assert.match(html, /2026\/09\/01 17:30:00/);
  assert.match(html, /2\/3/);
  assert.match(html, /EASYV_FACTS_EMPTY/);
  assert.match(html, /trace-from-failure-point/);
  assert.match(html, /facts/);
  assert.match(html, /<details[^>]*open=/);
  assert.match(html, /easyv-set-1/);
  assert.match(html, /pipeline-v1/);
});


test('workspace preserves concrete domain bindings and leaves unbound sessions explicit', async () => {
  const { stdout } = await execFileAsync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import homeModule from './src/application/workspace/home.ts';
    const { createWorkspaceHomeModel } = homeModule;
    const viewer = { userId: '123', displayName: '分析员', scope: {
      organizationId: 'org-1', projectIds: ['p1'], areaIds: [], roleCodes: ['ANALYST'],
    }};
    const sessions = ['property', 'easyv', 'unknown', 'pending'].map(id => ({
      id, questionText: id, updatedAt: '2026-09-08T00:00:00Z',
      savedContext: { _executionContract: 'java-initial-v1' },
    }));
    const snapshots = new Map(['property', 'easyv', 'unknown'].map(id => [id, {
      executionId: id, status: 'processing', conclusionState: null, failurePoint: null,
      capabilityBinding: id === 'unknown' ? { source: 'legacy/unknown' } : {
        domainKey: id, capabilityKey: 'analysis',
      },
    }]));
    const capabilities = [{ domainKey: 'property', capabilityKey: 'collection-rate-analysis', displayName: '物业收缴率',
      available: true, unavailableReason: null, exampleQuestion: '分析收缴率',
      resolvedScope: { domainKey: 'property', schemaVersion: 1, values: { projectIds: ['p1'], areaIds: [] } } }];
    const model = createWorkspaceHomeModel(viewer, sessions, [], snapshots, null, capabilities);
    const noScope = createWorkspaceHomeModel({ ...viewer, scope: { ...viewer.scope, projectIds: [] } }, []);
    console.log(JSON.stringify({ model, noScope }));
  `], { env: { ...process.env, NODE_OPTIONS: '' } });
  const { model, noScope } = JSON.parse(stdout.trim());
  assert.deepEqual(model.historyItems.map(item => item.domainLabel), [
    '物业分析', 'EasyV 生成质量', '领域待确认', '领域待确认',
  ]);
  assert.equal(model.canCreateAnalysis, true);
  assert.equal(noScope.canCreateAnalysis, false);
  assert.doesNotMatch(model.boundaryMessage, /仅支持物业/);
});

test('workspace filters pending/running together, combines search and preserves unavailable records', async () => {
  const { stdout } = await execFileAsync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import homeModule from './src/application/workspace/home.ts';
    const { filterWorkspaceHistory } = homeModule;
    const items = ['pending', 'running', 'completed', 'failed', 'unavailable'].map((status, i) => ({
      id: String(i), title: i === 1 ? 'EasyV 生成耗时' : '收缴率分析',
      domainLabel: i === 1 ? 'EasyV 生成质量' : '物业分析', derivedStatus: status,
    }));
    console.log(JSON.stringify({
      all: filterWorkspaceHistory(items, 'all', '').map(i => i.id),
      running: filterWorkspaceHistory(items, 'running', '').map(i => i.id),
      search: filterWorkspaceHistory(items, 'running', ' EASYV ').map(i => i.id),
      failed: filterWorkspaceHistory(items, 'failed', '物业').map(i => i.id),
      empty: filterWorkspaceHistory(items, 'completed', 'EasyV'),
    }));
  `], { env: { ...process.env, NODE_OPTIONS: '' } });
  const result = JSON.parse(stdout.trim());
  assert.deepEqual(result.all, ['0', '1', '2', '3', '4']);
  assert.deepEqual(result.running, ['0', '1']);
  assert.deepEqual(result.search, ['1']);
  assert.deepEqual(result.failed, ['3']);
  assert.deepEqual(result.empty, []);
});

test('analysis shows only drawers backed by content', async () => {
  const { stdout } = await execFileAsync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import module from './src/app/(workspace)/workspace/analysis/[sessionId]/_components/analysis-assistant-message.tsx';
    const html = renderToStaticMarkup(React.createElement(module.AnalysisAssistantMessage, {
      status: 'completed', headline: '分析完成', toolActivities: [], result: null,
      diagnostics: { timelineBlocks: [], processBoardBlocks: [], renderErrors: [], otherBlocks: [] },
      primaryAnswer: '本期收缴率为 80%。', metricCards: [], visualizations: [], toolTimeline: [],
      onOpenDetail: () => {}, availableDetails: ['execution-log', 'history'],
    }));
    console.log(JSON.stringify({ html }));
  `], { env: { ...process.env, NODE_OPTIONS: '' } });
  const { html } = JSON.parse(stdout.trim());
  assert.match(html, /本期收缴率/);
  assert.match(html, /历史问答/);
  assert.match(html, /执行记录/);
  assert.doesNotMatch(html, /背景信息|可能原因|分析计划|诊断信息/);
});

test('workspace creation uses backend availability, including EasyV-only viewers and draft recovery', async () => {
  const { stdout } = await execFileAsync('node', ['--import', 'tsx', '--input-type=module', '-e', `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import homeModule from './src/application/workspace/home.ts';
    import shellModule from './src/app/(workspace)/_components/workspace-home-shell.tsx';
    const viewer = { userId: '123', displayName: '分析员', scope: {
      organizationId: 'org-1', projectIds: [], areaIds: [], roleCodes: ['EASYV_ANALYST'],
    }};
    const easyv = { domainKey: 'easyv', capabilityKey: 'generation-quality-analysis', displayName: 'EasyV 生成质量',
      available: true, unavailableReason: null, exampleQuestion: '分析本月 EasyV 生成质量',
      resolvedScope: { domainKey: 'easyv', schemaVersion: 1, values: { userId: '123', accessMode: 'all' } } };
    const project = { domainKey: 'property', capabilityKey: 'collection-rate-analysis', displayName: '物业收缴率',
      available: false, unavailableReason: '未分配项目范围', exampleQuestion: '分析收缴率', resolvedScope: null };
    const make = caps => homeModule.createWorkspaceHomeModel(viewer, [], [], new Map(), null, caps);
    const model = make([easyv, project]);
    const html = renderToStaticMarkup(React.createElement(shellModule.WorkspaceHomeShell, {
      model, creationError: '执行失败 · trace-123', draftQuestion: '保留这条草稿',
    }));
    console.log(JSON.stringify({ model, html, disabled: make([project]).canCreateAnalysis,
      empty: make([]).canCreateAnalysis,
      enabledWithoutRoleGuess: homeModule.createWorkspaceHomeModel({...viewer, scope:{...viewer.scope, roleCodes:[]}}, [], [], new Map(), null, [easyv]).canCreateAnalysis }));
  `], { env: { ...process.env, NODE_OPTIONS: '' } });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.model.canCreateAnalysis, true);
  assert.equal(result.disabled, false);
  assert.equal(result.empty, false);
  assert.equal(result.enabledWithoutRoleGuess, true);
  assert.match(result.html, /action="\/api\/analysis\/sessions"/);
  assert.match(result.html, /保留这条草稿/);
  assert.match(result.html, /trace-123/);
  assert.match(result.html, /仅限当前账号创建的 EasyV/);
  assert.match(result.html, /未分配项目范围/);
  assert.doesNotMatch(result.html, /name="capabilityKey"/);
});
