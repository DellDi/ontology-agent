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

test('tool registry 会将输入校验失败归一化为 tool-validation-failed', async () => {
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
          return { metric: 'collection-rate', rows: [{ value: 1, time: null, dimensions: {} }] };
        },
      },
      graphUseCases: {
        async expandCandidateFactors() {
          return { mode: 'skip', factors: [] };
        },
      },
    });

    const result = await services.toolRegistryUseCases.invokeTool({
      toolName: 'cube.semantic-query',
      input: {
        scope: { organizationId: 'org-1', projectIds: ['p-1'] },
      },
      context: {
        correlationId: 'corr-invalid-input',
        source: 'application',
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'tool-validation-failed');
  assert.equal(result.error.retryable, false);
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

test('确认口径步骤在无 ready 工具时仍会保留 capability-status 作为显式降级路径', async () => {
  const result = await runTsSnippet(`
    import analysisExecutionModule from './src/application/analysis-execution/use-cases.ts';

    const { createAnalysisExecutionUseCases } = analysisExecutionModule;

    const useCases = createAnalysisExecutionUseCases({
      toolRegistryUseCases: {
        listToolDefinitions() {
          return [
            {
              name: 'platform.capability-status',
              title: '平台能力状态',
              description: '平台能力检查',
              runtime: 'shared',
              availability: 'degraded',
              availabilityReason: 'health check failed',
              inputSchemaLabel: 'platformCapabilityStatusInputSchema',
              outputSchemaLabel: 'platformCapabilityStatusOutputSchema',
            },
          ];
        },
        async invokeTool() {
          throw new Error('not needed');
        },
      },
      analysisAiUseCases: {
        async runTask() {
          return {
            ok: true,
            value: {
              strategy: '模型未返回可用工具',
              tools: [],
            },
          };
        },
      },
    });

    const result = await useCases.selectToolsForStep({
      stepId: 'confirm-analysis-scope',
      questionText: '确认这次分析范围',
      planSummary: '先确认范围',
      stepTitle: '确认分析口径',
      stepObjective: '识别当前可用能力与范围约束。',
      context: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-execution',
      },
    });

    console.log(JSON.stringify(result));
  `);

  assert.match(result.strategy, /降级路径|回退/);
  assert.deepEqual(
    result.tools.map((tool) => tool.toolName),
    ['platform.capability-status'],
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

test('tooling services 暴露 AI runtime tool bridge，并复用既有 tool registry 可用性', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';

    const { createAnalysisToolingServices } = toolingModule;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    delete process.env.CUBE_API_TOKEN;
    delete process.env.NEO4J_URI;
    delete process.env.NEO4J_USERNAME;
    delete process.env.NEO4J_PASSWORD;

    const services = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: {},
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

    console.log(JSON.stringify(services.aiRuntimeToolBridge.listTools()));
  `);

  assert.ok(result.some((tool) => tool.toolName === 'llm.structured-analysis'));
  assert.ok(result.some((tool) => tool.toolName === 'platform.capability-status'));
  assert.ok(
    result.some(
      (tool) =>
        tool.toolName === 'cube.semantic-query' &&
        tool.status === 'unavailable',
    ),
    'runtime bridge 应暴露 tool registry 的 degraded 状态',
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

test('所有工具都返回 empty-result 时，阶段消息会给出可读提示而不是通用文案', async () => {
  const result = await runTsSnippet(`
    import rendererModule from './src/worker/analysis-execution-renderer.ts';

    const { buildStepResultMessage } = rendererModule;

    const message = buildStepResultMessage(
      {
        status: 'completed',
        strategy: '保守回退',
        tools: [
          {
            toolName: 'cube.semantic-query',
            objective: '验证核心指标波动',
            confidence: 0.9,
          },
        ],
        events: [
          {
            ok: false,
            toolName: 'cube.semantic-query',
            correlationId: 'corr-empty-only',
            startedAt: '2026-04-11T00:00:00.000Z',
            finishedAt: '2026-04-11T00:00:01.000Z',
            error: {
              code: 'tool-empty-result',
              message: 'Cube 指标 collection-rate 未返回任何结果。',
              toolName: 'cube.semantic-query',
              correlationId: 'corr-empty-only',
              retryable: false,
            },
          },
        ],
      },
      2,
    );

    console.log(JSON.stringify({ message }));
  `);

  assert.match(result.message, /未返回可用|空结果|暂无可用/);
  assert.doesNotMatch(result.message, /真实工具结果已回传/);
});
