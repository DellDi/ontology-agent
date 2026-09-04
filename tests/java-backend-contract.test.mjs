import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import javaBackendModule from '../src/infrastructure/java-backend/client.ts';
import javaBackendReadModule from '../src/infrastructure/java-backend/read-client.ts';
import javaFollowUpViewModel from '../src/app/(workspace)/workspace/analysis/[sessionId]/java-follow-up-view-model.ts';

const { forwardJavaBackendRequest } = javaBackendModule;
const {
  javaAnalysisFollowUpSchema,
  javaAnalysisSessionSchema,
  javaExecutionSnapshotSchema,
  javaViewerSchema,
  javaWorkspaceHomeSchema,
} = javaBackendReadModule;
const { rootContextFromJava } = javaFollowUpViewModel;

const root = new URL('../', import.meta.url);
const schemaNames = [
  'analysis-follow-up.schema.json',
  'analysis-session-aggregate.schema.json',
  'conclusion-state.schema.json',
  'error.schema.json',
  'execution-event.schema.json',
  'execution-snapshot.schema.json',
  'graph-sync-shared.schema.json',
  'viewer.schema.json',
  'workspace-home.schema.json',
];

async function fixture(path) {
  return readFile(new URL(`contracts/backend/fixtures/${path}`, root), 'utf8');
}

async function jsonFixture(path) {
  return JSON.parse(await fixture(path));
}

async function contractValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const name of schemaNames) {
    const schema = JSON.parse(await readFile(
      new URL(`contracts/backend/schemas/${name}`, root),
      'utf8',
    ));
    assert.equal(
      ajv.validateSchema(schema),
      true,
      `${name} 不是有效的 Draft 2020-12 JSON Schema: ${ajv.errorsText()}`,
    );
    ajv.addSchema(schema);
  }
  return ajv;
}

function assertJsonSchema(ajv, schemaName, value, fixtureName) {
  const validate = ajv.getSchema(schemaName);
  assert.ok(validate, `未加载 JSON Schema: ${schemaName}`);
  assert.equal(
    validate(value),
    true,
    `${fixtureName} 不符合 ${schemaName}: ${ajv.errorsText(validate.errors)}`,
  );
}

function assertZod(schema, value, fixtureName) {
  const result = schema.safeParse(value);
  assert.equal(
    result.success,
    true,
    `${fixtureName} 不符合 Next Zod 读取契约: ${result.success ? '' : result.error.message}`,
  );
}

