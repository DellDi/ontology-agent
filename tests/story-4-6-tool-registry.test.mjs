import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: repoRoot },
  );

  return JSON.parse(stdout.trim());
}

for (const relativePath of [
  'src/domain/tooling/models.ts',
  'src/application/tooling/models.ts',
  'src/application/tooling/use-cases.ts',
  'src/application/analysis-execution/use-cases.ts',
  'src/infrastructure/tooling/index.ts',
]) {
  test(`Story 4.6 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('tool registry 定义四类真实工具，并暴露稳定元数据', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: { strategy: 'llm', tools: [] },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() { return { metric: 'collection-rate', rows: [] }; },
      },
      graphUseCases: {
        async expandCandidateFactors() { return { mode: 'skip', factors: [] }; },
      },
    });

    console.log(JSON.stringify(services.toolRegistryUseCases.listToolDefinitions()));
  `);

  assert.equal(result.length, 5);
  assert.deepEqual(
    result.map((item) => item.name),
    [
      'llm.structured-analysis',
      'erp.read-model',
      'cube.semantic-query',
      'neo4j.graph-query',
      'platform.capability-status',
    ],
  );
  assert.ok(result.every((item) => item.runtime === 'shared'));
  assert.ok(result.every((item) => item.inputSchemaLabel && item.outputSchemaLabel));
});

