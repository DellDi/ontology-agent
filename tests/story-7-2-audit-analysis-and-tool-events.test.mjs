import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { promisify } from 'node:util';

import { ensureNextBuildReady } from './helpers/ensure-next-build-ready.mjs';

const execFileAsync = promisify(execFile);

let port;
let baseUrl;
let serverProcess;
const TEST_SESSION_SECRET = 'story-7-2-test-secret';
const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://ontology_agent:ontology_agent_dev_password@127.0.0.1:55432/ontology_agent';
const TEST_REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
const TEST_REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? 'dip3';

async function getAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('无法获取可用端口。')));
        return;
      }

      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(address.port);
      });
    });

    server.on('error', reject);
  });
}

async function waitForServerReady(processHandle) {
  const start = Date.now();

  while (Date.now() - start < 30_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Next server exited early with code ${processHandle.exitCode}.`,
      );
    }

    try {
      const response = await fetch(`${baseUrl}/`, {
        redirect: 'manual',
      });

      if (response.status > 0) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw new Error('Next server did not become ready in time.');
}

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    'node',
    ['--import', 'tsx', '--input-type=module', '-e', code],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
        SESSION_SECRET: TEST_SESSION_SECRET,
      },
    },
  );

  return JSON.parse(stdout.trim());
}

async function login({
  employeeId,
  displayName,
  organizationId,
  projectIds = ['project-audit'],
  areaIds = ['area-audit'],
  roleCodes = ['PROPERTY_ANALYST'],
}) {
  const result = await runTsSnippet(`
    import sessionStoreModule from './src/infrastructure/session/postgres-session-store.ts';
    import sessionCookieModule from './src/infrastructure/session/session-cookie.ts';

    const { createPostgresSessionStore } = sessionStoreModule;
    const {
      createSessionCookieValue,
      getSessionCookieName,
    } = sessionCookieModule;

    const sessionStore = createPostgresSessionStore();
    const session = await sessionStore.createSession({
      userId: ${JSON.stringify(employeeId)},
      displayName: ${JSON.stringify(displayName)},
      scope: {
        organizationId: ${JSON.stringify(organizationId)},
        projectIds: ${JSON.stringify(projectIds)},
        areaIds: ${JSON.stringify(areaIds)},
        roleCodes: ${JSON.stringify(roleCodes)},
      },
    });

    console.log(JSON.stringify({
      cookie: \`\${getSessionCookieName()}=\${createSessionCookieValue(session.sessionId)}\`,
    }));
  `);

  return result.cookie;
}

async function createAnalysisSession(cookie, questionText) {
  const formData = new FormData();
  formData.set('question', questionText);

  const response = await fetch(`${baseUrl}/api/analysis/sessions`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
    },
    body: formData,
    redirect: 'manual',
  });

  assert.equal(response.status, 303);
  const location = response.headers.get('location') ?? '';
  assert.match(location, /\/workspace\/analysis\/[a-z0-9-]+$/);

  return location.split('/').pop();
}

async function readAuditTableMetadata() {
  return await runTsSnippet(`
    import pg from 'pg';

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
      const registration = await pool.query(
        "select to_regclass('platform.audit_events') as name",
      );
      const columns = await pool.query(\`
        select column_name
        from information_schema.columns
        where table_schema = 'platform'
          and table_name = 'audit_events'
        order by ordinal_position
      \`);

      console.log(
        JSON.stringify({
          name: registration.rows[0]?.name ?? null,
          columns: columns.rows.map((row) => row.column_name),
        }),
      );
    } finally {
      await pool.end();
    }
  `);
}

async function findAuditEvents(filters = {}) {
  return await runTsSnippet(`
    import pg from 'pg';

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const filters = ${JSON.stringify(filters)};

    try {
      const clauses = [];
      const values = [];

      if (filters.userId) {
        values.push(filters.userId);
        clauses.push(\`user_id = $\${values.length}\`);
      }

      if (filters.sessionId) {
        values.push(filters.sessionId);
        clauses.push(\`session_id = $\${values.length}\`);
      }

      if (filters.eventType) {
        values.push(filters.eventType);
        clauses.push(\`event_type = $\${values.length}\`);
      }

      if (filters.eventResult) {
        values.push(filters.eventResult);
        clauses.push(\`event_result = $\${values.length}\`);
      }

      const whereClause = clauses.length > 0 ? \`where \${clauses.join(' and ')}\` : '';
      const result = await pool.query(
        \`
          select
            id,
            user_id as "userId",
            organization_id as "organizationId",
            session_id as "sessionId",
            event_type as "eventType",
            event_result as "eventResult",
            event_source as "eventSource",
            correlation_id as "correlationId",
            payload,
            created_at as "createdAt",
            retention_until as "retentionUntil"
          from platform.audit_events
          \${whereClause}
          order by created_at desc
          limit 20
        \`,
        values,
      );

      console.log(JSON.stringify(result.rows));
    } finally {
      await pool.end();
    }
  `);
}

test.before(async () => {
  port = await getAvailablePort();
  baseUrl = `http://127.0.0.1:${port}`;

  await execFileAsync('pnpm', ['db:migrate'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL,
    },
  });

  await ensureNextBuildReady({
    cwd: process.cwd(),
    env: {
      ...process.env,
      SESSION_SECRET: TEST_SESSION_SECRET,
      DATABASE_URL: TEST_DATABASE_URL,
      REDIS_URL: TEST_REDIS_URL,
      REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
      ENABLE_DEV_ERP_AUTH: '1',
    },
  });

  serverProcess = spawn(
    'pnpm',
    ['exec', 'next', 'start', '--port', String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SESSION_SECRET: TEST_SESSION_SECRET,
        DATABASE_URL: TEST_DATABASE_URL,
        REDIS_URL: TEST_REDIS_URL,
        REDIS_KEY_PREFIX: TEST_REDIS_KEY_PREFIX,
        ENABLE_DEV_ERP_AUTH: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  await waitForServerReady(serverProcess);
});

test.after(async () => {
  if (!serverProcess) {
    return;
  }

  serverProcess.kill('SIGINT');
  await once(serverProcess, 'exit');
});

test('Story 7.2 在 platform schema 中建立独立 audit_events 表与保留字段', async () => {
  const metadata = await readAuditTableMetadata();

  assert.equal(metadata.name, 'platform.audit_events');
  for (const requiredColumn of [
    'user_id',
    'organization_id',
    'session_id',
    'event_type',
    'event_result',
    'event_source',
    'correlation_id',
    'payload',
    'created_at',
    'retention_until',
  ]) {
    assert.ok(
      metadata.columns.includes(requiredColumn),
      `缺少审计字段 ${requiredColumn}`,
    );
  }
});

test('成功发起分析请求会写入脱敏的审计记录', async () => {
  const cookie = await login({
    employeeId: 'audit-request-user',
    displayName: '审计请求用户',
    organizationId: 'org-audit-request',
  });
  const sessionId = await createAnalysisSession(
    cookie,
    '为什么本月项目 audit-one 的收费回款率下降了？',
  );

  const events = await findAuditEvents({
    userId: 'audit-request-user',
    sessionId,
    eventType: 'analysis.requested',
  });

  assert.ok(events.length > 0, '应写入 analysis.requested 审计事件');
  assert.equal(events[0].eventResult, 'succeeded');
  assert.equal(events[0].organizationId, 'org-audit-request');
  assert.equal(events[0].payload.route, '/api/analysis/sessions');
  assert.equal(events[0].payload.questionLength > 0, true);
  assert.equal(
    Object.hasOwn(events[0].payload, 'questionText'),
    false,
    '审计 payload 不应保存原始问题文本',
  );
});

test('权限失败会写入 authorization.denied 审计记录', async () => {
  const ownerCookie = await login({
    employeeId: 'audit-owner',
    displayName: '审计拥有者',
    organizationId: 'org-audit-owner',
  });
  const intruderCookie = await login({
    employeeId: 'audit-intruder',
    displayName: '审计闯入者',
    organizationId: 'org-audit-intruder',
  });
  const sessionId = await createAnalysisSession(
    ownerCookie,
    '为什么项目 intruded 的满意度下降了？',
  );

  const response = await fetch(
    `${baseUrl}/api/analysis/sessions/${sessionId}/execute`,
    {
      method: 'POST',
      headers: {
        Cookie: intruderCookie,
      },
      redirect: 'manual',
    },
  );

  assert.equal(response.status, 404);

  const events = await findAuditEvents({
    userId: 'audit-intruder',
    sessionId,
    eventType: 'authorization.denied',
    eventResult: 'denied',
  });

  assert.ok(events.length > 0, '应写入 authorization.denied 审计事件');
  assert.match(events[0].payload.route, /\/api\/analysis\/sessions\/.+\/execute$/);
  assert.equal(events[0].payload.reason, 'session-not-accessible');
});

test('关键工具调用会写入脱敏审计记录，不保留敏感输入', async () => {
  const result = await runTsSnippet(`
    import { z } from 'zod';
    import auditUseCasesModule from './src/application/audit/use-cases.ts';
    import auditStoreModule from './src/infrastructure/audit/postgres-audit-event-store.ts';
    import toolingUseCasesModule from './src/application/tooling/use-cases.ts';
    import pg from 'pg';

    const { createAuditUseCases } = auditUseCasesModule;
    const { createPostgresAuditEventStore } = auditStoreModule;
    const { createAnalysisToolRegistryUseCases } = toolingUseCasesModule;

    const auditUseCases = createAuditUseCases({
      auditEventStore: createPostgresAuditEventStore(),
    });

        const registry = createAnalysisToolRegistryUseCases({
          auditRecorder: {
            async recordToolInvocation(input) {
              await auditUseCases.recordEvent({
                userId: input.userId,
                organizationId: input.organizationId,
                sessionId: input.sessionId,
                eventType: 'tool.invoked',
                eventResult: input.result,
                eventSource:
                  input.source === 'worker' ? 'worker' : 'application',
                correlationId: input.correlationId,
                payload: {
                  toolName: input.toolName,
                  startedAt: input.startedAt,
                  finishedAt: input.finishedAt,
                  errorCode: input.errorCode,
                  errorMessage: input.errorMessage,
                  source: input.source,
                },
              });
            },
          },
      tools: [
        {
          definition: {
            name: 'cube.semantic-query',
            title: 'Cube 审计测试工具',
            description: '用于验证关键工具调用审计。',
            runtime: 'shared',
            availability: 'ready',
            inputSchemaLabel: 'input',
            outputSchemaLabel: 'output',
          },
          inputSchema: z.object({
            password: z.string(),
            metric: z.string(),
          }),
          outputSchema: z.object({
            ok: z.boolean(),
          }),
          async invoke() {
            return { ok: true };
          },
        },
      ],
    });

    await registry.invokeTool({
      toolName: 'cube.semantic-query',
      input: {
        password: 'SuperSecret#1',
        metric: 'collection-rate',
      },
      context: {
        correlationId: 'audit-tool-correlation',
        source: 'application',
        sessionId: 'audit-tool-session',
        userId: 'audit-tool-user',
        organizationId: 'org-audit-tool',
      },
    });

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
      const result = await pool.query(
        \`
          select
            event_type as "eventType",
            event_result as "eventResult",
            payload
          from platform.audit_events
          where correlation_id = 'audit-tool-correlation'
          order by created_at desc
          limit 1
        \`,
      );

      console.log(JSON.stringify(result.rows[0] ?? null));
    } finally {
      await pool.end();
    }
  `);

  assert.equal(result.eventType, 'tool.invoked');
  assert.equal(result.eventResult, 'succeeded');
  assert.equal(result.payload.toolName, 'cube.semantic-query');
  assert.equal(
    Object.hasOwn(result.payload, 'input'),
    false,
    '工具审计不应持久化原始输入',
  );
});

test('普通业务用户不能直接查看全量审计，平台管理员可以读取最近记录', async () => {
  const normalCookie = await login({
    employeeId: 'audit-normal-user',
    displayName: '普通审计用户',
    organizationId: 'org-audit-normal',
    roleCodes: ['PROPERTY_ANALYST'],
  });
  const adminCookie = await login({
    employeeId: 'audit-admin-user',
    displayName: '平台审计管理员',
    organizationId: 'org-audit-admin',
    roleCodes: ['PLATFORM_ADMIN'],
  });

  await createAnalysisSession(
    adminCookie,
    '为什么项目 admin-audit 的收费率下降了？',
  );

  const deniedResponse = await fetch(`${baseUrl}/api/admin/audit/events`, {
    headers: {
      Cookie: normalCookie,
    },
  });

  assert.equal(deniedResponse.status, 403);

  const allowedResponse = await fetch(
    `${baseUrl}/api/admin/audit/events?limit=5`,
    {
      headers: {
        Cookie: adminCookie,
      },
    },
  );

  assert.equal(allowedResponse.status, 200);
  const payload = await allowedResponse.json();

  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length > 0, '管理员应能读取最近审计记录');
});
