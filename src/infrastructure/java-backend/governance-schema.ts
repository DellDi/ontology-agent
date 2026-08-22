import { z } from 'zod';

const instant = z.iso.datetime({ offset: true });
const jsonObject = z.record(z.string(), z.unknown());
const nullableJsonObject = jsonObject.nullable();
const definitionStatus = z.enum(['draft', 'review', 'approved', 'deprecated', 'retired']);

const databaseDefinitionSchema = z.strictObject({
  id: z.string().min(1),
  ontologyVersionId: z.string().min(1),
  businessKey: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().nullable(),
  status: definitionStatus,
  fields: jsonObject,
  createdAt: instant,
  updatedAt: instant,
});

export const governanceCapabilitiesSchema = z.strictObject({
  canView: z.boolean(),
  canAuthor: z.boolean(),
  canReview: z.boolean(),
  canPublish: z.boolean(),
});

export const ontologyVersionSchema = z.strictObject({
  id: z.string().min(1),
  semver: z.string().min(1),
  displayName: z.string().min(1),
  status: z.enum(['draft', 'review', 'approved', 'deprecated', 'retired']),
  description: z.string().nullable(),
  publishedAt: instant.nullable(),
  deprecatedAt: instant.nullable(),
  retiredAt: instant.nullable(),
  createdBy: z.string().min(1),
  createdAt: instant,
  updatedAt: instant,
});

export const ontologyChangeRequestSchema = z.strictObject({
  id: z.string().min(1),
  ontologyVersionId: z.string().min(1),
  targetObjectType: z.enum([
    'entity_definition',
    'metric_definition',
    'metric_variant',
    'factor_definition',
    'causality_edge',
    'plan_step_template',
    'tool_capability_binding',
    'time_semantic',
    'evidence_type_definition',
  ]),
  targetObjectKey: z.string().min(1),
  changeType: z.enum(['create', 'update', 'deprecate', 'retire']),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'published', 'superseded']),
  title: z.string().min(1),
  description: z.string().nullable(),
  beforeSummary: nullableJsonObject,
  afterSummary: nullableJsonObject,
  impactScope: z.array(z.string().min(1)),
  compatibilityType: z.enum(['backward_compatible', 'breaking']),
  compatibilityNote: z.string().nullable(),
  submittedBy: z.string().min(1),
  submittedAt: instant.nullable(),
  createdAt: instant,
  updatedAt: instant,
});

export const ontologyApprovalRecordSchema = z.strictObject({
  id: z.string().min(1),
  changeRequestId: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  reviewedBy: z.string().min(1),
  comment: z.string().nullable(),
  createdAt: instant,
});

export const ontologyPublishRecordSchema = z.strictObject({
  id: z.string().min(1),
  ontologyVersionId: z.string().min(1),
  publishedBy: z.string().min(1),
  previousVersionId: z.string().nullable(),
  changeRequestIds: z.array(z.string().min(1)),
  publishNote: z.string().nullable(),
  createdAt: instant,
});

export const governanceOverviewSchema = z.strictObject({
  currentPublishedVersion: ontologyVersionSchema.nullable(),
  latestApprovedVersion: ontologyVersionSchema.nullable(),
  pendingReviewCount: z.number().int().nonnegative(),
  approvedAwaitingPublishCount: z.number().int().nonnegative(),
  recentChangeRequests: z.array(ontologyChangeRequestSchema),
  recentPublishes: z.array(ontologyPublishRecordSchema),
  capabilities: governanceCapabilitiesSchema,
});

export const governanceVersionListSchema = z.strictObject({
  items: z.array(ontologyVersionSchema),
  capabilities: governanceCapabilitiesSchema,
});

export const governanceDefinitionsSchema = z.strictObject({
  version: ontologyVersionSchema,
  entities: z.array(databaseDefinitionSchema),
  metrics: z.array(databaseDefinitionSchema),
  metricVariants: z.array(databaseDefinitionSchema),
  factors: z.array(databaseDefinitionSchema),
  causalityEdges: z.array(databaseDefinitionSchema),
  planStepTemplates: z.array(databaseDefinitionSchema),
  toolBindings: z.array(databaseDefinitionSchema),
  timeSemantics: z.array(databaseDefinitionSchema),
  evidenceTypes: z.array(databaseDefinitionSchema),
  capabilities: governanceCapabilitiesSchema,
});

export const governanceChangeRequestListSchema = z.strictObject({
  items: z.array(ontologyChangeRequestSchema),
  capabilities: governanceCapabilitiesSchema,
});

export const governanceChangeRequestDetailSchema = z.strictObject({
  changeRequest: ontologyChangeRequestSchema,
  approvals: z.array(ontologyApprovalRecordSchema),
  capabilities: governanceCapabilitiesSchema,
});

export const governanceReviewResultSchema = z.strictObject({
  changeRequest: ontologyChangeRequestSchema,
  approvalRecord: ontologyApprovalRecordSchema,
});

export const governancePublishHistorySchema = z.strictObject({
  items: z.array(ontologyPublishRecordSchema),
  capabilities: governanceCapabilitiesSchema,
});

export type JavaGovernanceOverview = z.infer<typeof governanceOverviewSchema>;
export type JavaGovernanceDefinitions = z.infer<typeof governanceDefinitionsSchema>;
export type JavaGovernanceChangeRequestList = z.infer<typeof governanceChangeRequestListSchema>;
export type JavaGovernanceChangeRequestDetail = z.infer<typeof governanceChangeRequestDetailSchema>;
export type JavaGovernancePublishHistory = z.infer<typeof governancePublishHistorySchema>;
