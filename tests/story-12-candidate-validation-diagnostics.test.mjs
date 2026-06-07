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
  import vmModule from './src/application/analysis-message-projection/conversation-view-model.ts';
  import cvModule from './src/application/analysis-message-projection/candidate-validation-model.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  const { buildConversationViewModel } = vmModule;
  const { buildCandidateValidationSummary } = cvModule;
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

const SAMPLE_FACTORS = [
  { key: 'fee-policy-reach', label: '收费政策触达' },
  { key: 'work-order-response', label: '工单响应时效' },
  { key: 'billing-timeliness', label: '账单生成及时性' },
];

// ---------------------------------------------------------------------------
// AC6: 候选因素验证 — buildCandidateValidationSummary 纯函数
// ---------------------------------------------------------------------------

test('AC6 | 无验证步骤事件时所有因素标记为 not-validated', async () => {
  const events = [
    buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const factors = ${JSON.stringify(SAMPLE_FACTORS)};
    const summary = buildCandidateValidationSummary(events, factors, []);
    console.log(JSON.stringify(summary));
  `);

  assert.equal(result.totalFactors, 3);
  assert.equal(result.supportedCount, 0);
  assert.equal(result.includedCount, 0);
  assert.ok(
    result.validations.every((v) => v.status === 'not-validated'),
    '所有因素应为 not-validated',
  );
});

test('AC6 | 空候选因素列表返回空摘要', async () => {
  const events = [
    buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const summary = buildCandidateValidationSummary(events, [], []);
    console.log(JSON.stringify(summary));
  `);

  assert.equal(result.totalFactors, 0);
  assert.equal(result.validations.length, 0);
});

test('AC6 | 验证步骤完成且有 metadata validatedFactors 时逐因素提取', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-completed',
      step: { id: 'validate-candidate-factors', order: 2, title: '验证候选因素', status: 'completed' },
      renderBlocks: [
        { type: 'markdown', title: '验证结论', content: '收费政策触达率变化与收缴率下降高度相关' },
      ],
      metadata: {
        validatedFactors: [
          { factorKey: 'fee-policy-reach', status: 'supported', note: '触达率下降 12%' },
          { factorKey: 'work-order-response', status: 'not-supported' },
        ],
      },
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const factors = ${JSON.stringify(SAMPLE_FACTORS)};
    const summary = buildCandidateValidationSummary(events, factors, ['fee-policy-reach']);
    console.log(JSON.stringify(summary));
  `);

  assert.equal(result.totalFactors, 3);
  assert.equal(result.supportedCount, 1);
  assert.equal(result.notSupportedCount, 1);
  assert.equal(result.includedCount, 1);

  const feePolicy = result.validations.find((v) => v.factorKey === 'fee-policy-reach');
  assert.equal(feePolicy.status, 'supported');
  assert.equal(feePolicy.includedInFinalConclusion, true);
  assert.equal(feePolicy.validationNote, '触达率下降 12%');
  assert.ok(feePolicy.evidence.length > 0, '应有证据');

  const workOrder = result.validations.find((v) => v.factorKey === 'work-order-response');
  assert.equal(workOrder.status, 'not-supported');
  assert.equal(workOrder.includedInFinalConclusion, false);

  const billing = result.validations.find((v) => v.factorKey === 'billing-timeliness');
  assert.equal(billing.status, 'not-validated', '无 metadata 且不在结论中 → not-validated');
});

test('AC6 | 验证步骤未完成时所有因素标记为 not-validated 附注', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-started',
      step: { id: 'validate-candidate-factors', order: 2, title: '验证候选因素', status: 'running' },
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const factors = ${JSON.stringify(SAMPLE_FACTORS)};
    const summary = buildCandidateValidationSummary(events, factors, []);
    console.log(JSON.stringify(summary));
  `);

  assert.ok(
    result.validations.every((v) => v.status === 'not-validated'),
    '验证步骤未完成时所有因素应为 not-validated',
  );
  assert.ok(
    result.validations.every((v) => v.validationNote === '验证步骤尚未完成'),
    '应附注"验证步骤尚未完成"',
  );
});

