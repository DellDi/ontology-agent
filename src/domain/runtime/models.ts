import { z } from 'zod';

export const RUNTIME_CAPABILITY_SURFACES = [
  'memory',
  'knowledge',
  'skills',
  'tools',
] as const;

export type RuntimeCapabilitySurface =
  (typeof RUNTIME_CAPABILITY_SURFACES)[number];

export const RUNTIME_CAPABILITY_STATUSES = [
  'available',
  'disabled',
  'degraded',
  'unconfigured',
  'requires-confirmation',
] as const;

export type RuntimeCapabilityStatus =
  (typeof RUNTIME_CAPABILITY_STATUSES)[number];

export const RUNTIME_CAPABILITY_PROVENANCE_TYPES = [
  'provider',
  'registry',
  'prompt-registry',
  'tool-registry',
  'mcp-resource',
  'mcp-prompt',
  'retrieval-adapter',
  'worker-fact',
  'follow-up-history',
  'ontology-registry',
  'manual',
] as const;

export type RuntimeCapabilityProvenanceType =
  (typeof RUNTIME_CAPABILITY_PROVENANCE_TYPES)[number];

export const RUNTIME_APPROVAL_DECISIONS = [
  'pending',
  'approved',
  'denied',
  'requires-confirmation',
] as const;

export type RuntimeApprovalDecision =
  (typeof RUNTIME_APPROVAL_DECISIONS)[number];

export const runtimeCapabilitySurfaceSchema = z.enum(
  RUNTIME_CAPABILITY_SURFACES,
);

export const runtimeCapabilityStatusSchema = z.enum(
  RUNTIME_CAPABILITY_STATUSES,
);

export const runtimeCapabilityVersionSchema = z.object({
  schemaVersion: z.number().int().positive(),
  contractVersion: z.number().int().positive(),
  capabilityVersion: z.string().min(1).optional(),
});

export type RuntimeCapabilityVersion = z.infer<
  typeof runtimeCapabilityVersionSchema
>;

export const runtimeCapabilityProvenanceSchema = z.object({
  source: z.string().min(1),
  sourceType: z.enum(RUNTIME_CAPABILITY_PROVENANCE_TYPES),
  retrievedAt: z.string().min(1).optional(),
  authority: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
});

export type RuntimeCapabilityProvenance = z.infer<
  typeof runtimeCapabilityProvenanceSchema
>;

export const runtimeCapabilityOwnershipSchema = z.object({
  ownerType: z.enum(['platform', 'organization', 'user', 'provider']),
  ownerId: z.string().min(1).optional(),
  steward: z.string().min(1).optional(),
  visibility: z.enum(['platform', 'organization', 'user', 'system']),
});

export type RuntimeCapabilityOwnership = z.infer<
  typeof runtimeCapabilityOwnershipSchema
>;

export const runtimeCapabilityAvailabilitySchema = z.object({
  status: runtimeCapabilityStatusSchema,
  reasonCode: z.string().min(1).optional(),
  reason: z.string().min(1),
  checkedAt: z.string().min(1),
  retryable: z.boolean().optional(),
});

export type RuntimeCapabilityAvailability = z.infer<
  typeof runtimeCapabilityAvailabilitySchema
>;

export const runtimeCapabilityApprovalPolicySchema = z.object({
  required: z.boolean(),
  policyId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
});

export type RuntimeCapabilityApprovalPolicy = z.infer<
  typeof runtimeCapabilityApprovalPolicySchema
>;

