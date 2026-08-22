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
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server']
          .filter(Boolean)
          .join(' '),
      },
    },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  const lastLine = trimmed.split('\n').pop() ?? '';
  return JSON.parse(lastLine);
}

const IMPORTS = `
  import homeModule from './src/application/workspace/home.ts';
  const { createWorkspaceHomeModel, deriveSessionStatus } = homeModule;
`;

function buildSnapshot(overrides = {}) {
  return {
    executionId: overrides.executionId ?? 'exec-001',
    sessionId: overrides.sessionId ?? 'session-001',
    ownerUserId: overrides.ownerUserId ?? 'user-001',
    followUpId: overrides.followUpId ?? null,
    ontologyVersionId: overrides.ontologyVersionId ?? null,
    ontologyVersionBinding: overrides.ontologyVersionBinding ?? {
      ontologyVersionId: null,
      source: 'legacy/unknown',
    },
    status: overrides.status ?? 'pending',
    planSnapshot: overrides.planSnapshot ?? { steps: [] },
    stepResults: overrides.stepResults ?? [],
    conclusionState: overrides.conclusionState ?? { causes: [], renderBlocks: [] },
    resultBlocks: overrides.resultBlocks ?? [],
    mobileProjection: overrides.mobileProjection ?? {
      summary: '',
      status: overrides.status ?? 'pending',
      updatedAt: '2026-05-31T00:00:00Z',
    },
    failurePoint: overrides.failurePoint ?? null,
    createdAt: overrides.createdAt ?? '2026-05-31T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-05-31T00:00:00Z',
  };
}

function buildSession(overrides = {}) {
  return {
    sessionId: overrides.sessionId ?? 'test-session',
    userId: overrides.userId ?? 'user-001',
    displayName: overrides.displayName ?? 'Test User',
    expiresAt: overrides.expiresAt ?? '2099-01-01T00:00:00Z',
    scope: overrides.scope ?? {
      organizationId: 'org-001',
      projectIds: ['project-1'],
      areaIds: ['area-1'],
      roleCodes: ['ANALYST'],
    },
  };
}

function buildAnalysisSession(overrides = {}) {
  return {
    id: overrides.id ?? 'session-001',
    ownerUserId: overrides.ownerUserId ?? 'user-001',
    organizationId: overrides.organizationId ?? 'org-001',
    projectIds: overrides.projectIds ?? ['project-1'],
    areaIds: overrides.areaIds ?? ['area-1'],
    questionText: overrides.questionText ?? '为什么本月收费率下降了？',
    savedContext: overrides.savedContext ?? {
      _executionContract: 'java-initial-v1',
      projectIds: ['project-1'],
      areaIds: ['area-1'],
      dateRange: { start: '2026-01-01', end: '2026-05-31' },
    },
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-05-31T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-05-31T00:00:00Z',
  };
}

// === deriveSessionStatus 纯函数测试 ===

test('AC1 | completed 快照派生为 "已完成"，statusTone 为 success', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({ status: 'completed' }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'completed');
  assert.equal(result.statusLabel, '已完成');
  assert.equal(result.statusTone, 'success');
  assert.equal(result.latestExecutionId, 'exec-001');
});

test('AC2 | failed 快照派生为 "失败"，statusTone 为 error，携带 failureMessage', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({
      status: 'failed',
      failurePoint: { id: 'fp-1', order: 1, title: 'LLM 调用超时' },
    }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'failed');
  assert.equal(result.statusLabel, '失败');
  assert.equal(result.statusTone, 'error');
  assert.equal(result.failureMessage, 'LLM 调用超时');
});

test('AC3 | processing 快照派生为 "分析中"，statusTone 为 info', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({ status: 'processing' }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'running');
  assert.equal(result.statusLabel, '分析中');
  assert.equal(result.statusTone, 'info');
});

test('AC3b | queued 快照同样派生为 "分析中"', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({ status: 'queued' }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'running');
  assert.equal(result.statusLabel, '分析中');
  assert.equal(result.statusTone, 'info');
});

test('AC4 | 无快照时派生为 "待执行"，statusTone 为 neutral', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const derived = deriveSessionStatus(null);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'pending');
  assert.equal(result.statusLabel, '待执行');
  assert.equal(result.statusTone, 'neutral');
  assert.equal(result.latestExecutionId, undefined);
});

test('AC4b | 旧执行无 Java 快照时明确显示待迁移且不计为待执行', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const derived = deriveSessionStatus(null, 'legacy-not-migrated');
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'unavailable');
  assert.equal(result.statusLabel, '旧执行待迁移');
  assert.equal(result.statusTone, 'neutral');
  assert.match(result.failureMessage, /不会自动重跑/);
});

test('AC5 | dead_letter 快照派生为 "失败"', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({
      status: 'dead_letter',
      failurePoint: { id: 'fp-2', order: 1, title: '队列溢出' },
    }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'failed');
  assert.equal(result.statusLabel, '失败');
  assert.equal(result.statusTone, 'error');
  assert.equal(result.failureMessage, '队列溢出');
});

// === summaryMetric 提取测试 ===

test('AC6 | completed 快照含结论原因时提取 summaryMetric', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({
      status: 'completed',
      conclusionState: {
        causes: [
          {
            id: 'cause-1',
            rank: 1,
            title: '空置率上升',
            summary: '某项目空置率环比上升 5%',
            confidence: 0.85,
            evidence: [],
          },
        ],
        renderBlocks: [],
      },
    }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'completed');
  assert.equal(result.summaryMetric, '主因: 空置率上升');
});