test('Draft 2020-12 JSON Schema 与 Next Zod 共同校验 Java 后端 fixtures', async () => {
  const ajv = await contractValidator();

  const frames = (await fixture('sse-completed.txt'))
    .trim()
    .split('\n\n')
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')));
  frames.forEach((event) => assertJsonSchema(
    ajv,
    'execution-event.schema.json',
    event,
    `sse-completed.txt sequence=${event.sequence}`,
  ));
  assert.deepEqual(frames.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(frames[1].metadata.toolName, 'erp.read-model');
  assert.equal(frames.at(-1).status, 'completed');
  assert.deepEqual(
    frames.at(-1).renderBlocks.filter((block) => block.type === 'table').map((block) => block.title),
    ['ERP 范围内收费事实', 'Cube 受治理语义指标', '受范围约束的收费项目结构关系'],
  );

  const snapshot = await jsonFixture('snapshot-completed.json');
  assertJsonSchema(ajv, 'execution-snapshot.schema.json', snapshot, 'snapshot-completed.json');
  assert.equal(snapshot.ontologyVersionBinding.source, 'grounded-context');
  assert.equal(snapshot.planSnapshot._executionContract, 'java-initial-v1');
  assert.deepEqual(snapshot.stepResults.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(snapshot.failurePoint, null);
  assert.equal(snapshot.conclusionState.causes[0].title, '综合证据结论');
  assert.equal(snapshot.conclusionState.claims.length, 3);
  assert.equal(snapshot.conclusionState.causes[0].confidence, null);
  assert.deepEqual(
    snapshot.conclusionState.evidence.map((item) => item.source),
    ['erp-staging', 'cube', 'neo4j'],
  );
  assert.equal(snapshot.conclusionState.renderBlocks.filter((block) => block.type === 'table').length, 3);
  assert.equal(snapshot.mobileProjection.status, 'completed');

  const followUp = await jsonFixture('analysis-follow-up.json');
  assertJsonSchema(ajv, 'analysis-follow-up.schema.json', followUp, 'analysis-follow-up.json');
  assertZod(javaAnalysisFollowUpSchema, followUp, 'analysis-follow-up.json');
  assert.equal(followUp.currentPlanSnapshot._executionContract, 'java-follow-up-v1');
  assert.equal(followUp.ontologyVersionBinding.ontologyVersionId, followUp.ontologyVersionId);
  const legacyCompletedFollowUp = structuredClone(followUp);
  legacyCompletedFollowUp.capabilityBinding = { source: 'legacy/unknown' };
  assert.equal(
    ajv.getSchema('analysis-follow-up.schema.json')(legacyCompletedFollowUp),
    false,
    '已有结果的追问不得退化为 legacy/unknown 能力绑定',
  );
  assert.equal(
    javaAnalysisFollowUpSchema.safeParse(legacyCompletedFollowUp).success,
    false,
    'Next 读取契约必须同样拒绝已有结果的 legacy/unknown 追问',
  );

  const error = await jsonFixture('provider-error.json');
  assertJsonSchema(ajv, 'error.schema.json', error, 'provider-error.json');
  assert.deepEqual(Object.keys(error).sort(), ['code', 'error', 'traceId']);

  const graphSync = await jsonFixture('graph-sync-status.json');
  assertJsonSchema(ajv, 'graph-sync-shared.schema.json#/$defs/status', graphSync, 'graph-sync-status.json');
  assert.equal(graphSync.latestRun.scopeKey, 'org-1');
  assert.deepEqual(graphSync.cursors, []);

  const graphBootstrap = await jsonFixture('graph-sync-bootstrap-completed.json');
  assertJsonSchema(ajv, 'graph-sync-shared.schema.json#/$defs/run', graphBootstrap, 'graph-sync-bootstrap-completed.json');
  assert.equal(graphBootstrap.mode, 'full-bootstrap');
  assert.equal(Object.keys(graphBootstrap.cursorSnapshot.watermarks).length, 7);
  const unfencedBootstrap = structuredClone(graphBootstrap);
  delete unfencedBootstrap.cursorSnapshot.fencingToken;
  assert.equal(
    ajv.getSchema('graph-sync-shared.schema.json#/$defs/run')(unfencedBootstrap),
    false,
    'full-bootstrap contract 必须拒绝缺少 fencing token 的 parent run',
  );

  const viewer = await jsonFixture('auth-me.json');
  assertJsonSchema(ajv, 'viewer.schema.json', viewer, 'auth-me.json');
  assertZod(javaViewerSchema, viewer, 'auth-me.json');
  assert.deepEqual(Object.keys(viewer).sort(), ['displayName', 'scope', 'userId', 'workspaceAccess']);
  assert.equal(viewer.scope.organizationId, 'org-1');
  assert.equal(viewer.workspaceAccess, true);

  const home = await jsonFixture('workspace-home.json');
  assertJsonSchema(ajv, 'workspace-home.schema.json', home, 'workspace-home.json');
  assertZod(javaWorkspaceHomeSchema, home, 'workspace-home.json');
  assert.equal(home.viewer.userId, 'user-1');
  assert.equal(home.viewer.workspaceAccess, true);
  assert.equal(home.sessions[0].savedContext._executionContract, 'java-initial-v1');
  assert.equal(home.sessions[0].latestExecution.executionId, 'execution-1');
  assert.equal(home.projects[0].id, 'project-1');

  const aggregate = await jsonFixture('analysis-session-completed.json');
  assertJsonSchema(
    ajv,
    'analysis-session-aggregate.schema.json',
    aggregate,
    'analysis-session-completed.json',
  );
  assertZod(javaAnalysisSessionSchema, aggregate, 'analysis-session-completed.json');
  assert.equal(aggregate.job.executionId, 'execution-1');
  assert.deepEqual(aggregate.followUps, []);
  assert.deepEqual(aggregate.history.map((round) => round.kind), ['initial']);
  assert.equal(aggregate.session.savedContext._executionContract, 'java-initial-v1');
  assert.deepEqual(aggregate.events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(aggregate.snapshot.stepResults, aggregate.events);
  assert.equal(aggregate.snapshot.ontologyVersionBindingSource, 'grounded-context');
  assert.equal(aggregate.snapshot.conclusionState.causes.length, 1);
  assert.equal(aggregate.snapshot.conclusionState.causes[0].confidence, null);
  assert.equal(aggregate.snapshot.conclusionState.renderBlocks.length, 5);
  assert.deepEqual(
    aggregate.snapshot.conclusionState.evidence.map((item) => item.source),
    ['erp-staging', 'cube', 'neo4j'],
  );
  assert.deepEqual(aggregate.runtime, {
    requestedExecutionId: 'execution-1',
    resolvedExecutionId: 'execution-1',
    status: 'completed',
    autoExecute: false,
    streamEnabled: false,
    terminal: true,
    resumeAfterSequence: 3,
  });

  const invalidSnapshot = structuredClone(snapshot);
  delete invalidSnapshot.planSnapshot._executionContract;
  assert.equal(
    ajv.getSchema('execution-snapshot.schema.json')(invalidSnapshot),
    false,
    '契约门禁必须拒绝缺少 java-initial-v1 标识的 snapshot',
  );

  const versionlessCompletedSnapshot = structuredClone(aggregate.snapshot);
  versionlessCompletedSnapshot.ontologyVersionId = null;
  assert.equal(
    javaExecutionSnapshotSchema.safeParse(versionlessCompletedSnapshot).success,
    false,
    '完成态不得放行缺少 ontologyVersionId 的具体能力绑定',
  );

  const legacyCompletedSnapshot = structuredClone(aggregate.snapshot);
  legacyCompletedSnapshot.capabilityBinding = { source: 'legacy/unknown' };
  const legacyCompletedResult = javaExecutionSnapshotSchema.safeParse(legacyCompletedSnapshot);
  assert.equal(legacyCompletedResult.success, false, '完成态不得使用 legacy/unknown 能力绑定');
  assert.equal(
    legacyCompletedResult.error?.issues.filter((issue) => issue.path[0] === 'capabilityBinding').length,
    1,
    'legacy 完成态只报告一个明确的能力绑定错误',
  );

  const followUpSnapshot = structuredClone(snapshot);
  followUpSnapshot.executionId = 'execution-2';
  followUpSnapshot.followUpId = 'follow-up-1';
  followUpSnapshot.planSnapshot = structuredClone(followUp.currentPlanSnapshot);
  assert.equal(
    ajv.getSchema('execution-snapshot.schema.json')(followUpSnapshot),
    true,
    `契约必须接受 java-follow-up-v1 snapshot: ${ajv.errorsText()}`,
  );

  const crossedRootSnapshot = structuredClone(snapshot);
  crossedRootSnapshot.planSnapshot._executionContract = 'java-follow-up-v1';
  assert.equal(
    ajv.getSchema('execution-snapshot.schema.json')(crossedRootSnapshot),
    false,
    '根轮次不得伪装为 java-follow-up-v1',
  );

  const crossedFollowUpSnapshot = structuredClone(followUpSnapshot);
  crossedFollowUpSnapshot.planSnapshot._executionContract = 'java-initial-v1';
  assert.equal(
    ajv.getSchema('execution-snapshot.schema.json')(crossedFollowUpSnapshot),
    false,
    '追问轮次不得伪装为 java-initial-v1',
  );

  const failedRootSnapshot = structuredClone(snapshot);
  failedRootSnapshot.status = 'failed';
  failedRootSnapshot.planSnapshot = {
    mode: 'minimal',
    summary: '执行在完成计划前失败',
    steps: [],
    _executionContract: 'java-initial-v1',
    _resolvedContext: {},
  };
  failedRootSnapshot.conclusionState = { causes: [], renderBlocks: [] };
  failedRootSnapshot.resultBlocks = [];
  failedRootSnapshot.failurePoint = { id: 'execution', title: '首次分析' };
  failedRootSnapshot.errorCode = 'AGENT_PROVIDER_FAILURE';
  failedRootSnapshot.mobileProjection.status = 'failed';
  assert.equal(
    ajv.getSchema('execution-snapshot.schema.json')(failedRootSnapshot),
    true,
    `失败态必须保留可诊断的最小计划: ${ajv.errorsText()}`,
  );

  const failedSnapshotFixture = await jsonFixture('snapshot-failed.json');
  assertJsonSchema(
    ajv,
    'execution-snapshot.schema.json',
    failedSnapshotFixture,
    'snapshot-failed.json',
  );

  const failedAggregate = structuredClone(aggregate);
  failedAggregate.job.status = 'failed';
  failedAggregate.job.error = 'Main Agent 模型调用失败。';
  failedAggregate.job.failedAt = failedAggregate.job.updatedAt;
  failedAggregate.snapshot = { ...failedRootSnapshot };
  delete failedAggregate.snapshot.ownerUserId;
  delete failedAggregate.snapshot.ontologyVersionBinding;
  failedAggregate.snapshot.ontologyVersionBindingSource = 'grounded-context';
  failedAggregate.history[0].status = 'failed';
  failedAggregate.history[0].planSnapshot = structuredClone(failedRootSnapshot.planSnapshot);
  failedAggregate.runtime.status = 'failed';
  assertJsonSchema(ajv, 'analysis-session-aggregate.schema.json', failedAggregate, 'failed aggregate');
  assertZod(javaAnalysisSessionSchema, failedAggregate, 'failed aggregate');

  const incompleteCompletedSnapshot = structuredClone(snapshot);
  incompleteCompletedSnapshot.planSnapshot.steps = [];
  incompleteCompletedSnapshot.planSnapshot._resolvedContext = {};
  assert.equal(
    ajv.getSchema('execution-snapshot.schema.json')(incompleteCompletedSnapshot),
    false,
    '完成态不得接受失败态的最小计划',
  );

  const followUpAggregate = structuredClone(aggregate);
  followUpAggregate.followUps = [followUp];
  followUpAggregate.history.push({
    id: 'follow-up-1',
    kind: 'follow-up',
    questionText: followUp.questionText,
    followUpId: 'follow-up-1',
    executionId: 'execution-2',
    status: 'completed',
    ontologyVersionId: 'ontology-v1',
    ontologyVersionBindingSource: 'inherited',
    planSnapshot: { ...followUpSnapshot.planSnapshot },
    conclusionState: null,
    createdAt: followUp.createdAt,
  });
  followUpAggregate.job.executionId = 'execution-2';
  followUpAggregate.snapshot.executionId = 'execution-2';
  followUpAggregate.snapshot.followUpId = 'follow-up-1';
  followUpAggregate.snapshot.planSnapshot = structuredClone(followUp.currentPlanSnapshot);
  followUpAggregate.runtime.requestedExecutionId = 'execution-2';
  followUpAggregate.runtime.resolvedExecutionId = 'execution-2';
  assertJsonSchema(
    ajv,
    'analysis-session-aggregate.schema.json',
    followUpAggregate,
    'java-follow-up-v1 aggregate',
  );
  assertZod(javaAnalysisSessionSchema, followUpAggregate, 'java-follow-up-v1 aggregate');

  const danglingHistoryAggregate = structuredClone(followUpAggregate);
  danglingHistoryAggregate.history[1].followUpId = 'follow-up-missing';
  assert.equal(
    javaAnalysisSessionSchema.safeParse(danglingHistoryAggregate).success,
    false,
    'Next Zod 门禁必须拒绝指向聚合外 follow-up 的历史轮次',
  );

  const danglingFollowUpAggregate = structuredClone(followUpAggregate);
  danglingFollowUpAggregate.followUps = [];
  assert.equal(
    javaAnalysisSessionSchema.safeParse(danglingFollowUpAggregate).success,
    false,
    'Next Zod 门禁必须拒绝指向聚合外 follow-up 的 snapshot',
  );

  const mismatchedOntologyFollowUp = structuredClone(followUp);
  mismatchedOntologyFollowUp.ontologyVersionBinding.ontologyVersionId = 'ontology-v2';
  assert.equal(
    javaAnalysisFollowUpSchema.safeParse(mismatchedOntologyFollowUp).success,
    false,
    'Next Zod 门禁必须拒绝不一致的追问本体版本绑定',
  );

  const malformedContextFollowUp = structuredClone(followUp);
  delete malformedContextFollowUp.mergedContext.timeRange.state;
  assert.equal(
    ajv.getSchema('analysis-follow-up.schema.json')(malformedContextFollowUp),
    false,
    'JSON Schema 必须拒绝缺失字段状态的追问上下文',
  );
  assert.equal(javaAnalysisFollowUpSchema.safeParse(malformedContextFollowUp).success, false);

  const partialReplanFollowUp = structuredClone(followUp);
  partialReplanFollowUp.currentPlanDiff = null;
  assert.equal(
    ajv.getSchema('analysis-follow-up.schema.json')(partialReplanFollowUp),
    false,
    'JSON Schema 必须拒绝缺少 diff 的半成品重规划',
  );
  assert.equal(javaAnalysisFollowUpSchema.safeParse(partialReplanFollowUp).success, false);

  const crossBoundPlanFollowUp = structuredClone(followUp);
  crossBoundPlanFollowUp.currentPlanSnapshot._followUpId = 'follow-up-other';
  assert.equal(
    javaAnalysisFollowUpSchema.safeParse(crossBoundPlanFollowUp).success,
    false,
    'Next Zod 门禁必须拒绝绑定其他追问的计划',
  );

  const unknownAggregateField = structuredClone(aggregate);
  unknownAggregateField.compatibilityFallback = true;
  assert.equal(
    javaAnalysisSessionSchema.safeParse(unknownAggregateField).success,
    false,
    'Next Zod 门禁必须拒绝未发布的兼容字段',
  );

  const missingRoundAggregate = structuredClone(followUpAggregate);
  missingRoundAggregate.history.pop();
  assert.equal(
    javaAnalysisSessionSchema.safeParse(missingRoundAggregate).success,
    false,
    'Next Zod 门禁必须拒绝缺失追问历史轮次的聚合',
  );

  const invalidAggregate = structuredClone(aggregate);
  invalidAggregate.snapshot.conclusionState.causes[0].confidence = '0.8';
  assert.equal(
    ajv.getSchema('analysis-session-aggregate.schema.json')(invalidAggregate),
    false,
    '契约门禁必须拒绝伪造为字符串的 confidence',
  );

  for (const [schemaName, value, removeClaims] of [
    ['execution-snapshot.schema.json', snapshot, (copy) => delete copy.conclusionState.claims],
    ['analysis-session-aggregate.schema.json', aggregate, (copy) => delete copy.snapshot.conclusionState.claims],
    ['workspace-home.schema.json', home, (copy) => delete copy.sessions[0].latestExecution.conclusionState.claims],
  ]) {
    const withoutClaims = structuredClone(value);
    removeClaims(withoutClaims);
    assert.equal(
      ajv.getSchema(schemaName)(withoutClaims),
      false,
      `${schemaName} 必须拒绝完成态缺少逐条证据引用`,
    );
  }

  for (const [schemaName, value, conclusionState] of [
    ['execution-snapshot.schema.json', snapshot, (copy) => copy.conclusionState],
    ['analysis-session-aggregate.schema.json', aggregate, (copy) => copy.snapshot.conclusionState],
    ['workspace-home.schema.json', home, (copy) => copy.sessions[0].latestExecution.conclusionState],
  ]) {
    const cubeOnly = structuredClone(value);
    const state = conclusionState(cubeOnly);
    state.claims = state.claims.filter((claim) =>
      claim.evidenceRefs.some((reference) => reference.source === 'cube'));
    assert.equal(
      ajv.getSchema(schemaName)(cubeOnly),
      false,
      `${schemaName} 必须拒绝完成态缺少 ERP 或 Neo4j 的逐条证据引用`,
    );
  }

  const invalidHome = structuredClone(home);
  invalidHome.sessions[0].latestExecution.conclusionState.evidence = [];
  assert.equal(
    javaWorkspaceHomeSchema.safeParse(invalidHome).success,
    false,
    'Next Zod 门禁必须拒绝缺失 ERP/Cube/Neo4j 证据的完成态',
  );

  const openapi = await readFile(new URL('contracts/backend/openapi.yaml', root), 'utf8');
  for (const path of [
    '/api/auth/me:',
    '/api/workspace/home:',
    '/api/analysis/sessions/{sessionId}:',
    '/api/analysis/sessions/{sessionId}/follow-ups:',
    '/api/analysis/sessions/{sessionId}/follow-ups/{followUpId}:',
    '/api/analysis/sessions/{sessionId}/follow-ups/{followUpId}/context:',
    '/api/analysis/sessions/{sessionId}/follow-ups/{followUpId}/replan:',
  ]) {
    assert.match(openapi, new RegExp(`^  ${path.replace(/[{}]/g, '\\$&')}`, 'm'));
  }
});

test('首次完成态直接从 canonical plan 投影第一轮追问上下文', async () => {
  const aggregate = await jsonFixture('analysis-session-completed.json');
  assert.equal(aggregate.followUps.length, 0);
  assert.deepEqual(rootContextFromJava(aggregate), {
    targetMetric: { label: '目标指标', value: 'project-collection-rate', state: 'confirmed' },
    entity: { label: '实体对象', value: 'project-1', state: 'confirmed' },
    timeRange: { label: '时间范围', value: '2026-07-01/2026-07-31', state: 'confirmed' },
    comparison: { label: '比较方式', value: '无需比较', state: 'confirmed' },
    constraints: [
      { label: '实体 business key', value: 'project' },
      { label: '指标定义 business key', value: 'collection-rate' },
      { label: '指标口径 business key', value: 'project-collection-rate' },
      { label: '时间语义 business key', value: 'receivable-accounting-period' },
      { label: '项目 ID', value: 'project-1' },
    ],
  });
});

test('Next follow-up routes remain transparent Java adapters', async () => {
  for (const path of [
    'src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts',
    'src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/route.ts',
    'src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/context/route.ts',
    'src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/replan/route.ts',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /forwardJavaBackendRequest\(request\)/);
    assert.doesNotMatch(source, /createCompositionRoot|getRequestSession|NextResponse/);
  }

  const collection = await readFile(
    new URL('src/app/api/analysis/sessions/[sessionId]/follow-ups/route.ts', root),
    'utf8',
  );
  const detail = await readFile(
    new URL('src/app/api/analysis/sessions/[sessionId]/follow-ups/[followUpId]/route.ts', root),
    'utf8',
  );
  assert.match(collection, /export async function GET\(/);
  assert.match(collection, /export async function POST\(/);
  assert.match(detail, /export async function GET\(/);
});

test('Java page read adapter keeps executionId as the only round selector', async () => {
  const source = await readFile(
    new URL('src/infrastructure/java-backend/read-client.ts', root),
    'utf8',
  );
  assert.doesNotMatch(source, /query\.set\('followUpId'/);
  assert.doesNotMatch(source, /\/follow-ups\/\$\{[^}]+\}\/execute/);
});

test('Next adapter preserves Cookie, body, idempotency, correlation, 303 and SSE bytes', async (context) => {
  const seen = [];
  const sse = await fixture('sse-completed.txt');
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    seen.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(body).toString('utf8'),
    });
    response.setHeader('x-correlation-id', 'trace-contract-1');
    if (request.method === 'POST') {
      response.statusCode = 303;
      const location = request.url.endsWith('/replan')
        ? '/workspace/analysis/session-1?followUpId=follow-up-1&followUpReplanned=true'
        : request.url.endsWith('/context')
          ? '/workspace/analysis/session-1?followUpId=follow-up-1&followUpContextUpdated=true'
          : request.url.endsWith('/follow-ups')
            ? '/workspace/analysis/session-1?followUpId=follow-up-1'
            : '/workspace/analysis/session-1?executionId=execution-1';
      response.setHeader('Location', location);
      response.end();
      return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('X-Accel-Buffering', 'no');
    response.end(sse);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.JAVA_BACKEND_URL = `http://127.0.0.1:${address.port}`;

  const execute = await forwardJavaBackendRequest(new Request(
    'http://next.local/api/analysis/sessions/session-1/execute',
    {
      method: 'POST',
      headers: {
        Cookie: 'theme=dark; dip3_session=signed-cookie; admin_token=must-not-cross',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': 'idem-1',
        'x-correlation-id': 'trace-contract-1',
      },
      body: 'followUpId=',
    },
  ));
  assert.equal(execute.status, 303);
  assert.equal(execute.headers.get('location'), '/workspace/analysis/session-1?executionId=execution-1');
  assert.equal(seen[0].headers.cookie, 'dip3_session=signed-cookie');
  assert.equal(seen[0].headers['idempotency-key'], 'idem-1');
  assert.equal(seen[0].headers['x-correlation-id'], 'trace-contract-1');
  assert.equal(seen[0].body, 'followUpId=');

  const followUpCreate = await forwardJavaBackendRequest(new Request(
    'http://next.local/api/analysis/sessions/session-1/follow-ups',
    {
      method: 'POST',
      headers: {
        Cookie: 'dip3_session=signed-cookie; analytics=must-not-cross',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-correlation-id': 'trace-contract-1',
      },
      body: 'question=%E6%94%B6%E7%AA%84%E8%8C%83%E5%9B%B4&parentFollowUpId=',
    },
  ));
  assert.equal(followUpCreate.status, 303);
  assert.equal(followUpCreate.headers.get('location'), '/workspace/analysis/session-1?followUpId=follow-up-1');
  assert.equal(seen[1].url, '/api/analysis/sessions/session-1/follow-ups');
  assert.equal(seen[1].headers.cookie, 'dip3_session=signed-cookie');
  assert.equal(seen[1].headers['x-correlation-id'], 'trace-contract-1');
  assert.equal(seen[1].body, 'question=%E6%94%B6%E7%AA%84%E8%8C%83%E5%9B%B4&parentFollowUpId=');

  const followUpContext = await forwardJavaBackendRequest(new Request(
    'http://next.local/api/analysis/sessions/session-1/follow-ups/follow-up-1/context',
    {
      method: 'POST',
      headers: {
        Cookie: 'dip3_session=signed-cookie',
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-correlation-id': 'trace-contract-1',
      },
      body: 'entity=%E9%A1%B9%E7%9B%AE%E4%B8%80&confirmConflicts=true',
    },
  ));
  assert.equal(followUpContext.status, 303);
  assert.equal(followUpContext.headers.get('location'), '/workspace/analysis/session-1?followUpId=follow-up-1&followUpContextUpdated=true');
  assert.equal(seen[2].url, '/api/analysis/sessions/session-1/follow-ups/follow-up-1/context');
  assert.equal(seen[2].body, 'entity=%E9%A1%B9%E7%9B%AE%E4%B8%80&confirmConflicts=true');

  const replan = await forwardJavaBackendRequest(new Request(
    'http://next.local/api/analysis/sessions/session-1/follow-ups/follow-up-1/replan',
    {
      method: 'POST',
      headers: {
        Cookie: 'dip3_session=signed-cookie',
        'x-correlation-id': 'trace-contract-1',
      },
    },
  ));
  assert.equal(replan.status, 303);
  assert.equal(replan.headers.get('location'), '/workspace/analysis/session-1?followUpId=follow-up-1&followUpReplanned=true');
  assert.equal(seen[3].url, '/api/analysis/sessions/session-1/follow-ups/follow-up-1/replan');

  const stream = await forwardJavaBackendRequest(new Request(
    'http://next.local/api/analysis/sessions/session-1/stream?executionId=execution-1&afterSequence=1',
    { headers: { Cookie: 'dip3_session=signed-cookie', 'x-correlation-id': 'trace-contract-1' } },
  ));
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(stream.headers.get('x-accel-buffering'), 'no');
  assert.equal(await stream.text(), sse);
  assert.equal(seen[4].url, '/api/analysis/sessions/session-1/stream?executionId=execution-1&afterSequence=1');
});

test('Next adapter fails explicitly when JAVA_BACKEND_URL is absent', async () => {
  delete process.env.JAVA_BACKEND_URL;
  const response = await forwardJavaBackendRequest(new Request('http://next.local/api/analysis/sessions', {
    method: 'POST',
    body: 'question=test',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-correlation-id': 'trace-missing' },
  }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: 'Java 后端不可达。',
    code: 'JAVA_BACKEND_UNAVAILABLE',
    traceId: 'trace-missing',
  });
});

test('Next auth routes are pure Java proxies and Set-Cookie passes through', async (context) => {
  for (const path of [
    'src/app/api/auth/login/route.ts',
    'src/app/api/auth/logout/route.ts',
    'src/app/api/auth/callback/route.ts',
    'src/app/api/auth/directory-login/route.ts',
    'src/app/api/auth/bridge/route.ts',
    'src/app/api/auth/me/route.ts',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /forwardJavaBackendRequest\(request\)/, `${path} 必须是 Java 代理`);
    assert.doesNotMatch(source, /server-auth|getRequestSession|NextResponse/, `${path} 不得持有 Node 会话逻辑`);
  }

  const loginPage = await readFile(new URL('src/app/(auth)/login/page.tsx', root), 'utf8');
  assert.match(loginPage, /getCurrentViewer/, '登录页通过 Java viewer 判断会话');
  assert.match(loginPage, /getAuthConfig/, '登录页通过 Java config 读取能力状态');
  assert.doesNotMatch(loginPage, /server-auth/, '登录页不得引用 Node 会话模块');

  const server = createServer((request, response) => {
    response.statusCode = 303;
    response.setHeader('Location', '/workspace?loggedIn=1');
    response.setHeader('Set-Cookie',
      'dip3_session=payload.sig; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800');
    response.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  process.env.JAVA_BACKEND_URL = `http://127.0.0.1:${address.port}`;

  const login = await forwardJavaBackendRequest(new Request('http://next.local/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-correlation-id': 'trace-auth' },
    body: 'employeeId=u-1&organizationId=org-1',
  }));
  assert.equal(login.status, 303);
  assert.equal(login.headers.get('location'), '/workspace?loggedIn=1');
  assert.equal(
    login.headers.get('set-cookie'),
    'dip3_session=payload.sig; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800',
    'Set-Cookie 必须原样透传到浏览器',
  );
});
