import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: projectRoot },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  const lastLine = trimmed.split('\n').pop();
  return JSON.parse(lastLine);
}

const MAPPER_IMPORT = `
  import contractModule from './src/application/ai-runtime/runtime-contract.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  import adapterModule from './src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts';
  const { AI_RUNTIME_PART_KINDS, computeAiRuntimePartId } = contractModule;
  const { buildAiRuntimeProjection } = mapperModule;
  const { projectionToUIMessages } = adapterModule;
`;

function buildFixtureEvents(sessionId, executionId) {
  const eventPrefix = executionId === 'exec-1' ? 'a' : 'b';
  return [
    {
      id: `${eventPrefix}-evt-1`,
      sessionId,
      executionId,
      sequence: 1,
      kind: 'execution-status',
      timestamp: '2026-04-20T00:00:00.000Z',
      status: 'processing',
      message: '开始',
      renderBlocks: [],
    },
    {
      id: `${eventPrefix}-evt-2`,
      sessionId,
      executionId,
      sequence: 2,
      kind: 'step-lifecycle',
      timestamp: '2026-04-20T00:00:01.000Z',
      message: '步骤进行中',
      step: {
        id: 'step-context',
        order: 1,
        title: '上下文',
        status: 'running',
      },
      renderBlocks: [
        {
          type: 'summary',
          title: '上下文摘要',
          value: '样例',
        },
      ],
    },
    {
      id: `${eventPrefix}-evt-3`,
      sessionId,
      executionId,
      sequence: 3,
      kind: 'stage-result',
      timestamp: '2026-04-20T00:00:02.000Z',
      message: '阶段完成',
      stage: { key: 'context', label: '上下文阶段' },
      step: {
        id: 'step-context',
        order: 1,
        title: '上下文',
        status: 'completed',
      },
      renderBlocks: [
        {
          type: 'table',
          title: '结果表',
          columns: ['key', 'value'],
          rows: [['k', 'v']],
        },
      ],
    },
    {
      id: `${eventPrefix}-evt-4`,
      sessionId,
      executionId,
      sequence: 4,
      kind: 'execution-status',
      timestamp: '2026-04-20T00:00:03.000Z',
      status: 'completed',
      message: '完成',
      renderBlocks: [],
    },
  ];
}

test('computeAiRuntimePartId 按规则稳定生成 id，缺失必要 anchor 时 fail-loud', async () => {
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const anchors = { sessionId: 's-1', executionId: 'e-1' };
    const withSeq = { ...anchors, eventSequence: 42 };
    const ids = {
      statusBanner: computeAiRuntimePartId('status-banner', anchors),
      stepTimeline: computeAiRuntimePartId('step-timeline', anchors),
      evidence: computeAiRuntimePartId('evidence-card', withSeq),
      conclusion: computeAiRuntimePartId('conclusion-card', anchors),
      resume: computeAiRuntimePartId('resume-anchor', anchors),
    };
    let failedLoud = false;
    try {
      computeAiRuntimePartId('evidence-card', anchors);
    } catch (error) {
      failedLoud = /eventSequence/.test(error.message);
    }
    console.log(JSON.stringify({ ids, failedLoud }));
  `);

  assert.equal(result.ids.statusBanner, 'status-banner::s-1::e-1');
  assert.equal(result.ids.stepTimeline, 'step-timeline::s-1::e-1');
  assert.equal(result.ids.evidence, 'evidence::s-1::e-1::seq-42');
  assert.equal(result.ids.conclusion, 'conclusion::s-1::e-1');
  assert.equal(result.ids.resume, 'resume-anchor::s-1::e-1');
  assert.equal(result.failedLoud, true, 'evidence-card 缺失 eventSequence 必须抛错');
});

test('foundation parts 的 id 严格由 mapper 按规则生成，两次映射幂等', async () => {
  const events = buildFixtureEvents('session-1', 'exec-1');
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const first = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const second = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const firstIds = first.messages[0].parts.map((p) => p.id);
    const secondIds = second.messages[0].parts.map((p) => p.id);
    console.log(JSON.stringify({
      firstIds,
      secondIds,
      uniqueCount: new Set(firstIds).size,
      totalCount: firstIds.length,
    }));
  `);

  // 幂等：两次映射 id 序列严格相等
  assert.deepEqual(result.firstIds, result.secondIds);

  // 同一 projection 内全局唯一
  assert.equal(result.uniqueCount, result.totalCount);
  assert.ok(result.totalCount >= 5, 'projection 应至少包含 5 个 foundation parts');

  // id 形状严格匹配规则
  assert.ok(
    result.firstIds.some((id) => id === 'status-banner::session-1::exec-1'),
  );
  assert.ok(
    result.firstIds.some((id) => id === 'step-timeline::session-1::exec-1'),
  );
  assert.ok(
    result.firstIds.some((id) => /^evidence::session-1::exec-1::seq-\d+$/.test(id)),
  );
  assert.ok(
    result.firstIds.some((id) => id === 'resume-anchor::session-1::exec-1'),
  );
});

test('不同 execution 的 foundation part id 互不冲突', async () => {
  const eventsA = buildFixtureEvents('session-1', 'exec-1');
  const eventsB = buildFixtureEvents('session-1', 'exec-2');
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const eventsA = ${JSON.stringify(eventsA)};
    const eventsB = ${JSON.stringify(eventsB)};
    const projA = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events: eventsA,
    });
    const projB = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-2',
      events: eventsB,
    });
    const idsA = projA.messages[0].parts.map((p) => p.id);
    const idsB = projB.messages[0].parts.map((p) => p.id);
    const combined = [...idsA, ...idsB];
    console.log(JSON.stringify({
      idsACount: idsA.length,
      idsBCount: idsB.length,
      combinedUnique: new Set(combined).size,
      combinedTotal: combined.length,
      overlap: idsA.filter((id) => idsB.includes(id)),
    }));
  `);

  assert.equal(
    result.combinedUnique,
    result.combinedTotal,
    '跨 execution 合并后仍应全局唯一',
  );
  assert.deepEqual(result.overlap, [], '两条 execution 不应有任何 id 碰撞');
});

test('Vercel AI SDK adapter 的 UIMessage.parts[].id 必须严格继承 application 层 part.id', async () => {
  const events = buildFixtureEvents('session-1', 'exec-1');
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const uiMessages = projectionToUIMessages(projection);
    const appPartIds = projection.messages[0].parts.map((p) => p.id);
    const sdkPartIds = uiMessages[0].parts.map((p) => p.id);
    console.log(JSON.stringify({ appPartIds, sdkPartIds }));
  `);

  assert.deepEqual(
    result.sdkPartIds,
    result.appPartIds,
    'adapter 不得重新生成 id，必须沿用 application 层 part.id',
  );
});