test('AC6b | completed 快照无结论原因时 summaryMetric 为 undefined', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const snapshot = ${JSON.stringify(buildSnapshot({
      status: 'completed',
      conclusionState: { causes: [], renderBlocks: [] },
    }))};
    const derived = deriveSessionStatus(snapshot);
    console.log(JSON.stringify(derived));
  `);

  assert.equal(result.derivedStatus, 'completed');
  assert.equal(result.summaryMetric, undefined);
});

// === createWorkspaceHomeModel 集成测试 ===

test('AC7 | historyItems 携带正确的 statusTone 和 derivedStatus', async () => {
  const session = buildSession();
  const sessions = [
    buildAnalysisSession({ id: 's-1', questionText: '收费率下降原因分析' }),
    buildAnalysisSession({ id: 's-2', questionText: '空置率趋势查询' }),
    buildAnalysisSession({ id: 's-3', questionText: '维修工单效率分析' }),
    buildAnalysisSession({ id: 's-4', questionText: '物业费催缴策略' }),
  ];

  const snapshotMap = new Map();
  snapshotMap.set('s-1', buildSnapshot({
    executionId: 'e-1',
    status: 'completed',
    conclusionState: {
      causes: [{ id: 'c1', rank: 1, title: '租户流失', summary: '', confidence: null, evidence: [] }],
      renderBlocks: [],
    },
  }));
  snapshotMap.set('s-2', buildSnapshot({
    executionId: 'e-2',
    status: 'failed',
    failurePoint: { id: 'fp-1', order: 1, title: '数据源不可用' },
  }));
  snapshotMap.set('s-3', buildSnapshot({
    executionId: 'e-3',
    status: 'processing',
  }));
  // s-4 没有快照

  const result = await runTsSnippet(`
    ${IMPORTS}
    const session = ${JSON.stringify(session)};
    const sessions = ${JSON.stringify(sessions)};
    const snapshotMap = new Map(${JSON.stringify(Array.from(snapshotMap.entries()))});
    const model = createWorkspaceHomeModel(session, sessions, [], snapshotMap);
    console.log(JSON.stringify(model.historyItems.map(item => ({
      id: item.id,
      statusLabel: item.statusLabel,
      statusTone: item.statusTone,
      derivedStatus: item.derivedStatus,
      summaryMetric: item.summaryMetric,
      failureMessage: item.failureMessage,
      latestExecutionId: item.latestExecutionId,
    }))));
  `);

  // s-1: completed
  assert.equal(result[0].id, 's-1');
  assert.equal(result[0].derivedStatus, 'completed');
  assert.equal(result[0].statusLabel, '已完成');
  assert.equal(result[0].statusTone, 'success');
  assert.equal(result[0].summaryMetric, '主因: 租户流失');
  assert.equal(result[0].latestExecutionId, 'e-1');

  // s-2: failed
  assert.equal(result[1].id, 's-2');
  assert.equal(result[1].derivedStatus, 'failed');
  assert.equal(result[1].statusLabel, '失败');
  assert.equal(result[1].statusTone, 'error');
  assert.equal(result[1].failureMessage, '数据源不可用');

  // s-3: processing
  assert.equal(result[2].id, 's-3');
  assert.equal(result[2].derivedStatus, 'running');
  assert.equal(result[2].statusLabel, '分析中');
  assert.equal(result[2].statusTone, 'info');

  // s-4: no snapshot
  assert.equal(result[3].id, 's-4');
  assert.equal(result[3].derivedStatus, 'pending');
  assert.equal(result[3].statusLabel, '待执行');
  assert.equal(result[3].statusTone, 'neutral');
});

test('AC8 | 无 latestSnapshots 参数时所有会话回退为 pending', async () => {
  const session = buildSession();
  const sessions = [
    buildAnalysisSession({ id: 's-1', questionText: '收费率分析' }),
  ];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const session = ${JSON.stringify(session)};
    const sessions = ${JSON.stringify(sessions)};
    const model = createWorkspaceHomeModel(session, sessions);
    console.log(JSON.stringify(model.historyItems.map(item => ({
      id: item.id,
      derivedStatus: item.derivedStatus,
      statusLabel: item.statusLabel,
      statusTone: item.statusTone,
    }))));
  `);

  assert.equal(result[0].derivedStatus, 'pending');
  assert.equal(result[0].statusLabel, '待执行');
  assert.equal(result[0].statusTone, 'neutral');
});

test('AC9 | 旧后端会话明确标记待迁移且不计入进行中', async () => {
  const session = buildSession();
  const sessions = [buildAnalysisSession({
    id: 'legacy-1',
    savedContext: { legacy: true },
  })];

  const result = await runTsSnippet(`
    ${IMPORTS}
    const model = createWorkspaceHomeModel(
      ${JSON.stringify(session)},
      ${JSON.stringify(sessions)},
    );
    console.log(JSON.stringify({
      item: model.historyItems[0],
      running: model.metrics.find(metric => metric.id === 'running').value,
    }));
  `);

  assert.equal(result.item.derivedStatus, 'unavailable');
  assert.equal(result.item.statusLabel, '旧执行待迁移');
  assert.match(result.item.failureMessage, /不会自动重跑/);
  assert.equal(result.running, '0');
});
