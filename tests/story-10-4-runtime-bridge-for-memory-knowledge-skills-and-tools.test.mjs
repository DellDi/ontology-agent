import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
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
    {
      cwd: projectRoot,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, '--conditions=react-server']
          .filter(Boolean)
          .join(' '),
      },
    },
  );

  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed.split('\n').pop() ?? 'null');
}

const RUNTIME_IMPORT = `
  import domainRuntime from './src/domain/runtime/models.ts';
  import applicationRuntime from './src/application/runtime/index.ts';
  const {
    RUNTIME_CAPABILITY_STATUSES,
    RUNTIME_CAPABILITY_SURFACES,
    runtimeCapabilityApprovalAuditEventSchema,
    runtimeCapabilityDescriptorSchema,
    runtimeCapabilityResumeTokenSchema,
  } = domainRuntime;
  const {
    createRuntimeCapabilityApprovalAuditEvent,
    createRuntimeBridgeUseCases,
    createRuntimeCapabilityApprovalEnvelope,
  } = applicationRuntime;
`;

test('Story 10.4 AC1/AC2 | runtime bridge contract exposes four independent surfaces with status/version/provenance/ownership', async () => {
  const result = await runTsSnippet(`
    ${RUNTIME_IMPORT}
    const now = () => '2026-05-05T00:00:00.000Z';
    const owner = { ownerType: 'platform', ownerId: 'ontology-agent', visibility: 'platform' };
    const version = { schemaVersion: 1, contractVersion: 1, capabilityVersion: '2026.05' };
    const provenance = { source: 'test-adapter', sourceType: 'registry', retrievedAt: now() };
    const descriptor = (surface, id) => runtimeCapabilityDescriptorSchema.parse({
      id,
      surface,
      title: id,
      status: 'available',
      version,
      provenance,
      ownership: owner,
      availability: {
        status: 'available',
        reason: 'test adapter configured',
        checkedAt: now(),
      },
    });
    const bridge = createRuntimeBridgeUseCases({
      now,
      adapters: {
        memory: [{ surface: 'memory', listCapabilities: async () => [descriptor('memory', 'memory.provider.default')] }],
        knowledge: [{ surface: 'knowledge', listCapabilities: async () => [descriptor('knowledge', 'knowledge.resource.default')] }],
        skills: [{ surface: 'skills', listCapabilities: async () => [descriptor('skills', 'skill.prompt.default')] }],
        tools: [{ surface: 'tools', listCapabilities: async () => [descriptor('tools', 'tool.registry.default')] }],
      },
    });
    const discovery = await bridge.discoverCapabilities({
      correlationId: 'corr-contract',
      actor: { userId: 'user-1', organizationId: 'org-1' },
      source: 'application',
      purpose: 'story-10-4-contract-test',
    });
    console.log(JSON.stringify({
      surfaces: RUNTIME_CAPABILITY_SURFACES,
      statuses: RUNTIME_CAPABILITY_STATUSES,
      resumeTokenOk: runtimeCapabilityResumeTokenSchema.safeParse({
        token: 'resume-token-1',
        surface: 'tools',
        capabilityId: 'tool.registry.default',
        checkpoint: 'select:approve:execute',
        issuedAt: now(),
        provenance,
      }).success,
      approvalAuditOk: runtimeCapabilityApprovalAuditEventSchema.safeParse({
        correlationId: 'corr-contract',
        envelope: {
          correlationId: 'corr-contract',
          actor: { userId: 'user-1', organizationId: 'org-1' },
          target: { surface: 'tools', capabilityId: 'tool.registry.default', action: 'invoke' },
          reason: 'contract test',
          decision: 'requires-confirmation',
          source: 'application',
          requestedAt: now(),
          decidedAt: now(),
        },
        recordedAt: now(),
        eventType: 'approval.requires-confirmation',
        source: 'application',
      }).success,
      surfaceStatuses: Object.fromEntries(discovery.surfaces.map((surface) => [surface.surface, surface.status])),
      capabilityCount: discovery.capabilities.length,
      capabilitySurfaces: discovery.capabilities.map((capability) => capability.surface),
      metadataOk: discovery.capabilities.every((capability) =>
        capability.version.schemaVersion === 1 &&
        capability.version.contractVersion === 1 &&
        capability.provenance.source &&
        capability.ownership.ownerType
      ),
    }));
  `);

  assert.deepEqual(result.surfaces, ['memory', 'knowledge', 'skills', 'tools']);
  assert.equal(result.resumeTokenOk, true);
  assert.equal(result.approvalAuditOk, true);
  assert.deepEqual(result.statuses, [
    'available',
    'disabled',
    'degraded',
    'unconfigured',
    'requires-confirmation',
  ]);
  assert.deepEqual(result.surfaceStatuses, {
    memory: 'available',
    knowledge: 'available',
    skills: 'available',
    tools: 'available',
  });
  assert.equal(result.capabilityCount, 4);
  assert.deepEqual(result.capabilitySurfaces, ['memory', 'knowledge', 'skills', 'tools']);
  assert.equal(result.metadataOk, true);
});

