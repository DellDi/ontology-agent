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
  import understandingModule from './src/application/analysis-message-projection/semantic-understanding.ts';
  import adjustmentModule from './src/application/analysis-message-projection/structured-adjustment.ts';
  const {
    describeSemanticQuery,
    composeClarificationQuestion,
    resolveComposerTarget,
    resolvedQueryIntents,
  } = understandingModule;
  const {
    buildStructuredIntent,
    buildStructuredQueries,
    structuredAdjustmentQuestion,
    structuredDraftFromIntent,
    timeExpressionSourceText,
    validateStructuredDraft,
  } = adjustmentModule;
`;

const BASE_UNDERSTANDING = `{
  id: 'q1',
  label: '应用生成任务 · 生成任务数',
  object: { key: 'easyv-forge-task', label: '应用生成任务' },
  measures: [
    { key: 'count', label: '生成任务数' },
    { key: 'successRate', label: '生成成功率（%）' },
  ],
  dimensions: [{ key: 'status', label: '任务状态' }],
  filters: [
    { member: 'status', label: '任务状态', operator: 'not-equals', values: ['cancelled'] },
    { member: 'application.userId', label: 'AI 应用·用户', operator: 'set', values: [] },
  ],
  time: {
    dimension: 'createdAt', label: '任务创建时间', sourceText: '最近 30 天',
    kind: 'relative', from: '2026-08-30', to: '2026-09-28',
    allData: false, granularity: 'day',
  },
  compare: null,
  limit: null,
  coverage: { status: 'full', dataFrom: '2026-01-01', dataTo: '2026-09-27',
    effectiveFrom: '2026-01-01', effectiveTo: '2026-09-27' },
}`;

const CATALOG = `{
  objects: [{
    key: 'easyv-forge-task', label: '应用生成任务', defaultTime: 'createdAt',
    measures: [{ key: 'count', label: '生成任务数' },
      { key: 'successRate', label: '生成成功率（%）' }],
    dimensions: [{ key: 'status', label: '任务状态' },
      { key: 'appId', label: '应用 ID' }],
    timeDimensions: [{ key: 'createdAt', label: '任务创建时间' },
      { key: 'finishedAt', label: '任务完成时间' }],
  }],
}`;

test('AC1 | 我的理解文案：对象·指标（按维度）+ 时间 + 粒度 + 对比 + 过滤 + Top N', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const entry = ${BASE_UNDERSTANDING};
    entry.compare = { sourceText: '上一个 30 天', from: '2026-07-31', to: '2026-08-29' };
    entry.limit = 10;
    console.log(JSON.stringify(describeSemanticQuery(entry)));
  `);
  assert.equal(result.subject, '应用生成任务 · 生成任务数、生成成功率（%）（按任务状态）');
  assert.equal(result.time, '最近 30 天 → 2026-08-30 至 2026-09-28（按日）');
  assert.equal(result.compare, '对比：上一个 30 天（2026-07-31 至 2026-08-29）');
  assert.deepEqual(result.filters, [
    '过滤：任务状态 不等于 cancelled',
    '过滤：AI 应用·用户 有值',
  ]);
  assert.equal(result.limit, 'Top 10');
  assert.equal(result.coverage.tone, 'muted');
  assert.equal(result.coverage.text, '数据覆盖 2026-01-01 至 2026-09-27');
});

test('AC2 | 覆盖度三态：partial 提示实际区间、none 区分有无数据范围', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const mk = (coverage) => ({...${BASE_UNDERSTANDING}, coverage});
    console.log(JSON.stringify({
      partial: describeSemanticQuery(mk({status:'partial', dataFrom:'2026-01-01', dataTo:'2026-09-27',
        effectiveFrom:'2026-08-30', effectiveTo:'2026-09-27'})).coverage,
      noneWithData: describeSemanticQuery(mk({status:'none', dataFrom:'2026-01-01', dataTo:'2026-09-27',
        effectiveFrom:null, effectiveTo:null})).coverage,
      noneEmpty: describeSemanticQuery(mk({status:'none', dataFrom:null, dataTo:null,
        effectiveFrom:null, effectiveTo:null})).coverage,
    }));
  `);
  assert.deepEqual(result.partial, {
    tone: 'amber',
    text: '所选区间部分超出数据覆盖，实际按 2026-08-30 至 2026-09-27 回答',
  });
  assert.deepEqual(result.noneWithData, {
    tone: 'rose',
    text: '所选时间内无数据（数据覆盖 2026-01-01 至 2026-09-27）',
  });
  assert.deepEqual(result.noneEmpty, {
    tone: 'rose',
    text: '冻结数据中暂无该对象的记录',
  });
});

test('AC3 | allData 时间展示为截至描述', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const entry = {...${BASE_UNDERSTANDING},
      time: {...${BASE_UNDERSTANDING}.time, allData: true, from: null, granularity: null, sourceText: '全部数据', kind: 'all'}};
    console.log(JSON.stringify(describeSemanticQuery(entry).time));
  `);
  assert.equal(result, '未指定时间，按截至 2026-09-28 的全部数据');
});

