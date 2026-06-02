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
  return JSON.parse(stdout.trim().split('\n').pop());
}

test('Phase 2a | extractAnalysisContext 应提取"按月份"为 month granularity', async () => {
  const result = await runTsSnippet(`
    import m from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = m;
    const ctx = extractAnalysisContext('按照月份展开看看收缴率');
    console.log(JSON.stringify({
      granularity: ctx.granularity,
    }));
  `);
  assert.ok(result.granularity, 'granularity 应存在');
  assert.equal(result.granularity.value, 'month');
  assert.equal(result.granularity.state, 'confirmed');
});

test('Phase 2a | extractAnalysisContext 应提取"按季度"', async () => {
  const result = await runTsSnippet(`
    import m from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = m;
    const ctx = extractAnalysisContext('按季度看一下');
    console.log(JSON.stringify({ granularity: ctx.granularity }));
  `);
  assert.equal(result.granularity?.value, 'quarter');
});

test('Phase 2a | extractAnalysisContext 无粒度关键词时 granularity 应为 undefined', async () => {
  const result = await runTsSnippet(`
    import m from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = m;
    const ctx = extractAnalysisContext('2026年物业费收缴率是多少');
    console.log(JSON.stringify({ granularity: ctx.granularity ?? null }));
  `);
  assert.equal(result.granularity, null);
});

test('Phase 2a | FollowUpContextFieldKey 应包含 granularity', async () => {
  const fs = await import('fs');
  const source = fs.readFileSync(
    'src/domain/analysis-session/follow-up-models.ts',
    'utf-8',
  );
  assert.ok(
    source.includes("'granularity'"),
    'FollowUpContextFieldKey should include granularity',
  );
  assert.ok(
    source.includes("granularity: '时间粒度'"),
    'FIELD_LABELS should include granularity label',
  );
});

test('Phase 2a | tool-input-builder 应传递 granularity 到 cube 输入', async () => {
  const fs = await import('fs');
  const source = fs.readFileSync(
    'src/application/analysis-execution/tool-input-builder.ts',
    'utf-8',
  );
  assert.ok(
    source.includes('granularity') && source.includes('cube.semantic-query'),
    'cube.semantic-query input should include granularity',
  );
});

test('Phase 2a | "本月"不应被识别为 granularity', async () => {
  const result = await runTsSnippet(`
    import m from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = m;
    const ctx = extractAnalysisContext('本月物业费收缴率是多少');
    console.log(JSON.stringify({ granularity: ctx.granularity ?? null }));
  `);
  assert.equal(result.granularity, null, '"本月"是时间范围，不是 granularity');
});

test('Phase 2a | 低置信度 granularity 不应进入 cube 输入', async () => {
  const result = await runTsSnippet(`
    import mod from './src/application/analysis-execution/tool-input-builder.ts';
    const { buildToolInputs } = mod;

    const context = {
      targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
      entity: { label: '实体对象', value: '项目A', state: 'confirmed' },
      timeRange: { label: '时间范围', value: '2026年', state: 'confirmed' },
      comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
      granularity: { label: '时间粒度', value: 'month', state: 'missing' },
      constraints: [],
    };

    const inputs = buildToolInputs({
      context,
      questionText: '测试问题',
      projectIds: ['proj-1'],
      areaIds: [],
      organizationId: 'org-1',
      ownerUserId: 'user-1',
      sessionId: 'sess-1',
      groundedContext: undefined,
      step: { id: 's1', title: '测试步骤', objective: '测试目标' },
      planSummary: '测试计划',
    });

    console.log(JSON.stringify({
      granularity: inputs['cube.semantic-query']?.granularity ?? null,
    }));
  `);
  assert.equal(result.granularity, null, '低置信度 granularity 不应下推');
});

test('Phase 2a | confirmed granularity 应正常进入 cube 输入', async () => {
  const result = await runTsSnippet(`
    import mod from './src/application/analysis-execution/tool-input-builder.ts';
    const { buildToolInputs } = mod;

    const context = {
      targetMetric: { label: '目标指标', value: '收缴率', state: 'confirmed' },
      entity: { label: '实体对象', value: '项目A', state: 'confirmed' },
      timeRange: { label: '时间范围', value: '2026年', state: 'confirmed' },
      comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
      granularity: { label: '时间粒度', value: 'month', state: 'confirmed' },
      constraints: [],
    };

    const inputs = buildToolInputs({
      context,
      questionText: '测试问题',
      projectIds: ['proj-1'],
      areaIds: [],
      organizationId: 'org-1',
      ownerUserId: 'user-1',
      sessionId: 'sess-1',
      groundedContext: undefined,
      step: { id: 's1', title: '测试步骤', objective: '测试目标' },
      planSummary: '测试计划',
    });

    console.log(JSON.stringify({
      granularity: inputs['cube.semantic-query']?.granularity ?? null,
    }));
  `);
  assert.equal(result.granularity, 'month', 'confirmed granularity 应正常下推');
});

test('Phase 2a | "2026年1月"不应被识别为 granularity', async () => {
  const result = await runTsSnippet(`
    import m from './src/domain/analysis-context/models.ts';
    const { extractAnalysisContext } = m;
    const ctx = extractAnalysisContext('2026年1月收缴率');
    console.log(JSON.stringify({ granularity: ctx.granularity ?? null }));
  `);
  assert.equal(result.granularity, null, '"1月"是时间范围，不是 granularity');
});
