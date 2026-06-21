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

  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
}

function buildCubeSuccessEvent({ granularity, rowCount }) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    value: 90 + i,
    time: `2026-${String(i + 1).padStart(2, '0')}`,
    dimensions: {},
  }));

  return {
    ok: true,
    toolName: 'cube.semantic-query',
    correlationId: 'test-correlation',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    output: {
      metric: 'collection-rate',
      rowCount,
      granularity,
      rows,
    },
  };
}

test('P1-Finding-7 | granularity=month 时 12 行结果不截断', async () => {
  const result = await runTsSnippet(`
    import presentationModule from './src/shared/tooling/tool-event-presentation.ts';
    const { buildToolRenderBlocks } = presentationModule;

    const event = ${JSON.stringify(buildCubeSuccessEvent({ granularity: 'month', rowCount: 12 }))};
    const blocks = buildToolRenderBlocks(event);
    const tableBlock = blocks.find((b) => b.type === 'table');

    console.log(JSON.stringify({
      rowCount: tableBlock?.rows?.length ?? 0,
    }));
  `);

  assert.equal(result.rowCount, 12, '月度数据 12 行应全部展示，不截断');
});

test('P1-Finding-7 | granularity=month 时生成趋势图 render block', async () => {
  const result = await runTsSnippet(`
    import presentationModule from './src/shared/tooling/tool-event-presentation.ts';
    const { buildToolRenderBlocks } = presentationModule;

    const event = ${JSON.stringify(buildCubeSuccessEvent({ granularity: 'month', rowCount: 6 }))};
    const blocks = buildToolRenderBlocks(event);
    const chartBlock = blocks.find((b) => b.type === 'chart');

    console.log(JSON.stringify({
      chartType: chartBlock?.chartType ?? null,
      pointCount: chartBlock?.series?.[0]?.points?.length ?? 0,
      firstPoint: chartBlock?.series?.[0]?.points?.[0] ?? null,
      lastPoint: chartBlock?.series?.[0]?.points?.at(-1) ?? null,
    }));
  `);

  assert.equal(result.chartType, 'line', '月度数据应生成折线趋势图');
  assert.equal(result.pointCount, 6, '趋势图应包含全部月度点');
  assert.deepEqual(result.firstPoint, { label: '2026-01', value: 90 });
  assert.deepEqual(result.lastPoint, { label: '2026-06', value: 95 });
});

test('P1-Finding-7 | granularity=month 时工具摘要包含完整月度明细', async () => {
  const result = await runTsSnippet(`
    import presentationModule from './src/shared/tooling/tool-event-presentation.ts';
    const { summarizeToolEvent } = presentationModule;

    const event = ${JSON.stringify(buildCubeSuccessEvent({ granularity: 'month', rowCount: 6 }))};
    const summary = summarizeToolEvent(event);

    console.log(JSON.stringify({ summary }));
  `);

  assert.match(result.summary, /月度明细/, '月度摘要应显式包含月度明细');
  assert.match(result.summary, /2026-01=90/, '应包含 1 月数值');
  assert.match(result.summary, /2026-06=95/, '应包含 6 月数值');
});

test('P1-Finding-7 | granularity=day 时结果仍截断为 5 行', async () => {
  const result = await runTsSnippet(`
    import presentationModule from './src/shared/tooling/tool-event-presentation.ts';
    const { buildToolRenderBlocks } = presentationModule;

    const event = ${JSON.stringify(buildCubeSuccessEvent({ granularity: 'day', rowCount: 30 }))};
    const blocks = buildToolRenderBlocks(event);
    const tableBlock = blocks.find((b) => b.type === 'table');

    console.log(JSON.stringify({
      rowCount: tableBlock?.rows?.length ?? 0,
    }));
  `);

  assert.equal(result.rowCount, 5, '非月度数据应截断为 5 行');
});

test('P1-Finding-7 | 无 granularity 时结果仍截断为 5 行', async () => {
  const result = await runTsSnippet(`
    import presentationModule from './src/shared/tooling/tool-event-presentation.ts';
    const { buildToolRenderBlocks } = presentationModule;

    const event = ${JSON.stringify(buildCubeSuccessEvent({ granularity: undefined, rowCount: 10 }))};
    const blocks = buildToolRenderBlocks(event);
    const tableBlock = blocks.find((b) => b.type === 'table');

    console.log(JSON.stringify({
      rowCount: tableBlock?.rows?.length ?? 0,
    }));
  `);

  assert.equal(result.rowCount, 5, '无 granularity 时应截断为 5 行');
});

test('P1-Finding-7 | granularity=quarter 时结果仍截断为 5 行', async () => {
  const result = await runTsSnippet(`
    import presentationModule from './src/shared/tooling/tool-event-presentation.ts';
    const { buildToolRenderBlocks } = presentationModule;

    const event = ${JSON.stringify(buildCubeSuccessEvent({ granularity: 'quarter', rowCount: 8 }))};
    const blocks = buildToolRenderBlocks(event);
    const tableBlock = blocks.find((b) => b.type === 'table');

    console.log(JSON.stringify({
      rowCount: tableBlock?.rows?.length ?? 0,
    }));
  `);

  assert.equal(result.rowCount, 5, '季度数据超过 5 行时仍截断');
});
