import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../');
const PROJECT = 'ontology-agent-7-3-test';
const COMPOSE_ARGS = ['-f', 'compose.prod.yaml', '--env-file', '.env.prod.example', '-p', PROJECT];

async function dc(...args) {
  return execFileAsync('docker', ['compose', ...COMPOSE_ARGS, ...args], { cwd: ROOT });
}

async function docker(...args) {
  return execFileAsync('docker', args, { cwd: ROOT });
}

function getComposeContainerName(service) {
  return `${PROJECT}-${service}-1`;
}

async function listComposeServices() {
  const { stdout } = await dc('ps', '--format', 'json');
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function inspectState(service) {
  const { stdout } = await docker(
    'inspect',
    getComposeContainerName(service),
    '--format',
    '{{json .State}}',
  );
  return JSON.parse(stdout.trim());
}

async function waitFor(check, timeoutMs, errorMessage) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  assert.fail(errorMessage);
}

// 真实容器启动测试 flag：需要 Docker 且磁盘足够
const RUN_CONTAINER_TESTS = process.env.RUN_CONTAINER_TESTS === '1';

// ─── 静态文件检查（始终跑）─────────────────────────────────────────────────

test('AC3 compose.prod.yaml 配置合法（docker compose config）', async () => {
  const { stderr } = await dc('config', '--quiet');
  assert.equal(stderr.trim(), '', `compose config 不应有错误输出: ${stderr}`);
});

test('AC3 compose.yaml（开发）配置合法', async () => {
  const { stderr } = await execFileAsync(
    'docker',
    ['compose', '-f', 'compose.yaml', '--env-file', '.env.example', 'config', '--quiet'],
    { cwd: ROOT },
  );
  assert.equal(stderr.trim(), '', `开发 compose config 不应有错误输出: ${stderr}`);
});

test('AC1 Dockerfile 存在且包含 multi-stage 构建', async () => {
  assert.ok(existsSync(path.join(ROOT, 'Dockerfile')), 'Dockerfile 必须存在');
  const content = await readFile(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.ok(content.includes('AS deps'), 'Dockerfile 应有 deps stage');
  assert.ok(content.includes('AS builder'), 'Dockerfile 应有 builder stage');
  assert.ok(content.includes('AS runner'), 'Dockerfile 应有 runner stage');
  assert.ok(content.includes('pnpm build'), 'Dockerfile 应执行 pnpm build');
  assert.ok(content.includes('standalone'), 'Dockerfile 应拷贝 standalone 产物');
});

test('AC1 Dockerfile.java 使用 Java 21 多阶段构建并启动正式 Spring Boot JAR', async () => {
  assert.ok(existsSync(path.join(ROOT, 'Dockerfile.java')), 'Dockerfile.java 必须存在');
  const content = await readFile(path.join(ROOT, 'Dockerfile.java'), 'utf8');
  assert.match(content, /maven:.*temurin-21 AS builder/);
  assert.match(content, /eclipse-temurin:21-jre/);
  assert.ok(content.includes('-DskipTests package'), 'Java 镜像构建必须生成正式 JAR');
  assert.ok(content.includes('USER spring'), 'Java 运行时不得使用 root');
  assert.ok(content.includes('/app/application.jar'), 'Java 镜像必须启动 Spring Boot JAR');
});

test('AC1 migrate 镜像与 Node Worker 运行入口彻底分离', async () => {
  assert.ok(existsSync(path.join(ROOT, 'Dockerfile.migrate')), 'Dockerfile.migrate 必须存在');
  assert.equal(existsSync(path.join(ROOT, 'Dockerfile.worker')), false, '不得保留可误启动的 Node Worker 镜像');
  const migrate = await readFile(path.join(ROOT, 'Dockerfile.migrate'), 'utf8');
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(migrate, /drizzle-kit/);
  assert.doesNotMatch(migrate, /src\/worker\/main\.ts/);
  assert.doesNotMatch(migrate, /COPY src \.\/src/, '迁移镜像不得复制整个 src 或旧 Worker 源码');
  assert.match(migrate, /COPY src\/infrastructure\/postgres\/schema \.\/src\/infrastructure\/postgres\/schema/);
  assert.equal(pkg.scripts['worker:dev'], undefined);
});

test('Node 工具链固定 pnpm 版本并显式许可所需原生构建', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const workspace = await readFile(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  assert.equal(pkg.packageManager, 'pnpm@11.7.0');
  assert.match(workspace, /^allowBuilds:\s*$/m);
  for (const dependency of ['esbuild', 'sharp', 'unrs-resolver']) {
    assert.match(workspace, new RegExp(`^  ${dependency}: true$`, 'm'));
  }
});

test('Ontology bootstrap 只保留 Java API 入口', async () => {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['ontology:bootstrap'], undefined);
  assert.equal(pkg.scripts['ontology:bootstrap:status'], undefined);
  assert.equal(existsSync(path.join(ROOT, 'scripts/ontology-bootstrap.mts')), false);
  assert.equal(existsSync(path.join(ROOT, 'scripts/seed-ontology-baseline.mts')), false);
});

