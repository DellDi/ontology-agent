import {
  RUNTIME_CAPABILITY_SURFACES,
  runtimeCapabilityApprovalAuditEventSchema,
  runtimeCapabilityApprovalEnvelopeSchema,
  runtimeCapabilityDescriptorSchema,
  type RuntimeCanonicalFactBoundary,
  type RuntimeCapabilityApprovalAuditEvent,
  type RuntimeCapabilityApprovalEnvelope,
  type RuntimeCapabilityDescriptor,
  type RuntimeCapabilityStatus,
  type RuntimeCapabilitySurface,
  type RuntimeCapabilitySurfaceState,
} from '@/domain/runtime/models';

import type {
  RuntimeCapabilityAdapter,
  RuntimeCapabilityAdapterMap,
  RuntimeCapabilityInvocationFailure,
  RuntimeCapabilityInvocationResult,
  RuntimeCapabilityRequestContext,
} from './ports';

export type RuntimeCapabilityDiscovery = {
  correlationId: string;
  checkedAt: string;
  surfaces: RuntimeCapabilitySurfaceState[];
  capabilities: RuntimeCapabilityDescriptor[];
  canonicalBoundaries: RuntimeCanonicalFactBoundary[];
};

export type RuntimeBridgeDependencies = {
  adapters?: RuntimeCapabilityAdapterMap;
  now?: () => string;
};

const DEFAULT_CANONICAL_BOUNDARIES: RuntimeCanonicalFactBoundary[] = [
  {
    name: 'execution-events',
    owner: 'worker-orchestration',
    mutableByRuntimeBridge: false,
    reason: 'runtime bridge may project execution events but must not rewrite event facts',
  },
  {
    name: 'execution-snapshots',
    owner: 'analysis-execution',
    mutableByRuntimeBridge: false,
    reason: 'snapshots remain execution persistence facts',
  },
  {
    name: 'follow-up-history',
    owner: 'follow-up/history use cases',
    mutableByRuntimeBridge: false,
    reason: 'follow-up and history rounds are consumed as context only',
  },
  {
    name: 'ontology-registry',
    owner: 'ontology governance',
    mutableByRuntimeBridge: false,
    reason: 'ontology registry remains the governed metric/factor/tool binding source',
  },
  {
    name: 'knowledge-governance',
    owner: 'knowledge governance',
    mutableByRuntimeBridge: false,
    reason: 'retrieved knowledge can enrich context but cannot become governed knowledge truth',
  },
  {
    name: 'permission-audit',
    owner: 'authorization and audit',
    mutableByRuntimeBridge: false,
    reason: 'approval is a governance checkpoint, not an authorization replacement',
  },
  {
    name: 'worker-orchestration',
    owner: 'worker runtime',
    mutableByRuntimeBridge: false,
    reason: 'bridge does not schedule or resume autonomous worker loops',
  },
];

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'runtime capability adapter failed';
}

function buildUnconfiguredSurfaceState(
  surface: RuntimeCapabilitySurface,
  checkedAt: string,
): RuntimeCapabilitySurfaceState {
  return {
    surface,
    status: 'unconfigured',
    reasonCode: 'adapter-unconfigured',
    reason: `${surface} capability adapter is not configured.`,
    checkedAt,
    capabilityCount: 0,
  };
}

function deriveSurfaceStatus(
  capabilities: RuntimeCapabilityDescriptor[],
): RuntimeCapabilityStatus {
  if (capabilities.some((capability) => capability.status === 'degraded')) {
    return 'degraded';
  }
  if (
    capabilities.some(
      (capability) => capability.status === 'requires-confirmation',
    )
  ) {
    return 'requires-confirmation';
  }
  if (capabilities.some((capability) => capability.status === 'available')) {
    return 'available';
  }
  if (capabilities.some((capability) => capability.status === 'disabled')) {
    return 'disabled';
  }
  return 'unconfigured';
}

