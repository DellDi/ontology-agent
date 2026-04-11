export const DEFINITION_LIFECYCLE_STATES = [
  'draft',
  'review',
  'approved',
  'deprecated',
  'retired',
] as const;

export type DefinitionLifecycleState =
  (typeof DEFINITION_LIFECYCLE_STATES)[number];

export const ONTOLOGY_VERSION_STATUSES = [
  'draft',
  'review',
  'approved',
  'deprecated',
  'retired',
] as const;

export type OntologyVersionStatus = (typeof ONTOLOGY_VERSION_STATUSES)[number];

export type OntologyVersion = {
  id: string;
  semver: string;
  displayName: string;
  status: OntologyVersionStatus;
  description: string | null;
  publishedAt: string | null;
  deprecatedAt: string | null;
  retiredAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OntologyEntityDefinition = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  synonyms: string[];
  parentBusinessKey: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyMetricDefinition = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  applicableSubjectKeys: string[];
  defaultAggregation: string | null;
  unit: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyFactorDefinition = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  category: string;
  relatedMetricKeys: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyPlanStepTemplate = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  intentTypes: string[];
  requiredCapabilities: string[];
  sortOrder: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyRegistryDefinitions = {
  entities: OntologyEntityDefinition[];
  metrics: OntologyMetricDefinition[];
  factors: OntologyFactorDefinition[];
  planStepTemplates: OntologyPlanStepTemplate[];
};

export function isApprovedStatus(status: DefinitionLifecycleState): boolean {
  return status === 'approved';
}

export function isActiveForRuntime(status: DefinitionLifecycleState): boolean {
  return status === 'approved' || status === 'deprecated';
}