test('AC4 | sourceText 生成表覆盖全部时间形态', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const s = timeExpressionSourceText;
    console.log(JSON.stringify({
      relativeDay: s({kind:'relative', n:7, unit:'day'}),
      relativeMonth: s({kind:'relative', n:3, unit:'month'}),
      relativeQuarter: s({kind:'relative', n:2, unit:'quarter'}),
      relativeYear: s({kind:'relative', n:1, unit:'year'}),
      relativeWeek: s({kind:'relative', n:4, unit:'week'}),
      calNowDay: s({kind:'calendar', unit:'day', offset:0}),
      calNowMonth: s({kind:'calendar', unit:'month', offset:0}),
      calPrevDay: s({kind:'calendar', unit:'day', offset:-1}),
      calPrevQuarter: s({kind:'calendar', unit:'quarter', offset:-1}),
      calBackYear: s({kind:'calendar', unit:'year', offset:-2}),
      toDateWeek: s({kind:'to-date', unit:'week'}),
      toDateYear: s({kind:'to-date', unit:'year'}),
      absolute: s({kind:'absolute', from:'2026-01-01', to:'2026-03-31'}),
      all: s({kind:'all'}),
    }));
  `);
  assert.deepEqual(result, {
    relativeDay: '最近7天',
    relativeMonth: '最近3个月',
    relativeQuarter: '最近2个季度',
    relativeYear: '最近1年',
    relativeWeek: '最近4周',
    calNowDay: '今天',
    calNowMonth: '本月',
    calPrevDay: '昨天',
    calPrevQuarter: '上季度',
    calBackYear: '往前第2个自然年',
    toDateWeek: '本周以来',
    toDateYear: '今年以来',
    absolute: '2026-01-01 至 2026-03-31',
    all: '全部数据',
  });
});

test('AC5 | 编辑意图重建：裁剪失效 order、compare 规则、保留未编辑字段', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const catalogObject = ${CATALOG}.objects[0];
    const sourceIntent = {
      object: 'easyv-forge-task',
      measures: ['count', 'successRate'],
      dimensions: ['status'],
      filters: [{member:'status', operator:'equals', values:['success']}],
      time: {dimension:'createdAt', granularity:'day',
        expression:{sourceText:'最近 7 天', kind:'relative', unit:'day', n:7}},
      compare: {sourceText:'上一个 7 天', kind:'relative', unit:'day', n:7},
      order: [
        {member:'successRate', direction:'desc'},
        {member:'status', direction:'asc'},
        {member:'time', direction:'desc'},
      ],
      limit: 20,
    };
    const draft = structuredDraftFromIntent('q1', sourceIntent, catalogObject, '生成任务');
    // 移除 successRate 指标与 status 维度、清除粒度（time order 随之失效）、改为全部数据
    draft.measures = ['count'];
    draft.dimensions = [];
    draft.granularity = null;
    draft.timeKind = 'all';
    draft.compareMode = 'keep';   // 全部数据时 compare 被忽略
    draft.limit = 5;
    const intent = buildStructuredIntent(draft);
    console.log(JSON.stringify(intent));
  `);
  assert.equal(result.object, 'easyv-forge-task');
  assert.deepEqual(result.measures, ['count']);
  assert.deepEqual(result.dimensions, []);
  assert.deepEqual(result.order, [], '被移除的指标/维度与 time 排序项都应裁剪');
  assert.equal(result.time.expression.kind, 'all');
  assert.equal(result.compare, undefined, 'all 时间不允许保留 compare');
  assert.equal(result.limit, 5);
  assert.deepEqual(result.filters, [
    { member: 'status', operator: 'equals', values: ['success'] },
  ]);
});

