import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import governanceSchemas from '../src/infrastructure/java-backend/governance-schema.ts';

const {
  governanceChangeRequestDetailSchema,
  governanceChangeRequestListSchema,
  governanceDefinitionsSchema,
  governanceOverviewSchema,
  governancePublishHistorySchema,
} = governanceSchemas;

const root = new URL('../', import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('governance fixtures pass Draft 2020-12 and strict Next Zod contracts', async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const name of [
    'governance-shared.schema.json',
    'governance-overview.schema.json',
    'governance-definitions.schema.json',
    'governance-change-request-list.schema.json',
    'governance-change-request-detail.schema.json',
    'governance-publish-history.schema.json',
    'ontology-bootstrap.schema.json',
  ]) {
    const schema = await json(`contracts/backend/schemas/${name}`);
    assert.equal(ajv.validateSchema(schema), true, ajv.errorsText());
    ajv.addSchema(schema);
  }

  for (const [fixture, schemaId, zodSchema] of [
    ['governance-overview.json', 'governance-overview.schema.json', governanceOverviewSchema],
    ['governance-definitions.json', 'governance-definitions.schema.json', governanceDefinitionsSchema],
    ['governance-change-request-list.json', 'governance-change-request-list.schema.json', governanceChangeRequestListSchema],
    ['governance-change-request-detail.json', 'governance-change-request-detail.schema.json', governanceChangeRequestDetailSchema],
    ['governance-publish-history.json', 'governance-publish-history.schema.json', governancePublishHistorySchema],
  ]) {
    const value = await json(`contracts/backend/fixtures/${fixture}`);
    const validate = ajv.getSchema(schemaId);
    assert.ok(validate);
    assert.equal(validate(value), true, `${fixture}: ${ajv.errorsText(validate.errors)}`);
    const parsed = zodSchema.safeParse(value);
    assert.equal(parsed.success, true, `${fixture}: ${parsed.success ? '' : parsed.error.message}`);
  }

  const unknown = await json('contracts/backend/fixtures/governance-overview.json');
  unknown.compatibilityFallback = true;
  assert.equal(governanceOverviewSchema.safeParse(unknown).success, false);

  for (const [fixture, schemaId] of [
    ['ontology-bootstrap-status-empty.json', 'ontology-bootstrap.schema.json#/$defs/status'],
    ['ontology-bootstrap-result-created.json', 'ontology-bootstrap.schema.json#/$defs/result'],
  ]) {
    const value = await json(`contracts/backend/fixtures/${fixture}`);
    const validate = ajv.getSchema(schemaId);
    assert.ok(validate);
    assert.equal(validate(value), true, `${fixture}: ${ajv.errorsText(validate.errors)}`);
  }

  const inconsistentBootstrap = await json('contracts/backend/fixtures/ontology-bootstrap-status-empty.json');
  inconsistentBootstrap.ready = true;
  assert.equal(ajv.getSchema('ontology-bootstrap.schema.json#/$defs/status')(inconsistentBootstrap), false);
});

