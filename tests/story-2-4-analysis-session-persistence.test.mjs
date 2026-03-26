import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. 契约测试：Postgres analysis session store 文件存在且结构正确
// ---------------------------------------------------------------------------

test('Story 2.4 工件存在：postgres-analysis-session-store.ts', async () => {
  await access(
    path.join(
      repoRoot,
      'src/infrastructure/analysis-session/postgres-analysis-session-store.ts',
    ),
  );
});

test('postgres-analysis-session-store 实现 AnalysisSessionStore 接口（create / getById / listByOwner）', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/analysis-session/postgres-analysis-session-store.ts',
  );

  assert.match(storeSource, /createPostgresAnalysisSessionStore/);
  assert.match(storeSource, /AnalysisSessionStore/);
  assert.match(storeSource, /async create\(/);
  assert.match(storeSource, /async getById\(/);
  assert.match(storeSource, /async listByOwner\(/);
});

test('postgres-analysis-session-store 复用 platform.analysis_sessions 表', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/analysis-session/postgres-analysis-session-store.ts',
  );

  assert.match(storeSource, /analysisSessions/);
  assert.match(
    storeSource,
    /from ['"]@\/infrastructure\/postgres/,
    '应复用 infrastructure/postgres 下的 schema 与 client',
  );
  assert.doesNotMatch(
    storeSource,
    /pgSchema\(/,
    '不应在 analysis session store 中重新定义 pgSchema',
  );
});

test('postgres-analysis-session-store 保留 ownerUserId / questionText / status / 时间字段映射', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/analysis-session/postgres-analysis-session-store.ts',
  );

  for (const field of [
    'ownerUserId',
    'questionText',
    'status',
    'createdAt',
    'updatedAt',
  ]) {
    assert.match(
      storeSource,
      new RegExp(field),
      `应映射领域模型字段 ${field}`,
    );
  }
});

test('postgres-analysis-session-store listByOwner 按 updatedAt 倒序返回', async () => {
  const storeSource = await readRepoFile(
    'src/infrastructure/analysis-session/postgres-analysis-session-store.ts',
  );

  assert.match(
    storeSource,
    /desc\(.*updatedAt/s,
    'listByOwner 应使用 desc(updatedAt) 排序',
  );
});

// ---------------------------------------------------------------------------
// 2. 契约测试：所有引用已切换到 Postgres store
// ---------------------------------------------------------------------------

const consumerFiles = [
  'src/app/api/analysis/sessions/route.ts',
  'src/app/(workspace)/workspace/page.tsx',
  'src/app/(workspace)/workspace/analysis/[sessionId]/page.tsx',
];

for (const filePath of consumerFiles) {
  test(`${filePath} 使用 createPostgresAnalysisSessionStore`, async () => {
    const source = await readRepoFile(filePath);

    assert.match(source, /createPostgresAnalysisSessionStore/);
    assert.doesNotMatch(
      source,
      /createMemoryAnalysisSessionStore/,
      '不应再引用内存 analysis session store',
    );
  });
}

// ---------------------------------------------------------------------------
// 3. 契约测试：API 与页面不暴露数据库细节
// ---------------------------------------------------------------------------

test('分析会话 API 与页面不暴露数据库细节到组件', async () => {
  for (const filePath of consumerFiles) {
    const source = await readRepoFile(filePath);

    assert.doesNotMatch(
      source,
      /drizzle|pg\.|Pool/,
      `${filePath} 不应直接引用 drizzle 或 pg 驱动`,
    );
  }
});

test('分析会话消费者不使用浏览器客户端存储', async () => {
  for (const filePath of consumerFiles) {
    const source = await readRepoFile(filePath);

    assert.doesNotMatch(
      source,
      /localStorage|sessionStorage|indexedDB/i,
      `${filePath} 不应引用浏览器客户端存储`,
    );
  }
});

// ---------------------------------------------------------------------------
// 4. 契约测试：AnalysisSessionStore port 接口未被修改
// ---------------------------------------------------------------------------

test('AnalysisSessionStore port 接口保持稳定', async () => {
  const ports = await readRepoFile('src/application/analysis-session/ports.ts');

  assert.match(ports, /interface AnalysisSessionStore/);
  assert.match(ports, /create\(session: AnalysisSession\): Promise<AnalysisSession>/);
  assert.match(ports, /getById\(sessionId: string\): Promise<AnalysisSession \| null>/);
  assert.match(ports, /listByOwner\(ownerUserId: string\): Promise<AnalysisSession\[\]>/);
});

// ---------------------------------------------------------------------------
// 5. 契约测试：use-cases 层保持稳定（用户隔离由 getOwnedSession 保证）
// ---------------------------------------------------------------------------

test('use-cases 层用户隔离逻辑保持稳定', async () => {
  const useCases = await readRepoFile(
    'src/application/analysis-session/use-cases.ts',
  );

  assert.match(useCases, /getOwnedSession/);
  assert.match(
    useCases,
    /ownerUserId/,
    '用户隔离通过 ownerUserId 比较实现',
  );
  assert.match(
    useCases,
    /session\.ownerUserId !== ownerUserId/,
    '跨用户访问时返回 null',
  );
});

// ---------------------------------------------------------------------------
// 6. 契约测试：memory-analysis-session-store 保留但不再被引用
// ---------------------------------------------------------------------------

test('memory-analysis-session-store.ts 保留存在但消费者不再引用', async () => {
  await access(
    path.join(
      repoRoot,
      'src/infrastructure/analysis-session/memory-analysis-session-store.ts',
    ),
  );

  for (const filePath of consumerFiles) {
    const source = await readRepoFile(filePath);
    assert.doesNotMatch(source, /memory-analysis-session-store/);
  }
});