test('AC2 生产 compose 不含 next dev 开发命令', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.doesNotMatch(content, /pnpm dev/, 'compose.prod.yaml 不应包含 pnpm dev');
  assert.doesNotMatch(content, /next dev/, 'compose.prod.yaml 不应包含 next dev');
  assert.doesNotMatch(content, /Dockerfile\.dev/, 'compose.prod.yaml 不应使用 Dockerfile.dev');
});

test('AC2 生产 Web 容器不持有 Cube、Neo4j 或模型 Provider 凭据', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  const webBlock = content.match(/^  web:\r?\n[\s\S]*?(?=^  backend:)/m)?.[0];

  assert.ok(webBlock, '应能定位生产 web service 配置');
  assert.doesNotMatch(webBlock, /CUBE_API_SECRET|NEO4J_PASSWORD|LLM_PROVIDER_API_KEY/);
});

test('AC2 生产 compose ENABLE_DEV_ERP_AUTH 强制为 0', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.ok(
    content.includes('ENABLE_DEV_ERP_AUTH: "0"'),
    'compose.prod.yaml 必须将 ENABLE_DEV_ERP_AUTH 固定为 "0"',
  );
});

test('AC3 生产 compose 定义 web/backend/postgres/redis 四个核心边界', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  for (const svc of ['web:', 'backend:', 'postgres:', 'redis:']) {
    assert.ok(content.includes(svc), `compose.prod.yaml 应包含服务 ${svc}`);
  }
  assert.doesNotMatch(content, /^  worker:/m, '生产拓扑不得继续启动旧 TypeScript Worker');
  assert.match(content, /JAVA_BACKEND_URL: http:\/\/backend:8080/);
  assert.match(content, /JAVA_GRAPH_SYNC_ENABLED: \$\{JAVA_GRAPH_SYNC_ENABLED:-true\}/);
  assert.match(content, /GRAPH_SYNC_OPS_SECRET: \$\{GRAPH_SYNC_OPS_SECRET\}/);
  assert.match(content, /dockerfile: Dockerfile\.migrate/);
  assert.match(content, /^  preflight:/m, '生产拓扑必须提供同网络的一次性 preflight 服务');
  assert.match(content, /preflight-java-cutover\.sql:\/opt\/ontology-agent\/preflight\.sql:ro/);
});

test('AC3 生产 compose web 服务有 healthcheck', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.ok(content.includes('healthcheck:'), 'compose.prod.yaml 应包含 healthcheck');
  assert.ok(content.includes('HOSTNAME: 0.0.0.0'), 'compose.prod.yaml 应显式固定 HOSTNAME=0.0.0.0，避免 standalone server 绑定到容器 ID');
});

test('AC3 生产 Cube 使用独立 Router/Worker，Neo4j 不使用已停止维护的 UBI9', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.match(content, /^  cubestore-router:/m);
  assert.match(content, /^  cubestore-worker:/m);
  assert.match(content, /image: cubejs\/cubestore:v1\.6\.31/);
  assert.match(content, /CUBEJS_CUBESTORE_HOST: cubestore-router/);
  assert.match(content, /CUBESTORE_META_ADDR: cubestore-router:9999/);
  assert.match(content, /image: neo4j:5\.26\.24-community-ubi10/);
  assert.doesNotMatch(content, /community-ubi9/);
});

