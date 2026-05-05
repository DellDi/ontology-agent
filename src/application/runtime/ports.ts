import type {
  RuntimeCapabilityApprovalEnvelope,
  RuntimeCapabilityDescriptor,
  RuntimeCapabilityStatus,
  RuntimeCapabilitySurface,
} from '@/domain/runtime/models';

export type RuntimeCapabilityRequestContext = {
  correlationId: string;
  actor: {
    userId: string;
    organizationId: string;
  };
  source: 'application' | 'worker';
  purpose: string;
  sessionId?: string;
};

export type RuntimeCapabilityInvocationSuccess = {
  ok: true;
  capabilityId: string;
  surface: RuntimeCapabilitySurface;
  correlationId: string;
  status: 'available';
  output: unknown;
  approval?: RuntimeCapabilityApprovalEnvelope;
};

export type RuntimeCapabilityInvocationFailure = {
  ok: false;
  capabilityId: string;
  surface: RuntimeCapabilitySurface;
  correlationId: string;
  status: Exclude<RuntimeCapabilityStatus, 'available'>;
  reasonCode: string;
  reason: string;
  deniedByApproval?: boolean;
  approval?: RuntimeCapabilityApprovalEnvelope;
};

export type RuntimeCapabilityInvocationResult =
  | RuntimeCapabilityInvocationSuccess
  | RuntimeCapabilityInvocationFailure;

export type RuntimeCapabilityAdapter = {
  surface: RuntimeCapabilitySurface;
  listCapabilities: (
    context: RuntimeCapabilityRequestContext,
  ) => Promise<RuntimeCapabilityDescriptor[]>;
  invokeCapability?: (input: {
    capabilityId: string;
    input: unknown;
    context: RuntimeCapabilityRequestContext;
    approval?: RuntimeCapabilityApprovalEnvelope;
  }) => Promise<{ ok: true; output: unknown } | { ok: false; reason: string }>;
};

export type RuntimeMemoryCapabilityAdapter = RuntimeCapabilityAdapter & {
  surface: 'memory';
};

export type RuntimeKnowledgeCapabilityAdapter = RuntimeCapabilityAdapter & {
  surface: 'knowledge';
};

export type RuntimeSkillsCapabilityAdapter = RuntimeCapabilityAdapter & {
  surface: 'skills';
};

export type RuntimeToolsCapabilityAdapter = RuntimeCapabilityAdapter & {
  surface: 'tools';
};

export type RuntimeCapabilityAdapterMap = Partial<
  Record<RuntimeCapabilitySurface, RuntimeCapabilityAdapter[]>
>;
