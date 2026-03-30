import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

async function readRepoFile(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

const requiredPaths = [
  'drizzle.config.ts',
  'src/infrastructure/postgres/client.ts',
  'src/infrastructure/postgres/schema/auth-sessions.ts',
  'src/infrastructure/postgres/schema/analysis-sessions.ts',
  'src/infrastructure/postgres/schema/index.ts',
];

for (const relativePath of requiredPaths) {
  test(`Story 2.2 工件存在：${relativePath}`, async () => {
    await access(path.join(repoRoot, relativePath));
  });
}

test('package.json 固定 Drizzle / Postgres 依赖与迁移命令', async () => {
  const packageJson = JSON.parse(
    await readRepoFile('package.json'),
  );

  assert.equal(packageJson.dependencies['drizzle-orm'], '0.45.1');
  assert.equal(packageJson.dependencies.pg, '8.20.0');
  assert.equal(packageJson.devDependencies['drizzle-kit'], '0.31.10');
  assert.equal(packageJson.scripts['db:generate'], 'drizzle-kit generate --config=drizzle.config.ts');
  assert.equal(packageJson.scripts['db:migrate'], 'drizzle-kit migrate --config=drizzle.config.ts');
});

test('drizzle.config.ts 复用 DATABASE_URL、@next/env 与稳定 migration 目录', async () => {
  const drizzleConfig = await readRepoFile('drizzle.config.ts');

  assert.match(drizzleConfig, /loadEnvConfig\(process\.cwd\(\)\)/);
  assert.match(drizzleConfig, /from '@next\/env'/);
  assert.match(drizzleConfig, /dialect:\s*'postgresql'/);
  assert.match(drizzleConfig, /schema:\s*'.\/src\/infrastructure\/postgres\/schema\/index\.ts'/);
  assert.match(drizzleConfig, /out:\s*'.\/drizzle'/);
  assert.match(drizzleConfig, /DATABASE_URL/);
});

test('platform schema 只定义最小 auth_sessions 与 analysis_sessions 表', async () => {
  const authSchema = await readRepoFile(
    'src/infrastructure/postgres/schema/auth-sessions.ts',
  );
  const analysisSchema = await readRepoFile(
    'src/infrastructure/postgres/schema/analysis-sessions.ts',
  );
  const schemaIndex = await readRepoFile(
    'src/infrastructure/postgres/schema/index.ts',
  );

  assert.match(authSchema, /pgSchema\('platform'\)/);
  assert.match(authSchema, /auth_sessions/);
  assert.match(authSchema, /session_id/);
  assert.match(authSchema, /user_id/);
  assert.match(authSchema, /display_name/);
  assert.match(authSchema, /organization_id/);
  assert.match(authSchema, /project_ids/);
  assert.match(authSchema, /area_ids/);
  assert.match(authSchema, /role_codes/);
  assert.match(authSchema, /expires_at/);

  assert.match(analysisSchema, /analysis_sessions/);
  assert.match(analysisSchema, /owner_user_id/);
  assert.match(analysisSchema, /organization_id/);
  assert.match(analysisSchema, /project_ids/);
  assert.match(analysisSchema, /area_ids/);
  assert.match(analysisSchema, /question_text/);
  assert.match(analysisSchema, /status/);
  assert.match(analysisSchema, /saved_context/);
  assert.match(analysisSchema, /created_at/);
  assert.match(analysisSchema, /updated_at/);

  assert.match(schemaIndex, /authSessions/);
  assert.match(schemaIndex, /analysisSessions/);

  for (const forbidden of ['audit', 'result', 'worker', 'neo4j', 'cube']) {
    assert.doesNotMatch(authSchema, new RegExp(forbidden, 'i'));
    assert.doesNotMatch(analysisSchema, new RegExp(forbidden, 'i'));
  }
});

test('数据库客户端入口使用 drizzle-orm/node-postgres 且不替换 memory store', async () => {
  const client = await readRepoFile('src/infrastructure/postgres/client.ts');
  const memorySessionStore = await readRepoFile(
    'src/infrastructure/session/memory-session-store.ts',
  );
  const memoryAnalysisStore = await readRepoFile(
    'src/infrastructure/analysis-session/memory-analysis-session-store.ts',
  );

  assert.match(client, /from 'drizzle-orm\/node-postgres'/);
  assert.match(client, /from 'pg'/);
  assert.match(client, /createPostgresDb/);
  assert.match(
    client,
    /globalThis|singleton|cached/i,
    '数据库客户端应包含单例或缓存逻辑，避免每个 consumer 新建 Pool',
  );

  assert.match(memorySessionStore, /createMemorySessionStore/);
  assert.match(memoryAnalysisStore, /createMemoryAnalysisSessionStore/);
});

test('生成的 migration 目录存在且不包含超范围未来表', async () => {
  await access(path.join(repoRoot, 'drizzle'));
  await access(path.join(repoRoot, 'drizzle', 'meta'));

  const metaJournal = await readRepoFile('drizzle/meta/_journal.json');
  assert.match(metaJournal, /entries/);

  const migrationFiles = JSON.parse(
    await readRepoFile('drizzle/meta/_journal.json'),
  ).entries;

  assert.ok(
    migrationFiles.length >= 1,
    '至少应存在首个 migration 记录',
  );
});