test('tool registry 会按真实配置将不可用工具标记为 degraded', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = '';
    process.env.NEO4J_URI = '';
    process.env.NEO4J_USERNAME = '';
    process.env.NEO4J_PASSWORD = '';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: { strategy: 'llm', tools: [] },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
        async checkHealth() {
          return {
            ok: true,
            provider: 'openai-compatible',
            model: 'demo',
            latencyMs: 1,
            checkedAt: new Date().toISOString(),
            status: 200,
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() { return { metric: 'collection-rate', rows: [] }; },
        async checkHealth() {
          return {
            ok: false,
            status: 503,
            latencyMs: 1,
            checkedAt: new Date().toISOString(),
            apiUrl: 'http://cube:4000/cubejs-api/v1',
          };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() { return { mode: 'skip', factors: [] }; },
        async checkHealth() {
          return {
            ok: false,
            status: 'disabled',
          };
        },
      },
    });

    console.log(JSON.stringify(services.toolRegistryUseCases.listToolDefinitions()));
  `);

  assert.equal(
    result.find((item) => item.name === 'llm.structured-analysis').availability,
    'ready',
  );
  assert.equal(
    result.find((item) => item.name === 'cube.semantic-query').availability,
    'degraded',
  );
  assert.equal(
    result.find((item) => item.name === 'neo4j.graph-query').availability,
    'degraded',
  );
});

test('tool registry 通过真实工具封装返回受控输出，不泄漏底层 raw 结构', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: { strategy: 'llm', tools: [] },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() {
          return {
            metric: 'collection-rate',
            rows: [
              {
                value: 0.83,
                time: '2026-04-01',
                dimensions: { 'project-name': '项目A' },
                raw: { internal: true },
              },
            ],
            raw: { payload: 'secret' },
          };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() { return { mode: 'skip', factors: [] }; },
      },
    });

    const result = await services.toolRegistryUseCases.invokeTool({
      toolName: 'cube.semantic-query',
      input: {
        metric: 'collection-rate',
        scope: { organizationId: 'org-1', projectIds: ['p-1'] },
      },
      context: {
        correlationId: 'corr-1',
        source: 'application',
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'cube.semantic-query');
  assert.equal(result.output.rowCount, 1);
  assert.equal(result.output.rows[0].value, 0.83);
  assert.equal('raw' in result.output.rows[0], false);
});

test('platform capability tool 会汇总关键能力健康状态', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';
    process.env.CUBE_API_TOKEN = '';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: { strategy: 'llm', tools: [] },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
        async checkHealth() {
          return {
            ok: true,
            provider: 'openai-compatible',
            model: 'demo',
            latencyMs: 11,
            checkedAt: '2026-04-03T00:00:00.000Z',
            status: 200,
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() { return { metric: 'collection-rate', rows: [] }; },
        async checkHealth() {
          return {
            ok: false,
            status: 503,
            latencyMs: 22,
            checkedAt: '2026-04-03T00:00:00.000Z',
            apiUrl: 'http://cube:4000/cubejs-api/v1',
          };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() { return { mode: 'skip', factors: [] }; },
        async checkHealth() {
          return {
            ok: true,
            status: 'ready',
          };
        },
      },
    });

    const result = await services.toolRegistryUseCases.invokeTool({
      toolName: 'platform.capability-status',
      input: {},
      context: {
        correlationId: 'corr-capability',
        source: 'application',
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.equal(result.ok, true);
  assert.equal(result.toolName, 'platform.capability-status');
  assert.equal(result.output.capabilities.llm.status, 'ready');
  assert.equal(result.output.capabilities.cube.status, 'degraded');
  assert.equal(result.output.capabilities.neo4j.status, 'ready');
});

test('orchestration bridge 会根据工具选择结果调用真实 registry，并在单工具失败时返回稳定错误 envelope', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          if (request.taskType === 'tool-selection') {
            return {
              taskType: request.taskType,
              ok: true,
              value: {
                strategy: '先查指标再查图谱',
                tools: [
                  { toolName: 'cube.semantic-query', objective: '验证核心指标波动', confidence: 0.9 },
                  { toolName: 'neo4j.graph-query', objective: '扩展候选因素', confidence: 0.8 },
                ],
              },
              issues: [],
              providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
            };
          }

          return {
            taskType: request.taskType,
            ok: true,
            value: { strategy: 'ok', tools: [] },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() {
          return {
            metric: 'collection-rate',
            rows: [{ value: 0.9, time: null, dimensions: {} }],
          };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() {
          throw new Error('neo4j temporary unavailable');
        },
      },
    });

    const result = await services.analysisExecutionUseCases.executeStep({
      stepId: 'validate-candidate-factors',
      questionText: '为什么本月收费回款率下降？',
      planSummary: '先查指标，再验证候选因素。',
      stepTitle: '逐项验证候选因素',
      stepObjective: '围绕候选方向逐项查证。',
      selectionContext: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-execution',
      },
      invocationContext: {
        correlationId: 'corr-2',
        source: 'worker',
        userId: 'user-1',
        organizationId: 'org-1',
      },
      toolInputsByName: {
        'cube.semantic-query': {
          metric: 'collection-rate',
          scope: { organizationId: 'org-1', projectIds: ['p-1'] },
        },
        'neo4j.graph-query': {
          intentType: 'fee-analysis',
          metric: '收费回款率',
          entity: '项目A',
          timeRange: '本月',
          questionText: '为什么本月收费回款率下降？',
        },
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.equal(result.status, 'failed');
  assert.equal(result.strategy, '先查指标再查图谱');
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].ok, true);
  assert.equal(result.events[1].ok, false);
  assert.equal(result.events[1].error.code, 'tool-provider-failed');
  assert.equal(result.events[1].error.toolName, 'neo4j.graph-query');
  assert.equal(result.error.correlationId, 'corr-2');
});

test('tool selection 未命中时会回退到步骤级保守映射', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: {
              strategy: '模型返回未知工具',
              tools: [{ toolName: 'unknown-tool', objective: 'unknown', confidence: 0.1 }],
            },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() {
          return { metric: 'collection-rate', rows: [{ value: 1, time: null, dimensions: {} }] };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() {
          return { mode: 'expand', factors: [{ factorKey: 'f-1', factorLabel: '因素', explanation: 'ex', relationType: 'has-payment', direction: 'outbound', source: 'erp-derived' }] };
        },
      },
    });

    const result = await services.analysisExecutionUseCases.selectToolsForStep({
      stepId: 'validate-candidate-factors',
      questionText: '为什么本月收费回款率下降？',
      planSummary: '验证候选因素',
      stepTitle: '逐项验证候选因素',
      stepObjective: '围绕候选方向逐项查证。',
      context: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-execution',
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.match(result.strategy, /回退到步骤级保守映射/);
  assert.deepEqual(
    result.tools.map((tool) => tool.toolName),
    ['neo4j.graph-query', 'erp.read-model', 'platform.capability-status'],
  );
});

test('tool selection 服务抛异常时仍会回退到步骤级保守映射', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask() {
          throw new Error('llm unavailable');
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() {
          return { metric: 'collection-rate', rows: [{ value: 1, time: null, dimensions: {} }] };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() {
          return { mode: 'expand', factors: [{ factorKey: 'f-1', factorLabel: '因素', explanation: 'ex', relationType: 'has-payment', direction: 'outbound', source: 'erp-derived' }] };
        },
      },
    });

    const result = await services.analysisExecutionUseCases.selectToolsForStep({
      stepId: 'inspect-metric-change',
      questionText: '为什么本月收费回款率下降？',
      planSummary: '先查指标',
      stepTitle: '校验核心指标波动',
      stepObjective: '验证收费回款率是否真实下降。',
      context: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-execution',
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.match(result.strategy, /回退到步骤级保守映射/);
  assert.deepEqual(
    result.tools.map((tool) => tool.toolName),
    ['cube.semantic-query', 'platform.capability-status'],
  );
});

test('汇总归因步骤回退时仍会带上 llm 结构化分析工具', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: {
              strategy: '模型返回未知工具',
              tools: [{ toolName: 'unknown-tool', objective: 'unknown', confidence: 0.1 }],
            },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() {
          return { metric: 'project-collection-rate', rows: [{ value: 1, time: null, dimensions: {} }] };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() {
          return { mode: 'expand', factors: [{ factorKey: 'f-1', factorLabel: '因素', explanation: 'ex', relationType: 'has-payment', direction: 'outbound', source: 'erp-derived' }] };
        },
      },
    });

    const output = await services.analysisExecutionUseCases.selectToolsForStep({
      stepId: 'synthesize-attribution',
      questionText: '近三个月丰和园小区项目的收缴率和欠费压力为什么异常？',
      planSummary: '汇总结论',
      stepTitle: '汇总归因判断',
      stepObjective: '基于真实证据输出可读结论。',
      context: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-execution',
      },
    });

    console.log(JSON.stringify(output));
  `);

  assert.match(result.strategy, /回退到步骤级保守映射/);
  assert.ok(
    result.tools.some((tool) => tool.toolName === 'llm.structured-analysis'),
  );
});

