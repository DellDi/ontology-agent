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
const COMPOSE_ARGS = ['-f', 'compose.prod.yaml', '--env-file', '.env.example', '-p', PROJECT];

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

test('AC1 Dockerfile.worker 包含全量依赖安装和 tsx 运行命令', async () => {
  assert.ok(existsSync(path.join(ROOT, 'Dockerfile.worker')), 'Dockerfile.worker 必须存在');
  const content = await readFile(path.join(ROOT, 'Dockerfile.worker'), 'utf8');
  assert.ok(content.includes('pnpm install --frozen-lockfile'), 'Dockerfile.worker 应安装全量依赖（不含 --prod）');
  assert.doesNotMatch(content, /--prod/, 'Dockerfile.worker 不应使用 --prod（tsx 是 devDep）');
  assert.ok(content.includes('worker/main'), 'Dockerfile.worker 应启动 worker/main');
  assert.ok(content.includes('"tsx"'), 'Dockerfile.worker 应使用 tsx register 模式启动 worker');
  assert.doesNotMatch(
    content,
    /CMD\s+\[[^\]]*tsx\/esm[^\]]*\]/,
    'Dockerfile.worker 不应使用会触发 require-cycle 的 tsx/esm',
  );
  assert.ok(content.includes('drizzle.config.ts'), 'Dockerfile.worker 应包含 drizzle.config.ts');
  assert.ok(content.includes('COPY drizzle'), 'Dockerfile.worker 应包含 drizzle/ 迁移目录');
});

test('AC2 生产 compose 不含 next dev 开发命令', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.doesNotMatch(content, /pnpm dev/, 'compose.prod.yaml 不应包含 pnpm dev');
  assert.doesNotMatch(content, /next dev/, 'compose.prod.yaml 不应包含 next dev');
  assert.doesNotMatch(content, /Dockerfile\.dev/, 'compose.prod.yaml 不应使用 Dockerfile.dev');
});

test('AC2 生产 compose ENABLE_DEV_ERP_AUTH 强制为 0', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.ok(
    content.includes('ENABLE_DEV_ERP_AUTH: "0"'),
    'compose.prod.yaml 必须将 ENABLE_DEV_ERP_AUTH 固定为 "0"',
  );
});

test('AC3 生产 compose 定义 web/worker/postgres/redis 四个核心边界', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  for (const svc of ['web:', 'worker:', 'postgres:', 'redis:']) {
    assert.ok(content.includes(svc), `compose.prod.yaml 应包含服务 ${svc}`);
  }
});

test('AC3 生产 compose web 服务有 healthcheck', async () => {
  const content = await readFile(path.join(ROOT, 'compose.prod.yaml'), 'utf8');
  assert.ok(content.includes('healthcheck:'), 'compose.prod.yaml 应包含 healthcheck');
  assert.ok(content.includes('HOSTNAME: 0.0.0.0'), 'compose.prod.yaml 应显式固定 HOSTNAME=0.0.0.0，避免 standalone server 绑定到容器 ID');
});

test('AC1 生产 web 镜像构建冒烟（docker build --target runner）', async () => {
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

test('AC1 worker 镜像构建冒烟（docker build Dockerfile.worker）', async () => {
  await assert.doesNotReject(
    () =>
      execFileAsync(
        'docker',
        ['build', '-f', 'Dockerfile.worker', '-t', 'ontology-agent-worker:7-3-smoke', '.'],
        { cwd: ROOT },
      ),
    'worker 镜像应构建成功',
  );
  await execFileAsync('docker', ['rmi', 'ontology-agent-worker:7-3-smoke', '--force'], { cwd: ROOT }).catch(() => {});
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

test('AC1 web 与 worker 能在生产 compose 中稳定启动', { skip: !RUN_CONTAINER_TESTS }, async () => {
  try {
    await dc('up', '-d', 'web', 'worker');

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
        const workerState = await inspectState('worker');
        return workerState.Running === true && workerState.Restarting === false;
      },
      30_000,
      'worker 未能稳定运行，可能仍在重启或已退出',
    );

    const workerState = await inspectState('worker');
    assert.equal(workerState.ExitCode, 0, `worker 不应以非零退出码重启: ${JSON.stringify(workerState)}`);

    const { stdout, stderr } = await docker('exec', getComposeContainerName('web'), 'node', '-e', "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))");
    assert.equal(`${stdout}${stderr}`.trim(), '', 'web 容器内本地探针应成功连接 127.0.0.1:3000');
  } finally {
    await dc('down', '--remove-orphans').catch(() => {});
  }
});