function buildSurfaceState(input: {
  surface: RuntimeCapabilitySurface;
  checkedAt: string;
  capabilities: RuntimeCapabilityDescriptor[];
  failures: string[];
}): RuntimeCapabilitySurfaceState {
  if (input.failures.length > 0) {
    return {
      surface: input.surface,
      status: 'degraded',
      reasonCode: 'adapter-failed',
      reason: input.failures.join('; '),
      checkedAt: input.checkedAt,
      capabilityCount: input.capabilities.length,
    };
  }

  if (input.capabilities.length === 0) {
    return buildUnconfiguredSurfaceState(input.surface, input.checkedAt);
  }

  const status = deriveSurfaceStatus(input.capabilities);
  const diagnostic = input.capabilities.find(
    (capability) => capability.status === status,
  );

  return {
    surface: input.surface,
    status,
    reasonCode: diagnostic?.availability.reasonCode,
    reason: diagnostic?.availability.reason ?? `${input.surface} is ${status}.`,
    checkedAt: input.checkedAt,
    capabilityCount: input.capabilities.length,
  };
}

function buildInvocationFailure(input: {
  capabilityId: string;
  surface: RuntimeCapabilitySurface;
  correlationId: string;
  status: Exclude<RuntimeCapabilityStatus, 'available'>;
  reasonCode: string;
  reason: string;
  deniedByApproval?: boolean;
  approval?: RuntimeCapabilityApprovalEnvelope;
}): RuntimeCapabilityInvocationFailure {
  return {
    ok: false,
    capabilityId: input.capabilityId,
    surface: input.surface,
    correlationId: input.correlationId,
    status: input.status,
    reasonCode: input.reasonCode,
    reason: input.reason,
    deniedByApproval: input.deniedByApproval,
    approval: input.approval,
  };
}

function approvalTargetsCapability(input: {
  approval: RuntimeCapabilityApprovalEnvelope;
  context: RuntimeCapabilityRequestContext;
  surface: RuntimeCapabilitySurface;
  capabilityId: string;
}) {
  return (
    input.approval.correlationId === input.context.correlationId &&
    input.approval.actor.userId === input.context.actor.userId &&
    input.approval.actor.organizationId ===
      input.context.actor.organizationId &&
    input.approval.target.surface === input.surface &&
    input.approval.target.capabilityId === input.capabilityId &&
    input.approval.target.action === 'invoke'
  );
}

export function createRuntimeCapabilityApprovalEnvelope(input: {
  correlationId: string;
  actor: RuntimeCapabilityRequestContext['actor'];
  target: {
    surface: RuntimeCapabilitySurface;
    capabilityId: string;
    action: string;
  };
  reason: string;
  decision: RuntimeCapabilityApprovalEnvelope['decision'];
  source: RuntimeCapabilityApprovalEnvelope['source'];
  now?: () => string;
  decidedBy?: RuntimeCapabilityApprovalEnvelope['decidedBy'];
  expiresAt?: string;
}): RuntimeCapabilityApprovalEnvelope {
  const now = input.now ?? (() => new Date().toISOString());
  const requestedAt = now();
  const envelope = {
    correlationId: input.correlationId,
    actor: input.actor,
    target: input.target,
    reason: input.reason,
    decision: input.decision,
    source: input.source,
    requestedAt,
    decidedAt: input.decision === 'pending' ? undefined : now(),
    decidedBy: input.decidedBy,
    expiresAt: input.expiresAt,
  };

  return runtimeCapabilityApprovalEnvelopeSchema.parse(envelope);
}

export function createRuntimeCapabilityApprovalAuditEvent(input: {
  envelope: RuntimeCapabilityApprovalEnvelope;
  now?: () => string;
  source?: RuntimeCapabilityApprovalAuditEvent['source'];
}): RuntimeCapabilityApprovalAuditEvent {
  const now = input.now ?? (() => new Date().toISOString());
  const eventType =
    input.envelope.decision === 'approved'
      ? 'approval.approved'
      : input.envelope.decision === 'denied'
        ? 'approval.denied'
        : input.envelope.decision === 'requires-confirmation'
          ? 'approval.requires-confirmation'
          : 'approval.requested';

  return runtimeCapabilityApprovalAuditEventSchema.parse({
    correlationId: input.envelope.correlationId,
    envelope: input.envelope,
    recordedAt: now(),
    eventType,
    source: input.source ?? input.envelope.source,
  });
}