test('Next ontology mutation and query routes are transparent Java adapters', async () => {
  for (const path of [
    'src/app/api/admin/ontology/bootstrap/route.ts',
    'src/app/api/admin/ontology/overview/route.ts',
    'src/app/api/admin/ontology/definitions/route.ts',
    'src/app/api/admin/ontology/versions/route.ts',
    'src/app/api/admin/ontology/change-requests/route.ts',
    'src/app/api/admin/ontology/change-requests/[id]/route.ts',
    'src/app/api/admin/ontology/change-requests/[id]/submit/route.ts',
    'src/app/api/admin/ontology/change-requests/[id]/review/route.ts',
    'src/app/api/admin/ontology/publishes/route.ts',
    'src/app/api/admin/ontology/versions/[id]/publish/route.ts',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /forwardJavaBackendRequest\(request\)/, `${path} 未代理 Java`);
    assert.doesNotMatch(
      source,
      /createCompositionRoot|ontologyAdminRuntime|authorizeGovernanceRequest/,
      `${path} 仍在 Next 执行治理规则`,
    );
  }

  const bootstrap = await readFile(
    new URL('src/app/api/admin/ontology/bootstrap/route.ts', root),
    'utf8',
  );
  assert.match(bootstrap, /export async function GET\(/);
  assert.match(bootstrap, /export async function POST\(/);

  const openapi = await readFile(new URL('contracts/backend/openapi.yaml', root), 'utf8');
  assert.match(openapi, /^  \/api\/admin\/ontology\/bootstrap:$/m);
  assert.match(openapi, /ontology-bootstrap\.schema\.json#\/\$defs\/status/);
  assert.match(openapi, /ontology-bootstrap\.schema\.json#\/\$defs\/result/);
});

test('Next graph-sync routes are transparent Java adapters', async () => {
  for (const path of [
    'src/app/api/admin/graph-sync/status/route.ts',
    'src/app/api/admin/graph-sync/organizations/[organizationId]/status/route.ts',
    'src/app/api/admin/graph-sync/organizations/[organizationId]/rebuild/route.ts',
    'src/app/api/admin/graph-sync/consistency-sweep/route.ts',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /forwardJavaBackendRequest\(request\)/, `${path} 未代理 Java`);
    assert.doesNotMatch(
      source,
      /createCompositionRoot|graphSyncOperations|createGraphSync/,
      `${path} 仍在 Next 执行 Graph Sync 规则`,
    );
  }

  await assert.rejects(
    readFile(new URL('src/app/api/system/graph-sync/bootstrap/route.ts', root), 'utf8'),
    (error) => error?.code === 'ENOENT',
    'system bootstrap 不得通过 Next 暴露 ops secret',
  );
  const openapi = await readFile(new URL('contracts/backend/openapi.yaml', root), 'utf8');
  assert.match(openapi, /^  \/api\/system\/graph-sync\/bootstrap:$/m);
  assert.match(openapi, /^  \/api\/system\/graph-sync\/bootstrap\/status:$/m);
  assert.match(openapi, /graphSyncOpsSecret: \{ type: apiKey, in: header, name: X-Graph-Sync-Ops-Secret \}/);
});

test('Next audit and health routes do not construct the TypeScript business runtime', async () => {
  for (const path of [
    'src/app/api/admin/audit/events/route.ts',
    'src/app/api/health/route.ts',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /forwardJavaBackendRequest/);
    assert.doesNotMatch(source, /createCompositionRoot|getRequestSession|getSharedRedisClient/);
  }
});

test('mobile follow-up route delegates to Java without TypeScript mobile use cases', async () => {
  for (const path of [
    'src/app/api/mobile/analysis/sessions/[sessionId]/follow-ups/route.ts',
    'src/app/api/mobile/analysis/sessions/[sessionId]/execute/route.ts',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /forwardJavaBackendRequest/);
    assert.doesNotMatch(source, /createCompositionRoot|mobile-analysis/);
  }
});

test('ontology admin server components read Java governance and never construct TypeScript business runtime', async () => {
  for (const path of [
    'src/app/(admin)/layout.tsx',
    'src/app/(admin)/admin/ontology/page.tsx',
    'src/app/(admin)/admin/ontology/definitions/page.tsx',
    'src/app/(admin)/admin/ontology/change-requests/page.tsx',
    'src/app/(admin)/admin/ontology/change-requests/new/page.tsx',
    'src/app/(admin)/admin/ontology/change-requests/[id]/page.tsx',
    'src/app/(admin)/admin/ontology/publishes/page.tsx',
  ]) {
    const source = await readFile(new URL(path, root), 'utf8');
    assert.match(source, /java-backend/);
    assert.doesNotMatch(source, /createCompositionRoot|ontologyAdminRuntime|@\/composition-root/);
  }
});