test('AC6 | 旧执行无 metadata 但验证步骤有证据时标记为已核验，并保留最终结论判断', async () => {
  const events = [
    buildEvent({
      sequence: 1,
      kind: 'step-completed',
      step: { id: 'validate-candidate-factors', order: 2, title: '验证候选因素', status: 'completed' },
      renderBlocks: [
        { type: 'kv-list', title: '验证结果', items: [{ label: '总体', value: '完成' }] },
      ],
    }),
    buildEvent({
      sequence: 2,
      kind: 'step-completed',
      step: { id: 'synthesize-attribution', order: 3, title: '归因综合', status: 'completed' },
      renderBlocks: [
        { type: 'markdown', title: '结论', content: '收费政策触达和账单生成及时性是影响收缴率的关键因素' },
      ],
    }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const factors = ${JSON.stringify(SAMPLE_FACTORS)};
    const summary = buildCandidateValidationSummary(events, factors, []);
    console.log(JSON.stringify(summary));
  `);

  // 结论文本中包含收费政策触达和账单生成及时性，不包含工单响应时效
  assert.equal(result.includedCount, 2);

  // status 不从结论文本推导；旧执行无 metadata 时，若验证步骤已有证据，则按已核验展示
  const feePolicy = result.validations.find((v) => v.factorKey === 'fee-policy-reach');
  assert.equal(feePolicy.status, 'supported', '验证步骤有证据 → 已核验');
  assert.equal(feePolicy.includedInFinalConclusion, true);
  assert.match(feePolicy.validationNote, /验证步骤已完成/);

  const billing = result.validations.find((v) => v.factorKey === 'billing-timeliness');
  assert.equal(billing.includedInFinalConclusion, true, '标签出现在结论文本中 → included');

  const workOrder = result.validations.find((v) => v.factorKey === 'work-order-response');
  assert.equal(workOrder.status, 'supported', '验证步骤有证据 → 已核验');
  assert.equal(workOrder.includedInFinalConclusion, false, '标签不在结论文本中 → not included');
});

// ---------------------------------------------------------------------------
// AC6: 候选因素验证 — conversation view model 集成
// ---------------------------------------------------------------------------

test('AC6 | conversation view model diagnostics 包含 candidateValidation', async () => {
  const events = [
    buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' }),
  ];
  const factors = [
    { key: 'fee-policy-reach', label: '收费政策触达' },
    { key: 'work-order-response', label: '工单响应时效' },
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试',
      projection,
      events,
      hasConnectionIssue: false,
      candidateFactors: ${JSON.stringify(factors)},
      conclusionCauseIds: [],
    });
    console.log(JSON.stringify({
      candidateValidation: vm.assistantMessage.diagnostics.candidateValidation,
    }));
  `);

  assert.ok(result.candidateValidation, 'diagnostics 应包含 candidateValidation');
  assert.equal(result.candidateValidation.totalFactors, 2);
  assert.ok(
    result.candidateValidation.validations.every((v) => v.status === 'not-validated'),
    '无验证事件时应为 not-validated',
  );
});

test('AC6 | 无候选因素时 diagnostics.candidateValidation 为空摘要', async () => {
  const events = [
    buildEvent({ sequence: 1, kind: 'execution-status', status: 'completed' }),
  ];
  const result = await runTsSnippet(`
    ${IMPORTS}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1', executionId: 'exec-1', events, fallbackConclusion: null,
    });
    const vm = buildConversationViewModel({
      questionText: '测试',
      projection,
      events,
      hasConnectionIssue: false,
    });
    console.log(JSON.stringify({
      candidateValidation: vm.assistantMessage.diagnostics.candidateValidation,
    }));
  `);

  assert.equal(result.candidateValidation.totalFactors, 0);
  assert.equal(result.candidateValidation.validations.length, 0);
});