test('Java cutover preflight 阻断重复绑定与活跃 legacy execution', async () => {
  const content = await readFile(path.join(ROOT, 'scripts/preflight-java-cutover.sql'), 'utf8');
  assert.match(content, /HAVING count\(\*\) > 1/i);
  assert.match(content, /java-initial-v1/);
  assert.match(content, /java-follow-up-v1/);
  assert.match(content, /status IN \('pending', 'queued', 'processing'\)/);
  assert.match(content, /snapshot\.follow_up_id IS DISTINCT FROM follow_up\.id/);
  assert.match(content, /RAISE EXCEPTION 'JAVA_CUTOVER_PREFLIGHT_FAILED/);
  assert.match(content, /to_regnamespace\('platform'\) IS NULL AS fresh_database/);
  assert.match(content, /current_ontology_versions <> 1/);
  assert.match(content, /processing_graph_scopes > 0/);
});

test('AC1 生产 web 镜像构建冒烟（docker build --target runner）', { skip: !RUN_CONTAINER_TESTS }, async () => {
  // execFileAsync 在非零 exit code 时 throw，因此只要不 throw 就代表构建成功
  await assert.doesNotReject(
    () =>
      execFileAsync(
        'docker',
        ['build', '-f', 'Dockerfile', '--target', 'runner', '-t', 'ontology-agent-web:7-3-smoke', '.'],
        { cwd: ROOT },
      ),
    'web 镜像应构建成功',
  );
  await execFileAsync('docker', ['rmi', 'ontology-agent-web:7-3-smoke', '--force'], { cwd: ROOT }).catch(() => {});
});

test('AC1 Java backend 镜像构建冒烟（docker build Dockerfile.java）', { skip: !RUN_CONTAINER_TESTS }, async () => {
  await assert.doesNotReject(
    () =>
      execFileAsync(
        'docker',
        ['build', '-f', 'Dockerfile.java', '-t', 'ontology-agent-backend:7-3-smoke', '.'],
        { cwd: ROOT },
      ),
    'Java backend 镜像应构建成功',
  );
  await execFileAsync('docker', ['rmi', 'ontology-agent-backend:7-3-smoke', '--force'], { cwd: ROOT }).catch(() => {});
});

// ─── 真实容器启动验证（需要 RUN_CONTAINER_TESTS=1）──────────────────────────

test('AC1 postgres+redis 能健康启动', { skip: !RUN_CONTAINER_TESTS }, async () => {
  try {
    // 不使用 --build，仅启动基础设施镜像（postgres/redis 均为官方 image，无需构建）
    await dc('up', '-d', 'postgres', 'redis');

    // 等待最多 90s 直到 healthy
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const { stdout } = await dc('ps', '--format', 'json');
      const lines = stdout.trim().split('\n').filter(Boolean);
      const services = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const pgHealthy = services.find((s) => s.Service === 'postgres')?.Health === 'healthy';
      const rdHealthy = services.find((s) => s.Service === 'redis')?.Health === 'healthy';
      if (pgHealthy && rdHealthy) return;
    }
    assert.fail('postgres / redis 未在 90s 内达到 healthy 状态');
  } finally {
    await dc('stop', 'postgres', 'redis').catch(() => {});
  }
});

test('AC1 migrate 服务能成功运行（退出码 0）', { skip: !RUN_CONTAINER_TESTS }, async () => {
  try {
    // 先保证 postgres 运行
    await dc('up', '-d', 'postgres');
    await new Promise((r) => setTimeout(r, 15000));

    // 运行 migrate（one-shot，等待完成）
    const { stdout, stderr } = await dc('run', '--rm', '--no-deps', 'migrate');
    // drizzle-kit 输出到 stderr，stdout 可能为空
    const combined = stdout + stderr;
    assert.ok(
      !combined.toLowerCase().includes('error') || combined.includes('No changes'),
      `migrate 不应报错: ${combined.slice(0, 1000)}`,
    );
  } finally {
    await dc('down', '--remove-orphans').catch(() => {});
  }
});

test('AC1 web 与 Java backend 能在生产 compose 中稳定启动', { skip: !RUN_CONTAINER_TESTS }, async () => {
  try {
    await dc('up', '-d', 'web', 'backend');

    await waitFor(
      async () => {
        const services = await listComposeServices();
        const web = services.find((service) => service.Service === 'web');
        return web?.Health === 'healthy';
      },
      120_000,
      'web 未在 120s 内变为 healthy',
    );

    await waitFor(
      async () => {
        const services = await listComposeServices();
        const backend = services.find((service) => service.Service === 'backend');
        return backend?.Health === 'healthy';
      },
      120_000,
      'Java backend 未在 120s 内变为 healthy',
    );

    const backendState = await inspectState('backend');
    assert.equal(backendState.ExitCode, 0, `backend 不应以非零退出码重启: ${JSON.stringify(backendState)}`);

    const { stdout, stderr } = await docker('exec', getComposeContainerName('web'), 'node', '-e', "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");
    assert.equal(`${stdout}${stderr}`.trim(), '', 'web 容器内本地探针应成功连接 127.0.0.1:3000');
  } finally {
    await dc('down', '--remove-orphans').catch(() => {});
  }
});
