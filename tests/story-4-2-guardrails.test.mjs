import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

async function listSourceFiles(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const nextRelative = path.join(relativeDir, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(nextRelative);
      }

      return [nextRelative];
    }),
  );

  return files.flat();
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
  'src/domain/analysis-ai/models.ts',
  'src/domain/analysis-ai/contracts.ts',
  'src/application/analysis-ai/ports.ts',
  'src/application/analysis-ai/use-cases.ts',
  'src/infrastructure/analysis-ai/contract-port.ts',
  'src/infrastructure/llm/prompt-registry.ts',
  'src/infrastructure/llm/schema-guardrails.ts',
];

for (const relativePath of requiredPaths) {
  test(`Story 4.2 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('package.json 显式引入 zod 作为结构化输出契约依赖', async () => {
  const packageJson = await readRepoFile('package.json');

  assert.match(packageJson, /"zod"\s*:/, '应显式引入 zod 依赖');
});

test('Prompt registry 集中管理主要任务类型，不把 prompt 散落到页面层', async () => {
  const registry = await readRepoFile('src/infrastructure/llm/prompt-registry.ts');
  const appFiles = await listSourceFiles('src/app');
  const appContents = await Promise.all(appFiles.map((file) => readRepoFile(file)));
  const combinedApp = appContents.join('\n');

  for (const taskType of [
    'analysis-intent',
    'analysis-context',
    'analysis-plan',
    'tool-selection',
    'conclusion-summary',
  ]) {
    assert.match(registry, new RegExp(taskType), `${taskType} 应在 prompt registry 中集中定义`);
  }

  assert.doesNotMatch(
    combinedApp,
    /['"]analysis-intent['"]|['"]analysis-context['"]|['"]analysis-plan['"]|['"]tool-selection['"]|['"]conclusion-summary['"]/,
    '页面层不应直接持有结构化 AI 任务字面量或 prompt 文本',
  );
});

test('Schema guardrails 为五类主要任务建立 Zod 输入/输出契约', async () => {
  const contracts = await readRepoFile('src/domain/analysis-ai/contracts.ts');
  const guardrails = await readRepoFile('src/infrastructure/llm/schema-guardrails.ts');

  for (const schemaName of [
    'analysisIntentInputSchema',
    'analysisIntentOutputSchema',
    'analysisContextInputSchema',
    'analysisContextOutputSchema',
    'analysisPlanInputSchema',
    'analysisPlanOutputSchema',
    'toolSelectionInputSchema',
    'toolSelectionOutputSchema',
    'conclusionSummaryInputSchema',
    'conclusionSummaryOutputSchema',
  ]) {
    assert.match(contracts, new RegExp(schemaName), `${schemaName} 应存在`);
  }

  assert.match(guardrails, /safeParse/, 'guardrail 应通过 schema safeParse 校验输出');
  assert.match(guardrails, /fallback/i, 'guardrail 应包含稳定 fallback 逻辑');
});

test('结构化任务请求会显式携带 provider 级 schema 元数据，而不只靠 prompt 约定', async () => {
  const llmModels = await readRepoFile('src/application/llm/models.ts');
  const registry = await readRepoFile('src/infrastructure/llm/prompt-registry.ts');
  const adapter = await readRepoFile(
    'src/infrastructure/llm/openai-compatible-adapter.ts',
  );
  const builtRequest = await runTsSnippet(`
    import promptRegistryModule from './src/infrastructure/llm/prompt-registry.ts';

    const { buildStructuredTaskRequest } = promptRegistryModule;

    const request = buildStructuredTaskRequest('analysis-intent', {
      questionText: '为什么收费率下降了',
    });

    console.log(JSON.stringify(request));
  `);

  assert.match(
    llmModels,
    /responseFormat\??:\s*LlmResponseFormatConfig/,
    'LlmResponseRequest 应显式携带结构化响应元数据',
  );
  assert.match(
    registry,
    /z\.toJSONSchema|toJSONSchema/,
    '结构化任务应基于 schema 生成 provider 可消费的 JSON schema',
  );
  assert.match(
    adapter,
    /text:\s*request\.responseFormat|format:\s*mapResponseFormat\(request\.responseFormat\)/s,
    'OpenAI-compatible adapter 应把 responseFormat 映射到 responses.create 的 text.format',
  );
  assert.equal(builtRequest.responseFormat.type, 'json_schema');
  assert.equal(typeof builtRequest.responseFormat.name, 'string');
  assert.equal(typeof builtRequest.responseFormat.schema, 'object');
});

test('Application use case 通过 port 注入结构化契约，不直接依赖 infrastructure 模块', async () => {
  const useCases = await readRepoFile('src/application/analysis-ai/use-cases.ts');
  const ports = await readRepoFile('src/application/analysis-ai/ports.ts');
  const infrastructurePort = await readRepoFile(
    'src/infrastructure/analysis-ai/contract-port.ts',
  );

  assert.match(useCases, /AnalysisAiContractPort/, 'application 层应依赖分析 AI port');
  assert.doesNotMatch(
    useCases,
    /@\/infrastructure\/llm\/prompt-registry|@\/infrastructure\/llm\/schema-guardrails/,
    'application use case 不应直接依赖 infrastructure 的 prompt 或 guardrail 实现',
  );
  assert.match(
    ports,
    /buildRequest|parseOutput/,
    'analysis AI port 应显式暴露请求构造与输出解析能力',
  );
  assert.match(
    infrastructurePort,
    /buildStructuredTaskRequest|parseStructuredTaskOutput/,
    'infrastructure 适配层应负责拼装 registry 与 guardrail',
  );
});

test('非法模型输出不会污染链路，而是返回稳定 fallback envelope', async () => {
  const result = await runTsSnippet(`
    import schemaGuardrailsModule from './src/infrastructure/llm/schema-guardrails.ts';

    const { parseStructuredTaskOutput } = schemaGuardrailsModule;

    const output = parseStructuredTaskOutput({
      taskType: 'analysis-intent',
      rawText: '{"type":"unknown-intent","goal":42}',
      raw: { source: 'test' },
    });

    console.log(JSON.stringify(output));
  `);

  assert.equal(result.taskType, 'analysis-intent');
  assert.equal(result.ok, false);
  assert.equal(result.value.type, 'general-analysis');
  assert.equal(typeof result.value.goal, 'string');
  assert.ok(Array.isArray(result.issues));
  assert.ok(result.issues.length > 0);
});

test('Analysis AI use case 会串联 Story 4.1 adapter 与 schema guardrail', async () => {
  const result = await runTsSnippet(`
    import analysisAiUseCasesModule from './src/application/analysis-ai/use-cases.ts';

    const { createAnalysisAiUseCases } = analysisAiUseCasesModule;
    import contractPortModule from './src/infrastructure/analysis-ai/contract-port.ts';

    const { createAnalysisAiContractPort } = contractPortModule;

    const useCases = createAnalysisAiUseCases({
      llmUseCases: {
        async createResponse() {
          return {
            provider: 'openai-compatible',
            model: 'bailian/kimi-k2.5',
            text: '{"type":"invalid","goal":123}',
            finishReason: 'stop',
            raw: { provider: 'fake' },
          };
        },
      },
      contractPort: createAnalysisAiContractPort(),
    });

    const output = await useCases.runTask({
      taskType: 'analysis-intent',
      input: { questionText: '为什么收费率下降了' },
      context: {
        userId: 'user-1',
        organizationId: 'org-1',
        purpose: 'analysis-intent',
      },
    });

    console.log(JSON.stringify(output));
  `);

  assert.equal(result.taskType, 'analysis-intent');
  assert.equal(result.ok, false);
  assert.equal(result.value.type, 'general-analysis');
  assert.ok(Array.isArray(result.issues));
});
