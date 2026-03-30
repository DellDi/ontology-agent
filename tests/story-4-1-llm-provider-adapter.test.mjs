import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

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

const requiredPaths = [
  'src/application/llm/models.ts',
  'src/application/llm/ports.ts',
  'src/application/llm/use-cases.ts',
  'src/infrastructure/llm/config.ts',
  'src/infrastructure/llm/errors.ts',
  'src/infrastructure/llm/rate-limit.ts',
  'src/infrastructure/llm/openai-compatible-adapter.ts',
  'src/infrastructure/llm/index.ts',
];

for (const relativePath of requiredPaths) {
  test(`Story 4.1 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('.env.example 包含 LLM provider 所需环境变量', async () => {
  const envExample = await readRepoFile('.env.example');

  for (const envName of [
    'LLM_PROVIDER_BASE_URL',
    'DASHSCOPE_API_KEY',
    'LLM_PROVIDER_MODEL',
    'LLM_FALLBACK_MODELS',
    'LLM_REQUEST_TIMEOUT_MS',
    'LLM_MAX_RETRIES',
    'LLM_RATE_LIMIT_MAX_REQUESTS',
    'LLM_RATE_LIMIT_WINDOW_SECONDS',
  ]) {
    assert.match(envExample, new RegExp(envName), `${envName} 应存在于 .env.example`);
  }
});

test('application 层定义统一 LLM port、调用上下文与健康检查契约', async () => {
  const models = await readRepoFile('src/application/llm/models.ts');
  const ports = await readRepoFile('src/application/llm/ports.ts');
  const useCases = await readRepoFile('src/application/llm/use-cases.ts');

  assert.match(models, /LlmInvocationContext/);
  assert.match(models, /userId/);
  assert.match(models, /organizationId/);
  assert.match(models, /timeoutMs/);
  assert.match(models, /maxRetries/);
  assert.match(models, /rateLimit/);

  assert.match(ports, /LlmProviderPort/);
  assert.match(ports, /createResponse/);
  assert.match(ports, /createChatCompletion/);
  assert.match(ports, /checkHealth/);

  assert.match(useCases, /createLlmUseCases/);
  assert.match(useCases, /provider: LlmProviderPort/);
});

test('package.json 引入 openai SDK 作为 LLM transport 依赖', async () => {
  const packageJson = await readRepoFile('package.json');

  assert.match(packageJson, /"openai"\s*:/, '应引入 openai SDK 依赖');
});

test('OpenAI-compatible adapter 仅服务端可用，并通过 openai SDK 调用 responses/chat 接口', async () => {
  const adapter = await readRepoFile(
    'src/infrastructure/llm/openai-compatible-adapter.ts',
  );

  assert.match(adapter, /server-only/, 'adapter 应声明仅服务端可用');
  assert.match(
    adapter,
    /import OpenAI from 'openai'|from "openai"/,
    'adapter 应基于 openai SDK 构建 client',
  );
  assert.match(adapter, /new OpenAI\(/, 'adapter 应创建 openai client');
  assert.match(adapter, /baseURL:\s*config\.baseUrl/, '应将百炼 baseURL 注入 SDK');
  assert.match(adapter, /apiKey:\s*config\.apiKey/, '应将 API Key 注入 SDK');
  assert.match(adapter, /responses\.create/, '应支持 responses 风格接口');
  assert.match(
    adapter,
    /chat\.completions\.create/,
    '应支持 chat completions 风格接口',
  );
  assert.match(adapter, /timeout:\s*context\.timeoutMs|timeout:\s*config\.timeoutMs/, '应包含超时控制');
});

test('LLM config 与错误模型覆盖超时、429、provider 不可用和结构错误', async () => {
  const config = await readRepoFile('src/infrastructure/llm/config.ts');
  const errors = await readRepoFile('src/infrastructure/llm/errors.ts');

  for (const envName of [
    'LLM_PROVIDER_BASE_URL',
    'DASHSCOPE_API_KEY',
    'LLM_PROVIDER_MODEL',
    'LLM_FALLBACK_MODELS',
    'LLM_REQUEST_TIMEOUT_MS',
    'LLM_MAX_RETRIES',
    'LLM_RATE_LIMIT_MAX_REQUESTS',
    'LLM_RATE_LIMIT_WINDOW_SECONDS',
  ]) {
    assert.match(config, new RegExp(envName));
  }

  assert.match(errors, /LlmProviderTimeoutError/);
  assert.match(errors, /LlmRateLimitExceededError/);
  assert.match(errors, /LlmProviderUnavailableError/);
  assert.match(errors, /LlmProviderResponseError/);
  assert.match(config, /dashscope\.aliyuncs\.com\/compatible-mode\/v1/);
  assert.match(config, /bailian\/qwen3\.5-plus/);
  assert.match(config, /bailian\/kimi-2\.5/);
  assert.match(config, /resolveProviderModelName/);
});

test('限流实现复用 Redis，并同时绑定 userId 与 organizationId 维度', async () => {
  const rateLimit = await readRepoFile('src/infrastructure/llm/rate-limit.ts');

  assert.match(rateLimit, /createRedisClient|RedisClientType/);
  assert.match(rateLimit, /redisKeys\.rate\(/);
  assert.match(rateLimit, /userId/);
  assert.match(rateLimit, /organizationId/);
  assert.match(rateLimit, /expire|EXPIRE/i);
  assert.match(
    rateLimit,
    /multi\(\)|eval\(|exec\(\)/,
    '限流键递增与 TTL 设置应采用原子方式',
  );
  assert.match(
    rateLimit,
    /== 1|=== 1|requestCount === 1|count === 1/,
    '原子化实现仍应保持“首次请求设置 TTL”的固定窗口语义',
  );
});

test('LLM 入口包含健康检查与统一导出', async () => {
  const index = await readRepoFile('src/infrastructure/llm/index.ts');
  const adapter = await readRepoFile(
    'src/infrastructure/llm/openai-compatible-adapter.ts',
  );

  assert.match(index, /createOpenAiCompatibleLlmProvider/);
  assert.match(index, /getLlmProviderConfig/);
  assert.match(index, /createLlmUseCases/);
  assert.match(adapter, /checkHealth/);
});

test('OpenAI-compatible adapter 支持按百炼 fallback 模型链依次重试', async () => {
  const adapter = await readRepoFile(
    'src/infrastructure/llm/openai-compatible-adapter.ts',
  );

  assert.match(adapter, /fallbackModels/);
  assert.match(adapter, /resolveProviderModelName/);
  assert.match(adapter, /for \(const model of modelsToTry\)/);
  assert.match(
    adapter,
    /LlmProviderResponseError/,
    '常见 4xx 模型错误应纳入 fallback 判定范围',
  );
});

test('Redis 连接阶段应受超时边界控制，避免在限流前无限等待', async () => {
  const adapter = await readRepoFile(
    'src/infrastructure/llm/openai-compatible-adapter.ts',
  );

  assert.match(adapter, /redis\.connect\(/);
  assert.match(
    adapter,
    /Promise\.race|withTimeout|connectTimeoutMs/,
    'Redis 连接应有显式超时保护',
  );
  assert.match(
    adapter,
    /redis\.destroy\(|redis\.disconnect\(/,
    'Redis 连接超时后应显式销毁或断开客户端，避免后台悬挂连接',
  );
});

test('健康检查不应只依赖 models.list，而要验证真实模型调用能力', async () => {
  const adapter = await readRepoFile(
    'src/infrastructure/llm/openai-compatible-adapter.ts',
  );

  assert.match(adapter, /checkHealth/);
  assert.match(adapter, /models\.list/);
  assert.match(
    adapter,
    /responses\.create|chat\.completions\.create/,
    '健康检查应包含真实调用能力验证，而不只是 provider 目录检查',
  );
  assert.match(
    adapter,
    /try[\s\S]*models\.list[\s\S]*catch[\s\S]*responses\.create|responses\.create[\s\S]*models\.list/,
    '健康检查不应把 /models 作为唯一硬依赖',
  );
});

test('浏览器端源码中不直接持有 LLM provider 密钥或调用 provider', async () => {
  const appFiles = await listSourceFiles('src/app');
  const contents = await Promise.all(appFiles.map((file) => readRepoFile(file)));
  const combined = contents.join('\n');

  assert.doesNotMatch(combined, /LLM_PROVIDER_API_KEY/);
  assert.doesNotMatch(combined, /OPENAI_API_KEY/);
  assert.doesNotMatch(combined, /\/responses/);
  assert.doesNotMatch(combined, /\/chat\/completions/);
});