test('AC6 | 指定日期对比与粒度保留时 order.time 保留', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const catalogObject = ${CATALOG}.objects[0];
    const sourceIntent = {
      object: 'easyv-forge-task',
      measures: ['count'],
      dimensions: ['status'],
      filters: [],
      time: {dimension:'createdAt', granularity:'month',
        expression:{sourceText:'最近 90 天', kind:'relative', unit:'day', n:90}},
      order: [{member:'count', direction:'desc'}, {member:'time', direction:'asc'}],
    };
    const draft = structuredDraftFromIntent('q1', sourceIntent, catalogObject);
    draft.compareMode = 'absolute';
    draft.compareFrom = '2026-01-01';
    draft.compareTo = '2026-03-31';
    const intent = buildStructuredIntent(draft);
    console.log(JSON.stringify(intent));
  `);
  assert.deepEqual(result.order, [
    { member: 'count', direction: 'desc' },
    { member: 'time', direction: 'asc' },
  ]);
  assert.deepEqual(result.compare, {
    sourceText: '2026-01-01 至 2026-03-31',
    kind: 'absolute',
    from: '2026-01-01',
    to: '2026-03-31',
  });
  assert.equal(result.time.granularity, 'month');
});

test('AC7 | 客户端校验镜像：空指标/非法 N/from 晚于 to/all+compare 均被拒绝', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const catalogObject = ${CATALOG}.objects[0];
    const base = structuredDraftFromIntent('q1', {
      object: 'easyv-forge-task', measures: ['count'],
      time: {expression:{sourceText:'全部数据', kind:'all'}},
    }, catalogObject);
    const out = {};
    const noMeasure = {...base, measures: []};
    out.noMeasure = validateStructuredDraft(noMeasure, catalogObject);
    const badN = {...base, timeKind:'relative', relativeN:0};
    out.badN = validateStructuredDraft(badN, catalogObject);
    const badRange = {...base, timeKind:'absolute', absoluteFrom:'2026-05-01', absoluteTo:'2026-04-01'};
    out.badRange = validateStructuredDraft(badRange, catalogObject);
    const allCompare = {...base, timeKind:'all', compareMode:'absolute',
      compareFrom:'2026-01-01', compareTo:'2026-02-01'};
    out.allCompare = validateStructuredDraft(allCompare, catalogObject);
    const unknownMember = {...base, measures:['nope']};
    out.unknownMember = validateStructuredDraft(unknownMember, catalogObject);
    console.log(JSON.stringify(out));
  `);
  assert.ok(result.noMeasure.some((m) => m.includes('至少选择一个指标')));
  assert.ok(result.badN.some((m) => m.includes('最近 N 取值')));
  assert.ok(result.badRange.some((m) => m.includes('不能晚于结束')));
  assert.ok(result.allCompare.some((m) => m.includes('不能与对比区间同用')));
  assert.ok(result.unknownMember.some((m) => m.includes('不在对象目录中')));
});

test('AC8 | 调整摘要问题以 调整理解： 开头且总长 ≤300', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    const catalogObject = ${CATALOG}.objects[0];
    const draft = structuredDraftFromIntent('q1', {
      object: 'easyv-forge-task', measures: ['count'],
      time: {expression:{sourceText:'最近 7 天', kind:'relative', unit:'day', n:7}},
    }, catalogObject, '生成任务');
    draft.relativeN = 30;
    draft.dimensions = ['status', 'appId'];
    console.log(JSON.stringify({
      normal: structuredAdjustmentQuestion([draft]),
      longLen: structuredAdjustmentQuestion([{
        ...draft,
        label: 'x'.repeat(400),
      }]).length,
    }));
  `);
  assert.ok(result.normal.startsWith('调整理解：'));
  assert.ok(result.normal.includes('生成任务'));
  assert.ok(result.normal.includes('时间「最近30天」'));
  assert.ok(result.normal.includes('维度'));
  assert.ok(result.longLen <= 300);
});

test('AC9 | 澄清问题组合：{原问题}（补充：{选项}）≤300', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    console.log(JSON.stringify({
      normal: composeClarificationQuestion('上周大屏生成质量怎么样', '最近 7 天'),
      longLen: composeClarificationQuestion('x'.repeat(400), '最近 7 天').length,
      longEnds: composeClarificationQuestion('x'.repeat(400), '最近 7 天').endsWith('（补充：最近 7 天）'),
    }));
  `);
  assert.equal(result.normal, '上周大屏生成质量怎么样（补充：最近 7 天）');
  assert.ok(result.longLen <= 300);
  assert.equal(result.longEnds, true);
});

test('AC10 | 输入框路由：无完成态根轮次走新会话，有则走追问', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    console.log(JSON.stringify({
      followUp: resolveComposerTarget({
        hasCompletedRoot: true, rootQuestion: '分析生成质量',
        rootClarification: null, text: '换成按月看',
      }),
      newSessionPlain: resolveComposerTarget({
        hasCompletedRoot: false, rootQuestion: '分析生成质量',
        rootClarification: null, text: '按上周重试',
      }),
      newSessionClarify: resolveComposerTarget({
        hasCompletedRoot: false, rootQuestion: '前阵子大屏质量怎么样',
        rootClarification: {question:'指哪段时间？', options:['最近 7 天']},
        text: '按最近 7 天',
      }),
    }));
  `);
  assert.deepEqual(result.followUp, { mode: 'follow-up', question: '换成按月看' });
  assert.deepEqual(result.newSessionPlain, {
    mode: 'new-session',
    question: '按上周重试',
  });
  assert.deepEqual(result.newSessionClarify, {
    mode: 'new-session',
    question: '前阵子大屏质量怎么样（补充：按最近 7 天）',
  });
});

test('AC11 | _resolvedContext.queries 提取 {id, intent} 供编辑器初始化', async () => {
  const result = await runTsSnippet(`
    ${IMPORTS}
    console.log(JSON.stringify(resolvedQueryIntents({
      queries: [
        {id: 'q1', label: '生成任务', intent: {object:'easyv-forge-task'}},
        {id: 'q2', intent: 'not-an-object'},
        {intent: {object:'x'}},
        'garbage',
      ],
    })));
  `);
  assert.deepEqual(result, [
    { id: 'q1', label: '生成任务', intent: { object: 'easyv-forge-task' } },
  ]);
});