test('Story 10.4 AC3 | unconfigured and failing providers return explicit diagnostic states instead of silent fallback', async () => {
  const result = await runTsSnippet(`
    ${RUNTIME_IMPORT}
    const now = () => '2026-05-05T00:00:00.000Z';
    const bridge = createRuntimeBridgeUseCases({
      now,
      adapters: {
        memory: [
          {
            surface: 'memory',
            listCapabilities: async () => {
              throw new Error('memory provider token missing');
            },
          },
        ],
        tools: [
          {
            surface: 'tools',
            listCapabilities: async () => [
              {
                id: 'tool.disabled',
                surface: 'tools',
                title: 'Disabled tool',
                status: 'disabled',
                version: { schemaVersion: 1, contractVersion: 1 },
                provenance: { source: 'tool-registry', sourceType: 'registry', retrievedAt: now() },
                ownership: { ownerType: 'platform', visibility: 'platform' },
                availability: {
                  status: 'disabled',
                  reasonCode: 'operator-disabled',
                  reason: 'operator disabled tool',
                  checkedAt: now(),
                },
              },
            ],
          },
        ],
      },
    });
    const discovery = await bridge.discoverCapabilities({
      correlationId: 'corr-diagnostics',
      actor: { userId: 'user-1', organizationId: 'org-1' },
      source: 'application',
      purpose: 'story-10-4-diagnostics-test',
    });
    console.log(JSON.stringify({
      surfaceStatuses: Object.fromEntries(discovery.surfaces.map((surface) => [surface.surface, surface.status])),
      reasons: Object.fromEntries(discovery.surfaces.map((surface) => [surface.surface, surface.reason])),
      diagnosticCodes: Object.fromEntries(discovery.surfaces.map((surface) => [surface.surface, surface.reasonCode])),
      toolStatus: discovery.capabilities.find((capability) => capability.id === 'tool.disabled')?.status ?? null,
    }));
  `);

  assert.equal(result.surfaceStatuses.memory, 'degraded');
  assert.match(result.reasons.memory, /memory provider token missing/);
  assert.equal(result.diagnosticCodes.memory, 'adapter-failed');
  assert.equal(result.surfaceStatuses.knowledge, 'unconfigured');
  assert.match(result.reasons.knowledge, /knowledge capability adapter is not configured/);
  assert.equal(result.surfaceStatuses.skills, 'unconfigured');
  assert.equal(result.toolStatus, 'disabled');
});

