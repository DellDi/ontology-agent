import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: repoRoot },
  );

  return JSON.parse(stdout.trim());
}

const requiredPaths = [
  'src/application/semantic-query/models.ts',
  'src/application/semantic-query/ports.ts',
  'src/application/semantic-query/use-cases.ts',
  'src/infrastructure/cube/config.ts',
  'src/infrastructure/cube/errors.ts',
  'src/infrastructure/cube/metric-catalog.ts',
  'src/infrastructure/cube/cube-semantic-query-adapter.ts',
  'src/infrastructure/cube/index.ts',
  'docs/data-contracts/cube-semantic-baseline.md',
];

for (const relativePath of requiredPaths) {
  test(`Story 4.4 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('.env.example 包含 Cube 所需环境变量', async () => {
  const envExample = await readRepoFile('.env.example');

  for (const envName of [
    'CUBE_API_URL',
    'CUBE_API_TOKEN',
    'CUBE_QUERY_TIMEOUT_MS',
  ]) {
    assert.match(envExample, new RegExp(envName), `${envName} 应存在于 .env.example`);
  }
});

test('application 层定义稳定的 metric query 契约与健康检查 port', async () => {
  const models = await readRepoFile('src/application/semantic-query/models.ts');
  const ports = await readRepoFile('src/application/semantic-query/ports.ts');
  const useCases = await readRepoFile('src/application/semantic-query/use-cases.ts');

  assert.match(models, /SemanticMetricKey/);
  assert.match(models, /MetricQueryRequest/);
  assert.match(models, /MetricQueryResult/);
  assert.match(models, /MetricQueryScope/);
  assert.match(ports, /SemanticQueryPort/);
  assert.match(ports, /runMetricQuery/);
  assert.match(ports, /checkHealth/);
  assert.match(ports, /getMetricCatalog/);
  assert.match(useCases, /createSemanticQueryUseCases/);
});

test('Cube metric catalog 至少固化首批收费与工单指标', async () => {
  const result = await runTsSnippet(`
    import metricCatalogModule from './src/infrastructure/cube/metric-catalog.ts';

    const { listSemanticMetrics } = metricCatalogModule;
    console.log(JSON.stringify(listSemanticMetrics().map((item) => item.key)));
  `);

  assert.deepEqual(result, [
    'project-collection-rate',
    'project-receivable-amount',
    'project-paid-amount',
    'tail-arrears-collection-rate',
    'tail-arrears-receivable-amount',
    'tail-arrears-paid-amount',
    'service-order-count',
    'complaint-count',
    'average-satisfaction',
    'average-close-duration-hours',
    'average-response-duration-hours',
  ]);
});

test('Cube adapter 将平台 metric contract 转换为受治理的 Cube load query', async () => {
  const builder = await readRepoFile('src/infrastructure/cube/query-builder.ts');

  assert.match(builder, /buildCubeLoadQuery/);
  assert.match(builder, /definition\.cubeMeasure/);
  assert.match(builder, /definition\.scopeMembers\.organization/);
  assert.match(builder, /definition\.scopeMembers\.project/);
  assert.match(builder, /definition\.dateDimensions/);
  assert.match(builder, /groupBy/);
  assert.match(builder, /filters\.push/);
  assert.match(builder, /projectIds/);
  assert.match(builder, /granularity/);
});

test('项目口径应收指标会把应收账期语义映射到 FinanceReceivables.receivableAccountingPeriod', async () => {
  const result = await runTsSnippet(`
    import queryBuilderModule from './src/infrastructure/cube/query-builder.ts';

    const { buildCubeLoadQuery } = queryBuilderModule;
    const query = buildCubeLoadQuery({
      metric: 'project-receivable-amount',
      scope: {
        organizationId: '2857',
        projectIds: ['10030'],
      },
      dateRange: {
        dimension: 'receivable-accounting-period',
        from: '2026-01-31',
        to: '2026-04-08',
      },
      limit: 20,
    });

    console.log(JSON.stringify(query.timeDimensions[0]));
  `);

  assert.deepEqual(result, {
    dimension: 'FinanceReceivables.receivableAccountingPeriod',
    dateRange: ['2026-01-31', '2026-04-08'],
  });
});

test('项目口径实收指标会同时使用应收账期和实收日期两个时间语义', async () => {
  const result = await runTsSnippet(`
    import queryBuilderModule from './src/infrastructure/cube/query-builder.ts';

    const { buildCubeLoadQuery } = queryBuilderModule;
    const query = buildCubeLoadQuery({
      metric: 'project-paid-amount',
      scope: {
        organizationId: '2857',
        projectIds: ['10030'],
      },
      dateRanges: [
        {
          dimension: 'receivable-accounting-period',
          from: '2026-01-01',
          to: '2026-12-31',
        },
        {
          dimension: 'payment-date',
          from: '2026-01-01',
          to: '2026-12-31',
        },
      ],
      limit: 20,
    });

    console.log(JSON.stringify(query.timeDimensions));
  `);

  assert.deepEqual(result, [
    {
      dimension: 'FinancePayments.receivableAccountingPeriod',
      dateRange: ['2026-01-01', '2026-12-31'],
    },
    {
      dimension: 'FinancePayments.paymentDate',
      dateRange: ['2026-01-01', '2026-12-31'],
    },
  ]);
});

test('Cube adapter 使用服务端 token 和只读 /v1/load 查询，不让页面层直连 Cube', async () => {
  const adapter = await readRepoFile(
    'src/infrastructure/cube/cube-semantic-query-adapter.ts',
  );
  const appFiles = await readRepoFile('src/app/api/analysis/sessions/route.ts');

  assert.match(adapter, /server-only/);
  assert.match(adapter, /Authorization/);
  assert.match(adapter, /\/load/);
  assert.match(adapter, /\/meta/);
  assert.match(adapter, /fetchImpl|fetch\(/);
  assert.doesNotMatch(appFiles, /cubejs-api|\/v1\/load|\/v1\/meta/);
});

test('Cube semantic baseline 文档明确记录首批指标口径与待确认项', async () => {
  const contractDoc = await readRepoFile(
    'docs/data-contracts/cube-semantic-baseline.md',
  );

  for (const keyword of [
    '收缴率',
    '应收金额',
    '实收金额',
    '工单总量',
    '投诉量',
    '平均满意度',
    '平均关闭时长',
    '平均响应时长',
    '已确认业务口径',
  ]) {
    assert.match(contractDoc, new RegExp(keyword));
  }
});
