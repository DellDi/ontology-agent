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
  return JSON.parse(trimmed.split('\n').pop());
}

const MAPPER_IMPORT = `
  import contractModule from './src/application/ai-runtime/runtime-contract.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  import adapterModule from './src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts';
  const {
    AI_RUNTIME_PART_SLOTS,
    AI_RUNTIME_PART_LANES,
    AI_RUNTIME_PART_PLACEMENTS,
    resolveAiRuntimePartLayout,
  } = contractModule;
  const { buildAiRuntimeProjection } = mapperModule;
  const { projectionToUIMessages } = adapterModule;
`;

function buildFixtureEvents() {
  return [
    {
      id: 'evt-1',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 1,
      kind: 'execution-status',
      timestamp: '2026-04-20T00:00:00.000Z',
      status: 'processing',
      message: 'start',
      renderBlocks: [],
    },
    {
      id: 'evt-2',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 2,
      kind: 'stage-result',
      timestamp: '2026-04-20T00:00:01.000Z',
      stage: { key: 'ctx', label: 'Context' },
      step: { id: 'step-ctx', order: 1, title: 'Context', status: 'completed' },
      renderBlocks: [
        { type: 'summary', title: 'S', value: 'v' },
      ],
    },
  ];
}

test('resolveAiRuntimePartLayout 为每类 part 返回固定枚举值，严格符合 First-Cut 语义', async () => {
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const layouts = {
      'status-banner': resolveAiRuntimePartLayout('status-banner'),
      'step-timeline': resolveAiRuntimePartLayout('step-timeline'),
      'evidence-card': resolveAiRuntimePartLayout('evidence-card'),
      'conclusion-card': resolveAiRuntimePartLayout('conclusion-card'),
      'resume-anchor': resolveAiRuntimePartLayout('resume-anchor'),
    };
    console.log(JSON.stringify({
      layouts,
      slots: AI_RUNTIME_PART_SLOTS,
      lanes: AI_RUNTIME_PART_LANES,
      placements: AI_RUNTIME_PART_PLACEMENTS,
    }));
  `);

  assert.deepEqual(result.layouts['status-banner'], {
    slot: 'narrative-header',
    lane: 'primary',
    placement: 'sticky-top',
  });
  assert.deepEqual(result.layouts['step-timeline'], {
    slot: 'narrative-body',
    lane: 'primary',
    placement: 'inline',
  });
  assert.deepEqual(result.layouts['evidence-card'], {
    slot: 'narrative-body',
    lane: 'primary',
    placement: 'inline',
  });
  assert.deepEqual(result.layouts['conclusion-card'], {
    slot: 'narrative-footer',
    lane: 'primary',
    placement: 'inline',
  });
  assert.deepEqual(result.layouts['resume-anchor'], {
    slot: 'resume',
    lane: 'primary',
    placement: 'floating',
  });

  // 枚举集合存在且稳定
  assert.ok(result.slots.includes('narrative-header'));
  assert.ok(result.slots.includes('process-board'));
  assert.ok(result.lanes.includes('primary'));
  assert.ok(result.lanes.includes('secondary'));
  assert.ok(result.placements.includes('inline'));
  assert.ok(result.placements.includes('sticky-top'));
});

test('projection 的每个 foundation part 都带 slot/lane/placement，值在枚举内且幂等', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const a = buildAiRuntimeProjection({ sessionId: 'session-1', executionId: 'exec-1', events });
    const b = buildAiRuntimeProjection({ sessionId: 'session-1', executionId: 'exec-1', events });
    const normalize = (p) => ({ kind: p.kind, slot: p.slot, lane: p.lane, placement: p.placement });
    console.log(JSON.stringify({
      first: a.messages[0].parts.map(normalize),
      second: b.messages[0].parts.map(normalize),
      allSlotsValid: a.messages[0].parts.every((p) => AI_RUNTIME_PART_SLOTS.includes(p.slot)),
      allLanesValid: a.messages[0].parts.every((p) => AI_RUNTIME_PART_LANES.includes(p.lane)),
      allPlacementsValid: a.messages[0].parts.every((p) => AI_RUNTIME_PART_PLACEMENTS.includes(p.placement)),
    }));
  `);

  assert.equal(result.allSlotsValid, true);
  assert.equal(result.allLanesValid, true);
  assert.equal(result.allPlacementsValid, true);
  assert.deepEqual(result.first, result.second, '同一输入两次映射 layout 必须严格相等');

  // 保持 First-Cut 的 Primary Narrative Lane 顺序（contract 不退化）
  const kinds = result.first.map((p) => p.kind);
  assert.equal(kinds[0], 'status-banner');
  assert.equal(kinds[1], 'step-timeline');
  assert.equal(kinds[kinds.length - 1], 'resume-anchor');
});

test('Vercel AI SDK adapter 的 UIMessage.parts[].data 透传 slot/lane/placement', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const [msg] = projectionToUIMessages(projection);
    const layoutsFromSDK = msg.parts.map((p) => ({
      type: p.type,
      slot: p.data?.slot,
      lane: p.data?.lane,
      placement: p.data?.placement,
    }));
    console.log(JSON.stringify({ layoutsFromSDK }));
  `);

  for (const entry of result.layoutsFromSDK) {
    assert.ok(entry.type.startsWith('data-'), `type 必须是 data-*，got ${entry.type}`);
    assert.ok(entry.slot, `slot 必须透传到 SDK.data`);
    assert.ok(entry.lane);
    assert.ok(entry.placement);
  }
});
