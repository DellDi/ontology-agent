import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';

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
  import vmModule from './src/application/analysis-message-projection/conversation-view-model.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  const { buildConversationViewModel } = vmModule;
  const { buildAiRuntimeProjection } = mapperModule;
`;

function buildEvent(overrides = {}) {
  return {
    id: overrides.id ?? `evt-${overrides.sequence ?? 1}`,
    sessionId: overrides.sessionId ?? 'session-1',
    executionId: overrides.executionId ?? 'exec-1',
    sequence: overrides.sequence ?? 1,
    timestamp: overrides.timestamp ?? '2026-01-01T00:00:00Z',
    kind: overrides.kind ?? 'step-lifecycle',
    status: overrides.status,
    message: overrides.message,
    step: overrides.step ?? null,
    stage: overrides.stage ?? null,
    renderBlocks: overrides.renderBlocks ?? [],
    metadata: overrides.metadata ?? {},
  };
}

// ---------------------------------------------------------------------------
// Phase 1a | ERP 读取结果 kv-list 不应出现在 metricCards 中
// ---------------------------------------------------------------------------

test('Phase 1a | ERP 读取结果 kv-list 不应出现在 metricCards 中', async () => {
  // ERP 读取结果块作为 evidence 的 stage-result 事件注入，
  // 预期被 classifyRenderedBlock 归为 diagnostic、并被 extractMetricCards 跳过。
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'kv-list',
          title: 'ERP 读取结果',
          items: [
            { label: '收缴率', value: '78%' },
            { label: '欠费金额', value: '¥128,000' },
          ],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '查询物业费', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      metricCount: vm.assistantMessage.metricCards.length,
      metricLabels: vm.assistantMessage.metricCards.map(c => c.label),
    }));
  `);

  assert.equal(result.metricCount, 0, 'ERP 读取结果 kv-list 不应产生任何 metricCard');
  assert.deepEqual(result.metricLabels, []);
});

test('Phase 1a | ERP 读取结果 kv-list 应归入诊断（hiddenDiagnostics）', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'kv-list',
          title: 'ERP 读取结果',
          items: [{ label: '收缴率', value: '78%' }],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '查询物业费', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      diagnosticLabels: vm.assistantMessage.hiddenDiagnostics.map(d => d.label),
    }));
  `);

  // ERP 读取结果应被归类为诊断信息（diagnostic），进入 hiddenDiagnostics 或 processBoardBlocks
  assert.ok(
    result.diagnosticLabels.includes('ERP 读取结果'),
    `ERP 读取结果 应归入 hiddenDiagnostics；实际 labels: ${JSON.stringify(result.diagnosticLabels)}`,
  );
});

// ---------------------------------------------------------------------------
// Phase 1a | 业务指标 kv-list 仍应出现在 metricCards 中
// ---------------------------------------------------------------------------

test('Phase 1a | 业务指标 kv-list 仍应出现在 metricCards 中', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'stage-result',
      renderBlocks: [
        {
          type: 'kv-list',
          title: '关键指标',
          items: [
            { label: '物业费收缴率', value: '78%' },
            { label: '欠费金额', value: '¥128,000' },
          ],
        },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '查询物业费', projection, events, hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      metricCount: vm.assistantMessage.metricCards.length,
      metricLabels: vm.assistantMessage.metricCards.map(c => c.label),
      metricValues: vm.assistantMessage.metricCards.map(c => c.value),
    }));
  `);

  assert.equal(result.metricCount, 2, '业务 kv-list 应产生 2 张 metricCard');
  assert.deepEqual(result.metricLabels, ['物业费收缴率', '欠费金额']);
  assert.deepEqual(result.metricValues, ['78%', '¥128,000']);
});

// ---------------------------------------------------------------------------
// Phase 1a | OPERATIONAL_BLOCK_TITLES 应包含 ERP 读取结果
// ---------------------------------------------------------------------------

test('Phase 1a | OPERATIONAL_BLOCK_TITLES 应包含 ERP 读取结果（源文件检视）', () => {
  // 直接检视源文件，确认 OPERATIONAL_BLOCK_TITLES 集合包含 'ERP 读取结果'。
  // 这是对分类层主防线的静态验证。
  const source = readFileSync(
    './src/application/analysis-message-projection/conversation-view-model.ts',
    'utf8',
  );

  // 定位 OPERATIONAL_BLOCK_TITLES 定义块
  const match = source.match(
    /const OPERATIONAL_BLOCK_TITLES = new Set\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(match, '应找到 OPERATIONAL_BLOCK_TITLES 定义');

  const setTitleContent = match[1];
  assert.ok(
    setTitleContent.includes("'ERP 读取结果'"),
    `OPERATIONAL_BLOCK_TITLES 应包含 'ERP 读取结果'；实际内容: ${setTitleContent}`,
  );
});

test('Phase 1a | NON_METRIC_KV_LIST_TITLES 应包含 ERP 读取结果（defense-in-depth 源文件检视）', () => {
  // 检视 extractMetricCards 的 defense-in-depth 集合
  const source = readFileSync(
    './src/application/analysis-message-projection/conversation-view-model.ts',
    'utf8',
  );

  const match = source.match(
    /const NON_METRIC_KV_LIST_TITLES = new Set\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(match, '应找到 NON_METRIC_KV_LIST_TITLES 定义');

  const setTitleContent = match[1];
  assert.ok(
    setTitleContent.includes("'ERP 读取结果'"),
    `NON_METRIC_KV_LIST_TITLES 应包含 'ERP 读取结果'；实际内容: ${setTitleContent}`,
  );
});