async function collectSurfaceCapabilities(input: {
  surface: RuntimeCapabilitySurface;
  adapters: RuntimeCapabilityAdapter[];
  context: RuntimeCapabilityRequestContext;
  checkedAt: string;
}): Promise<{
  state: RuntimeCapabilitySurfaceState;
  capabilities: RuntimeCapabilityDescriptor[];
}> {
  if (input.adapters.length === 0) {
    return {
      state: buildUnconfiguredSurfaceState(input.surface, input.checkedAt),
      capabilities: [],
    };
  }

  const capabilities: RuntimeCapabilityDescriptor[] = [];
  const failures: string[] = [];

  for (const adapter of input.adapters) {
    try {
      if (adapter.surface !== input.surface) {
        throw new Error(
          `adapter surface mismatch: expected ${input.surface}, received ${adapter.surface}`,
        );
      }

      const listed = await adapter.listCapabilities(input.context);
      capabilities.push(
        ...listed.map((descriptor) =>
          runtimeCapabilityDescriptorSchema.parse(descriptor),
        ),
      );
    } catch (error) {
      failures.push(normalizeErrorMessage(error));
    }
  }

  return {
    state: buildSurfaceState({
      surface: input.surface,
      checkedAt: input.checkedAt,
      capabilities,
      failures,
    }),
    capabilities,
  };
}

