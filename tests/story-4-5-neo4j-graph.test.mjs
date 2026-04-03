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
  'src/domain/graph/models.ts',
  'src/application/graph/ports.ts',
  'src/application/graph/use-cases.ts',
  'src/infrastructure/neo4j/config.ts',
  'src/infrastructure/neo4j/errors.ts',
  'src/infrastructure/neo4j/neo4j-graph-adapter.ts',
  'src/infrastructure/neo4j/index.ts',
  'src/infrastructure/sync/neo4j-graph-sync.ts',
  'docs/data-contracts/graph-sync-baseline.md',
];

for (const relativePath of requiredPaths) {
  test(`Story 4.5 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('package.json 引入 neo4j-driver 作为官方图谱驱动', async () => {
  const packageJson = await readRepoFile('package.json');
  assert.match(packageJson, /"neo4j-driver"\s*:/);
});

test('.env.example 包含 Neo4j 所需环境变量', async () => {
  const envExample = await readRepoFile('.env.example');

  for (const envName of [
    'NEO4J_URI',
    'NEO4J_USERNAME',
    'NEO4J_PASSWORD',
    'NEO4J_DATABASE',
  ]) {
    assert.match(envExample, new RegExp(envName), `${envName} 应存在于 .env.example`);
  }
});

test('图谱领域模型覆盖最小实体、关系边与可解释字段', async () => {
  const models = await readRepoFile('src/domain/graph/models.ts');

  for (const token of [
    'GraphNodeKind',
    'organization',
    'project',
    'house',
    'owner',
    'charge-item',
    'receivable',
    'payment',
    'service-order',
    'complaint',
    'satisfaction',
    'GraphEdgeKind',
    'contains',
    'belongs-to',
    'has-owner',
    'has-receivable',
    'has-payment',
    'has-complaint',
    'has-satisfaction',
    'causal',
    'direction',
    'source',
    'explanation',
  ]) {
    assert.match(models, new RegExp(token));
  }
});

test('Neo4j adapter 仅服务端可用，并使用官方 driver 执行读写查询', async () => {
  const adapter = await readRepoFile(
    'src/infrastructure/neo4j/neo4j-graph-adapter.ts',
  );

  assert.match(adapter, /server-only/);
  assert.match(adapter, /from 'neo4j-driver'|from "neo4j-driver"/);
  assert.match(adapter, /neo4j\.driver\(/);
  assert.match(adapter, /auth\.basic/);
  assert.match(adapter, /executeQuery|session\(/);
  assert.match(adapter, /MATCH/);
  assert.match(adapter, /MERGE/);
  assert.match(adapter, /has-receivable|has-payment|has-service-order/);
});

test('Graph use case 可消费 graph port，并把图谱结果转成候选因素读模型', async () => {
  const result = await runTsSnippet(`
    import graphUseCasesModule from './src/application/graph/use-cases.ts';

    const { createGraphUseCases } = graphUseCasesModule;

    const useCases = createGraphUseCases({
      graphReadPort: {
        async findCandidateFactors() {
          return [
            {
              factorKey: 'service-response-latency',
              factorLabel: '服务响应时长',
              explanation: '项目投诉和满意度节点都与服务响应时长存在因果边。',
              relationType: 'causal',
              direction: 'outbound',
              source: 'governed-rule',
            },
          ];
        },
        async checkHealth() {
          return { ok: true, status: 'ready' };
        },
      },
    });

    const output = await useCases.expandCandidateFactors({
      intentType: 'complaint-analysis',
      metric: '投诉量',
      entity: '项目A',
      timeRange: '本月',
      questionText: '为什么本月投诉量上升？',
    });

    console.log(JSON.stringify(output));
  `);

  assert.equal(result.mode, 'expand');
  assert.equal(result.factors[0].label, '服务响应时长');
  assert.equal(result.factors[0].relationType, 'causal');
  assert.equal(result.factors[0].source, 'governed-rule');
});

test('factor expansion 入口通过 graph use case 构建候选因素，不再只依赖本地静态模板', async () => {
  const factorUseCases = await readRepoFile('src/application/factor-expansion/use-cases.ts');

  assert.match(factorUseCases, /graphUseCases/);
  assert.match(factorUseCases, /await graphUseCases\.expandCandidateFactors/);
  assert.match(factorUseCases, /relationType|source|direction/);
});

test('图谱查询失败时，候选因素扩展会优雅降级到治理规则而不是让页面链路抛错', async () => {
  const result = await runTsSnippet(`
    import factorExpansionModule from './src/application/factor-expansion/use-cases.ts';

    const { createFactorExpansionUseCases } = factorExpansionModule;

    const useCases = createFactorExpansionUseCases({
      graphUseCases: {
        async expandCandidateFactors() {
          throw new Error('neo4j unavailable');
        },
      },
    });

    const output = await useCases.buildCandidateFactorReadModel({
      intentType: 'fee-analysis',
      questionText: '为什么本月项目 moon 的收费回款率下降了？',
      contextReadModel: {
        version: 1,
        questionText: '为什么本月项目 moon 的收费回款率下降了？',
        context: {
          targetMetric: { value: '收费回款率', status: 'confirmed' },
          entity: { value: '项目 moon', status: 'confirmed' },
          timeRange: { value: '本月', status: 'confirmed' },
          comparison: { value: '存在趋势或比较语义', status: 'needs-confirmation' },
          constraints: [],
        },
      },
    });

    console.log(JSON.stringify(output));
  `);

  assert.equal(result.mode, 'expand');
  assert.match(result.disclaimer, /图谱候选因素暂不可用/);
  assert.ok(result.factors.length > 0);
});

test('最小同步基线把 ERP 关系投影成受控图谱节点与边', async () => {
  const sync = await readRepoFile('src/infrastructure/sync/neo4j-graph-sync.ts');
  const doc = await readRepoFile('docs/data-contracts/graph-sync-baseline.md');

  for (const token of [
    'Organization -> Project',
    'Project -> Owner',
    'Project -> Receivable',
    'Project -> Payment',
    'Project -> ServiceOrder',
    'ChargeItem -> Receivable',
    'ChargeItem -> Payment',
    'ServiceOrder -> Complaint',
    'ServiceOrder -> Satisfaction',
  ]) {
    assert.match(doc, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(sync, /buildGraphSyncBatch/);
  assert.match(sync, /nodes/);
  assert.match(sync, /edges/);
  assert.match(sync, /MERGE/);
  assert.match(sync, /source/);
});