test('Story 10.4 Review | invocation skips failed adapters and uses a later matching provider', async () => {
  const result = await runTsSnippet(`
    ${RUNTIME_IMPORT}
    let fallbackInvocationCount = 0;
    const now = () => '2026-05-05T00:00:00.000Z';
    const descriptor = {
      id: 'memory.provider.fallback',
      surface: 'memory',
      title: 'Fallback memory provider',
      status: 'available',
      version: { schemaVersion: 1, contractVersion: 1 },
      provenance: { source: 'fallback-memory', sourceType: 'provider', retrievedAt: now() },
      ownership: { ownerType: 'platform', visibility: 'platform' },
      availability: {
        status: 'available',
        reason: 'fallback provider is available',
        checkedAt: now(),
      },
    };
    const bridge = createRuntimeBridgeUseCases({
      now,
      adapters: {
        memory: [
          {
            surface: 'memory',
            listCapabilities: async () => {
              throw new Error('primary memory provider timeout');
            },
          },
          {
            surface: 'memory',
            listCapabilities: async () => [descriptor],
            invokeCapability: async () => {
              fallbackInvocationCount += 1;
              return { ok: true, output: { recalled: ['fallback fact'] } };
            },
          },
        ],
      },
    });
    const invoked = await bridge.invokeCapability({
      context: {
        correlationId: 'corr-adapter-fallback',
        actor: { userId: 'user-1', organizationId: 'org-1' },
        source: 'application',
        purpose: 'review-adapter-fallback',
      },
      surface: 'memory',
      capabilityId: 'memory.provider.fallback',
      input: { query: '收费率' },
    });
    console.log(JSON.stringify({ invoked, fallbackInvocationCount }));
  `);

  assert.equal(result.invoked.ok, true);
  assert.deepEqual(result.invoked.output, { recalled: ['fallback fact'] });
  assert.equal(result.fallbackInvocationCount, 1);
});

