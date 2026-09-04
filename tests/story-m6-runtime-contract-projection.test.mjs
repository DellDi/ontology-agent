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
          freshnessAt: '2026-09-01T09:00:00Z',
          numerator: 80,
          denominator: 100,
        }],
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
  assert.match(html, /2026-09-01T09:00:00Z/);
  assert.match(html, /证据行 1\/1/);
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
          accessMode: 'creator-owned',
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
  assert.match(html, /2026-09-01T09:30:00Z/);
  assert.match(html, /2\/3/);
  assert.match(html, /EASYV_FACTS_EMPTY/);
  assert.match(html, /trace-from-failure-point/);
  assert.match(html, /facts/);
});