export const runtimeCapabilityDescriptorSchema = z.object({
  id: z.string().min(1),
  surface: runtimeCapabilitySurfaceSchema,
  title: z.string().min(1),
  description: z.string().min(1).optional(),
  status: runtimeCapabilityStatusSchema,
  version: runtimeCapabilityVersionSchema,
  provenance: runtimeCapabilityProvenanceSchema,
  ownership: runtimeCapabilityOwnershipSchema,
  availability: runtimeCapabilityAvailabilitySchema,
  approval: runtimeCapabilityApprovalPolicySchema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RuntimeCapabilityDescriptor = z.infer<
  typeof runtimeCapabilityDescriptorSchema
>;

export const runtimeCapabilitySurfaceStateSchema = z.object({
  surface: runtimeCapabilitySurfaceSchema,
  status: runtimeCapabilityStatusSchema,
  reasonCode: z.string().min(1).optional(),
  reason: z.string().min(1),
  checkedAt: z.string().min(1),
  capabilityCount: z.number().int().nonnegative(),
});

export type RuntimeCapabilitySurfaceState = z.infer<
  typeof runtimeCapabilitySurfaceStateSchema
>;

export const runtimeCapabilityApprovalEnvelopeSchema = z.object({
  correlationId: z.string().min(1),
  actor: z.object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  }),
  target: z.object({
    surface: runtimeCapabilitySurfaceSchema,
    capabilityId: z.string().min(1),
    action: z.string().min(1),
  }),
  reason: z.string().min(1),
  decision: z.enum(RUNTIME_APPROVAL_DECISIONS),
  source: z.enum(['application', 'worker', 'system']),
  requestedAt: z.string().min(1),
  decidedAt: z.string().min(1).optional(),
  decidedBy: z
    .object({
      userId: z.string().min(1),
      organizationId: z.string().min(1).optional(),
    })
    .optional(),
  expiresAt: z.string().min(1).optional(),
});

export type RuntimeCapabilityApprovalEnvelope = z.infer<
  typeof runtimeCapabilityApprovalEnvelopeSchema
>;

export const runtimeCapabilityApprovalAuditEventSchema = z.object({
  correlationId: z.string().min(1),
  envelope: runtimeCapabilityApprovalEnvelopeSchema,
  recordedAt: z.string().min(1),
  eventType: z.enum([
    'approval.requested',
    'approval.approved',
    'approval.denied',
    'approval.requires-confirmation',
  ]),
  source: z.enum(['application', 'worker', 'system']),
});

export type RuntimeCapabilityApprovalAuditEvent = z.infer<
  typeof runtimeCapabilityApprovalAuditEventSchema
>;

export const runtimeCapabilityResumeTokenSchema = z.object({
  token: z.string().min(1),
  surface: runtimeCapabilitySurfaceSchema,
  capabilityId: z.string().min(1),
  checkpoint: z.string().min(1),
  issuedAt: z.string().min(1),
  provenance: runtimeCapabilityProvenanceSchema,
});

export type RuntimeCapabilityResumeToken = z.infer<
  typeof runtimeCapabilityResumeTokenSchema
>;

export type RuntimeCanonicalFactBoundary = {
  name:
    | 'execution-events'
    | 'execution-snapshots'
    | 'follow-up-history'
    | 'ontology-registry'
    | 'knowledge-governance'
    | 'permission-audit'
    | 'worker-orchestration';
  owner: string;
  mutableByRuntimeBridge: false;
  reason: string;
};

const runtimeDomainModule = {
  RUNTIME_APPROVAL_DECISIONS,
  RUNTIME_CAPABILITY_PROVENANCE_TYPES,
  RUNTIME_CAPABILITY_STATUSES,
  RUNTIME_CAPABILITY_SURFACES,
  runtimeCapabilityApprovalEnvelopeSchema,
  runtimeCapabilityApprovalAuditEventSchema,
  runtimeCapabilityApprovalPolicySchema,
  runtimeCapabilityAvailabilitySchema,
  runtimeCapabilityDescriptorSchema,
  runtimeCapabilityOwnershipSchema,
  runtimeCapabilityProvenanceSchema,
  runtimeCapabilityResumeTokenSchema,
  runtimeCapabilityStatusSchema,
  runtimeCapabilitySurfaceSchema,
  runtimeCapabilitySurfaceStateSchema,
  runtimeCapabilityVersionSchema,
};

export default runtimeDomainModule;