test('Story 10.4 AC4/AC7 | approval envelope blocks sensitive tool invocation until approved', async () => {
  const result = await runTsSnippet(`
    ${RUNTIME_IMPORT}
    let invocationCount = 0;
    const now = (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 4, 5, 0, 0, tick++)).toISOString();
    })();
    const sensitiveTool = {
      id: 'tool.sensitive-export',
      surface: 'tools',
      title: 'Sensitive export',
      status: 'requires-confirmation',
      version: { schemaVersion: 1, contractVersion: 1, capabilityVersion: '1.0.0' },
      provenance: { source: 'tool-registry', sourceType: 'registry', retrievedAt: now() },
      ownership: { ownerType: 'platform', visibility: 'platform' },
      availability: {
        status: 'requires-confirmation',
        reasonCode: 'sensitive-tool',
        reason: 'sensitive export requires approval',
        checkedAt: now(),
      },
      approval: { required: true, policyId: 'policy-sensitive-tool', reason: 'exports scoped data' },
    };
    const bridge = createRuntimeBridgeUseCases({
      now,
      adapters: {
        tools: [
          {
            surface: 'tools',
            listCapabilities: async () => [sensitiveTool],
            invokeCapability: async () => {
              invocationCount += 1;
              return { ok: true, output: { exported: true } };
            },
          },
        ],
      },
    });
    const context = {
      correlationId: 'corr-approval',
      actor: { userId: 'user-1', organizationId: 'org-1' },
      source: 'application',
      purpose: 'story-10-4-approval-test',
    };
    const denied = createRuntimeCapabilityApprovalEnvelope({
      correlationId: 'corr-approval',
      actor: context.actor,
      target: { surface: 'tools', capabilityId: 'tool.sensitive-export', action: 'invoke' },
      reason: 'operator rejected export',
      decision: 'denied',
      source: 'application',
      now,
    });
    const deniedResult = await bridge.invokeCapability({
      context,
      surface: 'tools',
      capabilityId: 'tool.sensitive-export',
      input: { scope: 'org-1' },
      approval: denied,
    });
    const pendingResult = await bridge.invokeCapability({
      context,
      surface: 'tools',
      capabilityId: 'tool.sensitive-export',
      input: { scope: 'org-1' },
    });
    const pending = createRuntimeCapabilityApprovalEnvelope({
      correlationId: 'corr-approval',
      actor: context.actor,
      target: { surface: 'tools', capabilityId: 'tool.sensitive-export', action: 'invoke' },
      reason: 'operator has not decided yet',
      decision: 'pending',
      source: 'application',
      now,
    });
    const explicitPendingResult = await bridge.invokeCapability({
      context,
      surface: 'tools',
      capabilityId: 'tool.sensitive-export',
      input: { scope: 'org-1' },
      approval: pending,
    });
    const approved = createRuntimeCapabilityApprovalEnvelope({
      correlationId: 'corr-approval',
      actor: context.actor,
      target: { surface: 'tools', capabilityId: 'tool.sensitive-export', action: 'invoke' },
      reason: 'operator approved scoped export',
      decision: 'approved',
      source: 'application',
      now,
    });
    const auditEvent = createRuntimeCapabilityApprovalAuditEvent({
      envelope: approved,
      now,
    });
    const approvedResult = await bridge.invokeCapability({
      context,
      surface: 'tools',
      capabilityId: 'tool.sensitive-export',
      input: { scope: 'org-1' },
      approval: approved,
    });
    console.log(JSON.stringify({
      invocationCount,
      deniedResult,
      pendingResult,
      explicitPendingResult,
      approvedResult,
      envelopeFields: {
        correlationId: approved.correlationId,
        actor: approved.actor,
        target: approved.target,
        reason: approved.reason,
        decision: approved.decision,
        requestedAt: approved.requestedAt,
        decidedAt: approved.decidedAt,
      },
      auditEvent,
    }));
  `);

  assert.equal(result.invocationCount, 1);
  assert.equal(result.deniedResult.ok, false);
  assert.equal(result.deniedResult.status, 'disabled');
  assert.equal(result.deniedResult.reasonCode, 'approval-denied');
  assert.equal(result.deniedResult.deniedByApproval, true);
  assert.equal(result.deniedResult.approval.decision, 'denied');
  assert.equal(result.pendingResult.ok, false);
  assert.equal(result.pendingResult.status, 'requires-confirmation');
  assert.equal(result.pendingResult.reasonCode, 'approval-required');
  assert.equal(result.explicitPendingResult.ok, false);
  assert.equal(result.explicitPendingResult.status, 'requires-confirmation');
  assert.equal(result.explicitPendingResult.reasonCode, 'approval-pending');
  assert.equal(result.explicitPendingResult.approval.decision, 'pending');
  assert.equal(result.approvedResult.ok, true);
  assert.deepEqual(result.approvedResult.output, { exported: true });
  assert.equal(result.envelopeFields.correlationId, 'corr-approval');
  assert.equal(result.envelopeFields.actor.userId, 'user-1');
  assert.equal(result.envelopeFields.target.capabilityId, 'tool.sensitive-export');
  assert.equal(result.envelopeFields.decision, 'approved');
  assert.ok(result.envelopeFields.requestedAt);
  assert.ok(result.envelopeFields.decidedAt);
  assert.equal(result.auditEvent.eventType, 'approval.approved');
  assert.equal(result.auditEvent.correlationId, 'corr-approval');
});

