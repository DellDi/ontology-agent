import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

test('旧 Node Agent/Worker 运行时与启动入口均已删除', async () => {
  const pkg = JSON.parse(await readRepoFile('package.json'));

  for (const removedPath of [
    'src/worker/main.ts',
    'src/composition-root.ts',
    'src/infrastructure/llm/index.ts',
    'src/infrastructure/job/redis-job-queue.ts',
    'src/infrastructure/job/runtime.ts',
    'src/infrastructure/redis/client.ts',
    'src/application/job/use-cases.ts',
    'src/infrastructure/analysis-execution/redis-analysis-execution-event-store.ts',
  ]) {
    await assert.rejects(access(path.join(repoRoot, removedPath)), undefined,
      `旧实现必须已删除: ${removedPath}`);
  }
  assert.equal(pkg.scripts['worker:dev'], undefined, 'package scripts 不得再暴露 Node Worker 启动入口');
  assert.equal(pkg.dependencies.ai, undefined);
  assert.equal(pkg.dependencies.openai, undefined);
  assert.equal(pkg.dependencies['drizzle-orm'], undefined, 'Web 不再持有 Drizzle');
  assert.equal(pkg.dependencies.pg, undefined, 'Web 不再直连 PostgreSQL');
  assert.equal(pkg.dependencies.redis, undefined, 'Web 不再持有 Redis');
  assert.equal(pkg.dependencies.mysql2, undefined);
  assert.equal(pkg.dependencies['neo4j-driver'], undefined);
});

test('job contract 模型仍保留供 UI 映射使用', async () => {
  const content = await readRepoFile('src/domain/job-contract/models.ts');

  assert.match(content, /health-check/, '应该包含 health-check 任务类型');
  assert.match(content, /JobType/, '应该导出 JobType 类型');
  assert.match(content, /JobStatus/, '应该导出 JobStatus 类型');
  assert.match(content, /JobPayload/, '应该导出 JobPayload 类型');
  assert.match(content, /validateJobPayload/, '应该导出 validateJobPayload 函数');
});

test('全部认证路由与业务路由一样是 Java 透明代理', async () => {
  for (const route of [
    'src/app/api/auth/login/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/auth/callback/route.ts',
    'src/app/api/auth/directory-login/route.ts',
    'src/app/api/auth/bridge/route.ts',
    'src/app/api/auth/me/route.ts',
  ]) {
    const source = await readRepoFile(route);
    assert.match(source, /forwardJavaBackendRequest\(request\)/, `${route} 必须是 Java 代理`);
    assert.doesNotMatch(source, /server-auth|getRequestSession|NextResponse/, `${route} 不得再持有会话逻辑`);
  }

  const proxy = await readRepoFile('src/infrastructure/java-backend/client.ts');
  assert.match(proxy, /'set-cookie'/, '代理必须透传 Set-Cookie（登录/登出）');
  assert.match(proxy, /'location'/, '代理必须透传 303 Location');
});

test('登录页不再读取 Node 会话存储，改由 Java viewer/config 驱动', async () => {
  const loginPage = await readRepoFile('src/app/(auth)/login/page.tsx');
  assert.match(loginPage, /getCurrentViewer/, '登录页应通过 Java /api/auth/me 判断会话');
  assert.match(loginPage, /getAuthConfig/, '登录页应通过 Java /api/auth/config 读取能力状态');
  assert.doesNotMatch(loginPage, /server-auth/, '登录页不得再引用 Node 会话模块');
});

test('compose 中 migrate 由 Java Flyway 独立执行，Web 不再持有数据库凭据', async () => {
  const compose = await readRepoFile('compose.yaml');
  const prodCompose = await readRepoFile('compose.prod.yaml');

  for (const file of [compose, prodCompose]) {
    assert.match(file, /dockerfile: Dockerfile\.java/, 'migrate 服务必须使用 Java 镜像');
    assert.match(file, /--spring\.profiles\.active=migrate/, 'migrate 服务必须走 migrate profile');
    assert.doesNotMatch(file, /drizzle-kit/, '不得再出现 drizzle-kit');
  }

  const webBlock = compose.match(/^  web:\r?\n[\s\S]*?(?=^  postgres:)/m)?.[0];
  assert.ok(webBlock, '应能定位 web service 配置');
  assert.doesNotMatch(webBlock, /DATABASE_URL/, 'Web 容器不得注入 DATABASE_URL');
  assert.doesNotMatch(webBlock, /REDIS_URL/, 'Web 容器不得注入 REDIS_URL');
  assert.doesNotMatch(webBlock, /SESSION_SECRET/, 'Web 容器不再需要会话签名密钥');
});

test('compose.yaml 只启用 Java Worker，不再启动 Node Worker', async () => {
  const content = await readRepoFile('compose.yaml');

  assert.doesNotMatch(content, /\n  worker:/, 'compose.yaml 不应再启动 Node Worker');
  assert.match(content, /JAVA_WORKER_ENABLED:\s*"true"/, 'Java backend 应启用正式 Worker');
});
