import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function runTsSnippet(code) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', code],
    { cwd: projectRoot },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  return JSON.parse(trimmed.split('\n').pop());
}

const MAPPER_IMPORT = `
  import contractModule from './src/application/ai-runtime/runtime-contract.ts';
  import mapperModule from './src/application/ai-runtime/runtime-projection-mapper.ts';
  import adapterModule from './src/infrastructure/ai-runtime/vercel-ai-sdk-adapter.ts';
  const {
    AI_RUNTIME_SCHEMA_VERSION,
    AI_RUNTIME_CONTRACT_VERSION,
    assertAiRuntimeVersions,
  } = contractModule;
  const { buildAiRuntimeProjection } = mapperModule;
  const { projectionToUIMessages } = adapterModule;
`;

function buildFixtureEvents() {
  return [
    {
      id: 'evt-1',
      sessionId: 'session-1',
      executionId: 'exec-1',
      sequence: 1,
      kind: 'execution-status',
      timestamp: '2026-04-20T00:00:00.000Z',
      status: 'processing',
      message: 'start',
      renderBlocks: [],
    },
  ];
}

test('projection 与 UIMessage.metadata 都携带 schema/contract version，值来自常量', async () => {
  const events = buildFixtureEvents();
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(events)};
    const projection = buildAiRuntimeProjection({
      sessionId: 'session-1',
      executionId: 'exec-1',
      events,
    });
    const [msg] = projectionToUIMessages(projection);
    console.log(JSON.stringify({
      constants: {
        schema: AI_RUNTIME_SCHEMA_VERSION,
        contract: AI_RUNTIME_CONTRACT_VERSION,
      },
      projection: {
        schemaVersion: projection.schemaVersion,
        contractVersion: projection.contractVersion,
      },
      metadata: {
        schemaVersion: msg.metadata.schemaVersion,
        contractVersion: msg.metadata.contractVersion,
      },
    }));
  `);

  assert.equal(result.projection.schemaVersion, result.constants.schema);
  assert.equal(result.projection.contractVersion, result.constants.contract);
  // adapter 的 metadata 必须与 projection 一致（同一事实源）
  assert.equal(result.metadata.schemaVersion, result.projection.schemaVersion);
  assert.equal(result.metadata.contractVersion, result.projection.contractVersion);
  assert.ok(
    Number.isInteger(result.projection.schemaVersion) &&
      result.projection.schemaVersion >= 1,
  );
});

test('assertAiRuntimeVersions: 匹配静默通过，不匹配必须 fail-loud 抛错', async () => {
  const result = await runTsSnippet(`
    ${MAPPER_IMPORT}
    const events = ${JSON.stringify(buildFixtureEvents())};
    const projection = buildAiRuntimeProjection({
      sessionId: 's', executionId: 'e', events,
    });
    const outcomes = {};

    // 1) shape-only check：通过
    let shapeOnly = 'unset';
    try {
      assertAiRuntimeVersions(projection);
      shapeOnly = 'pass';
    } catch (e) { shapeOnly = e.message; }
    outcomes.shapeOnly = shapeOnly;

    // 2) expected matches：通过
    let matchExpected = 'unset';
    try {
      assertAiRuntimeVersions(projection, {
        schemaVersion: AI_RUNTIME_SCHEMA_VERSION,
        contractVersion: AI_RUNTIME_CONTRACT_VERSION,
      });
      matchExpected = 'pass';
    } catch (e) { matchExpected = e.message; }
    outcomes.matchExpected = matchExpected;

    // 3) schemaVersion mismatch：必须抛
    let schemaMismatch = 'unset';
    try {
      assertAiRuntimeVersions(projection, { schemaVersion: 999 });
      schemaMismatch = 'SILENT-PASS';
    } catch (e) { schemaMismatch = e.message; }
    outcomes.schemaMismatch = schemaMismatch;

    // 4) contractVersion mismatch：必须抛
    let contractMismatch = 'unset';
    try {
      assertAiRuntimeVersions(projection, { contractVersion: 999 });
      contractMismatch = 'SILENT-PASS';
    } catch (e) { contractMismatch = e.message; }
    outcomes.contractMismatch = contractMismatch;

    // 5) shape invalid（传入空对象）：必须抛
    let shapeInvalid = 'unset';
    try {
      assertAiRuntimeVersions({});
      shapeInvalid = 'SILENT-PASS';
    } catch (e) { shapeInvalid = e.message; }
    outcomes.shapeInvalid = shapeInvalid;

    console.log(JSON.stringify(outcomes));
  `);

  assert.equal(result.shapeOnly, 'pass');
  assert.equal(result.matchExpected, 'pass');
  assert.ok(
    /ai-runtime version mismatch.*field=schemaVersion.*expected=999/.test(
      result.schemaMismatch,
    ),
    `schema mismatch 错误信息不符合 fail-loud 契约：${result.schemaMismatch}`,
  );
  assert.ok(
    /ai-runtime version mismatch.*field=contractVersion.*expected=999/.test(
      result.contractMismatch,
    ),
  );
  assert.ok(
    /ai-runtime version mismatch.*field=shape/.test(result.shapeInvalid),
    `shape mismatch 必须 fail-loud：${result.shapeInvalid}`,
  );
});