test('Story 10.4 AC2/AC5/AC8 | infrastructure composition reuses prompt registry and tool registry server-side', async () => {
  const result = await runTsSnippet(`
    import toolingModule from './src/infrastructure/tooling/index.ts';
    import runtimeInfrastructure from './src/infrastructure/runtime/index.ts';
    const { createAnalysisToolingServices } = toolingModule;
    const { createServerRuntimeBridgeServices } = runtimeInfrastructure;

    process.env.DASHSCOPE_API_KEY = 'fake-key';
    process.env.CUBE_API_TOKEN = '';
    process.env.NEO4J_URI = '';
    process.env.NEO4J_USERNAME = '';
    process.env.NEO4J_PASSWORD = '';

    const tooling = createAnalysisToolingServices({
      analysisAiUseCases: {
        async runTask(request) {
          return {
            taskType: request.taskType,
            ok: true,
            value: { strategy: 'test', tools: [] },
            issues: [],
            providerResult: { provider: 'openai-compatible', model: 'test', finishReason: 'stop' },
          };
        },
      },
      erpReadUseCases: {
        async listOrganizations() { return []; },
        async listProjects() { return []; },
        async listCurrentOwners() { return []; },
        async listChargeItems() { return []; },
        async listReceivables() { return []; },
        async listPayments() { return []; },
        async listServiceOrders() { return []; },
      },
      semanticQueryUseCases: {
        async runMetricQuery() { return { metric: 'collection-rate', rows: [] }; },
      },
      graphUseCases: {
        async expandCandidateFactors() { return { mode: 'skip', factors: [] }; },
      },
    });
    const runtime = createServerRuntimeBridgeServices({
      toolRegistryUseCases: tooling.toolRegistryUseCases,
      now: () => '2026-05-05T00:00:00.000Z',
    });
    const discovery = await runtime.runtimeBridgeUseCases.discoverCapabilities({
      correlationId: 'corr-infra',
      actor: { userId: 'user-1', organizationId: 'org-1' },
      source: 'application',
      purpose: 'story-10-4-infra-test',
    });
    console.log(JSON.stringify({
      toolIds: discovery.capabilities.filter((capability) => capability.surface === 'tools').map((capability) => capability.id),
      skillIds: discovery.capabilities.filter((capability) => capability.surface === 'skills').map((capability) => capability.id),
      surfaceStatuses: Object.fromEntries(discovery.surfaces.map((surface) => [surface.surface, surface.status])),
      serverOnly: runtime.serverOnly,
    }));
  `);

  assert.deepEqual(result.toolIds, [
    'tool:llm.structured-analysis',
    'tool:erp.read-model',
    'tool:cube.semantic-query',
    'tool:neo4j.graph-query',
    'tool:platform.capability-status',
  ]);
  assert.ok(result.skillIds.includes('skill:analysis-intent'));
  assert.ok(result.skillIds.includes('skill:tool-selection'));
  assert.equal(result.surfaceStatuses.memory, 'unconfigured');
  assert.equal(result.surfaceStatuses.knowledge, 'unconfigured');
  assert.equal(result.surfaceStatuses.tools, 'degraded');
  assert.equal(result.serverOnly, true);
});

test('Story 10.4 AC5/AC6 | bridge declares immutable canonical fact boundaries and keeps adapters out of browser imports', async () => {
  const result = await runTsSnippet(`
    ${RUNTIME_IMPORT}
    const bridge = createRuntimeBridgeUseCases({});
    console.log(JSON.stringify({
      boundaries: bridge.describeCanonicalBoundaries(),
    }));
  `);
  const infrastructureSource = await readFile(
    resolve(projectRoot, 'src/infrastructure/runtime/index.ts'),
    'utf8',
  );
  const applicationSource = await readFile(
    resolve(projectRoot, 'src/application/runtime/use-cases.ts'),
    'utf8',
  );
  const domainSource = await readFile(
    resolve(projectRoot, 'src/domain/runtime/models.ts'),
    'utf8',
  );

  assert.ok(infrastructureSource.startsWith("import 'server-only';"));
  assert.ok(infrastructureSource.includes("capabilityId.startsWith('tool:')"));
  assert.equal(applicationSource.includes('@/infrastructure/'), false);
  assert.equal(domainSource.includes('@/infrastructure/'), false);
  assert.ok(
    result.boundaries.some(
      (boundary) =>
        boundary.name === 'execution-events' && boundary.mutableByRuntimeBridge === false,
    ),
  );
  assert.ok(
    result.boundaries.some(
      (boundary) =>
        boundary.name === 'ontology-registry' && boundary.mutableByRuntimeBridge === false,
    ),
  );
  assert.ok(
    result.boundaries.every(
      (boundary) => boundary.mutableByRuntimeBridge === false,
    ),
  );
});