export function createRuntimeBridgeUseCases({
  adapters = {},
  now = () => new Date().toISOString(),
}: RuntimeBridgeDependencies) {
  function getAdapters(surface: RuntimeCapabilitySurface) {
    return adapters[surface] ?? [];
  }

  async function resolveCapabilityForInvocation(input: {
    context: RuntimeCapabilityRequestContext;
    surface: RuntimeCapabilitySurface;
    capabilityId: string;
  }): Promise<{
    adapter: RuntimeCapabilityAdapter | null;
    descriptor: RuntimeCapabilityDescriptor | null;
    failure: RuntimeCapabilityInvocationFailure | null;
  }> {
    const surfaceAdapters = getAdapters(input.surface);
    if (surfaceAdapters.length === 0) {
      return {
        adapter: null,
        descriptor: null,
        failure: buildInvocationFailure({
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: 'unconfigured',
          reasonCode: 'adapter-unconfigured',
          reason: `${input.surface} capability adapter is not configured.`,
        }),
      };
    }

    const adapterFailures: string[] = [];

    for (const adapter of surfaceAdapters) {
      try {
        const descriptors = await adapter.listCapabilities(input.context);
        const descriptor =
          descriptors
            .map((candidate) => runtimeCapabilityDescriptorSchema.parse(candidate))
            .find((candidate) => candidate.id === input.capabilityId) ?? null;

        if (descriptor) {
          return {
            adapter,
            descriptor,
            failure: null,
          };
        }
      } catch (error) {
        adapterFailures.push(normalizeErrorMessage(error));
      }
    }

    if (adapterFailures.length === surfaceAdapters.length) {
      return {
        adapter: null,
        descriptor: null,
        failure: buildInvocationFailure({
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: 'degraded',
          reasonCode: 'adapter-failed',
          reason: adapterFailures.join('; '),
        }),
      };
    }

    return {
      adapter: null,
      descriptor: null,
      failure: buildInvocationFailure({
        capabilityId: input.capabilityId,
        surface: input.surface,
        correlationId: input.context.correlationId,
        status: 'unconfigured',
        reasonCode: 'capability-not-found',
        reason: `Runtime capability ${input.capabilityId} is not registered on ${input.surface}.`,
      }),
    };
  }

  return {
    async discoverCapabilities(
      context: RuntimeCapabilityRequestContext,
    ): Promise<RuntimeCapabilityDiscovery> {
      const checkedAt = now();
      const states: RuntimeCapabilitySurfaceState[] = [];
      const capabilities: RuntimeCapabilityDescriptor[] = [];

      for (const surface of RUNTIME_CAPABILITY_SURFACES) {
        const result = await collectSurfaceCapabilities({
          surface,
          adapters: getAdapters(surface),
          context,
          checkedAt,
        });
        states.push(result.state);
        capabilities.push(...result.capabilities);
      }

      return {
        correlationId: context.correlationId,
        checkedAt,
        surfaces: states,
        capabilities,
        canonicalBoundaries: DEFAULT_CANONICAL_BOUNDARIES,
      };
    },

    describeCanonicalBoundaries(): RuntimeCanonicalFactBoundary[] {
      return DEFAULT_CANONICAL_BOUNDARIES;
    },

    async invokeCapability(input: {
      context: RuntimeCapabilityRequestContext;
      surface: RuntimeCapabilitySurface;
      capabilityId: string;
      input: unknown;
      approval?: RuntimeCapabilityApprovalEnvelope;
    }): Promise<RuntimeCapabilityInvocationResult> {
      const resolution = await resolveCapabilityForInvocation({
        context: input.context,
        surface: input.surface,
        capabilityId: input.capabilityId,
      });

      if (resolution.failure) return resolution.failure;
      const { adapter, descriptor } = resolution;

      if (!adapter || !descriptor) {
        return buildInvocationFailure({
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: 'unconfigured',
          reasonCode: 'capability-not-found',
          reason: `Runtime capability ${input.capabilityId} is not registered on ${input.surface}.`,
        });
      }

      if (
        descriptor.status === 'disabled' ||
        descriptor.status === 'degraded' ||
        descriptor.status === 'unconfigured'
      ) {
        return buildInvocationFailure({
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: descriptor.status,
          reasonCode: descriptor.availability.reasonCode ?? 'capability-unavailable',
          reason: descriptor.availability.reason,
        });
      }

      const approvalRequired =
        descriptor.approval?.required ||
        descriptor.status === 'requires-confirmation';
      if (approvalRequired) {
        const approval = input.approval;
        const matches =
          approval &&
          approvalTargetsCapability({
            approval,
            context: input.context,
            surface: input.surface,
            capabilityId: input.capabilityId,
          });

        if (!matches || approval.decision !== 'approved') {
          const decision = matches
            ? approval.decision
            : 'requires-confirmation';
          const approvalEnvelope =
            approval ??
            createRuntimeCapabilityApprovalEnvelope({
              correlationId: input.context.correlationId,
              actor: input.context.actor,
              target: {
                surface: input.surface,
                capabilityId: input.capabilityId,
                action: 'invoke',
              },
              reason:
                descriptor.approval?.reason ??
                descriptor.availability.reason,
              decision,
              source: input.context.source,
              now,
            });

          return buildInvocationFailure({
            capabilityId: input.capabilityId,
            surface: input.surface,
            correlationId: input.context.correlationId,
            status: decision === 'denied' ? 'disabled' : 'requires-confirmation',
            reasonCode:
              decision === 'denied'
                ? 'approval-denied'
                : decision === 'pending'
                  ? 'approval-pending'
                : 'approval-required',
            reason:
              decision === 'denied'
                ? approvalEnvelope.reason
                : `Runtime capability ${input.capabilityId} requires approval before invocation.`,
            deniedByApproval: decision === 'denied',
            approval: approvalEnvelope,
          });
        }
      }

      if (!adapter.invokeCapability) {
        return buildInvocationFailure({
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: 'disabled',
          reasonCode: 'invocation-not-supported',
          reason: `Runtime capability ${input.capabilityId} does not expose an invocation port.`,
        });
      }

      try {
        const result = await adapter.invokeCapability({
          capabilityId: input.capabilityId,
          input: input.input,
          context: input.context,
          approval: input.approval,
        });

        if (!result.ok) {
          return buildInvocationFailure({
            capabilityId: input.capabilityId,
            surface: input.surface,
            correlationId: input.context.correlationId,
            status: 'degraded',
            reasonCode: 'capability-invocation-failed',
            reason: result.reason,
            approval: input.approval,
          });
        }

        return {
          ok: true,
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: 'available',
          output: result.output,
          approval: input.approval,
        };
      } catch (error) {
        return buildInvocationFailure({
          capabilityId: input.capabilityId,
          surface: input.surface,
          correlationId: input.context.correlationId,
          status: 'degraded',
          reasonCode: 'capability-invocation-threw',
          reason: normalizeErrorMessage(error),
          approval: input.approval,
        });
      }
    },
  };
}