test('executeStep 遇到 empty-result 时会保留事件并继续产出阶段结果', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = 'fake-cube-token';
    process.env.NEO4J_URI = 'bolt://127.0.0.1:7687';
    process.env.NEO4J_USERNAME = 'neo4j';
    process.env.NEO4J_PASSWORD = 'password';

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: {
              strategy: '直接查询',
              tools: [{ toolName: 'cube.semantic-query', objective: '验证核心指标波动', confidence: 0.9 }],
            },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'demo', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() {
          return { metric: 'collection-rate', rows: [] };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() {
          return { mode: 'skip', factors: [] };
        },
      },
    });

    const result = await services.analysisExecutionUseCases.executeStep({
      stepId: 'inspect-metric-change',
      questionText: '为什么本月收费回款率下降？',
      planSummary: '先查指标',
      stepTitle: '校验核心指标波动',
      stepObjective: '验证收费回款率是否真实下降。',
      selectionContext: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-execution',
      },
      invocationContext: {
        correlationId: 'corr-empty',
        source: 'worker',
        userId: 'user-1',
        organizationId: 'org-1',
      },
      toolInputsByName: {
        'cube.semantic-query': {
          metric: 'collection-rate',
          scope: { organizationId: 'org-1', projectIds: ['p-1'] },
        },
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.equal(result.status, 'completed');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].ok, false);
  assert.equal(result.events[0].error.code, 'tool-empty-result');
});
