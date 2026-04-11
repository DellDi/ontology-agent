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

export type OntologyMetricVariant = {
  id: string;
  ontologyVersionId: string;
  parentMetricDefinitionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  semanticDiscriminator: string;
  cubeViewMapping: Record<string, unknown>;
  filterTemplate: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyTimeSemantic = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  semanticType: string;
  entityDateFieldMapping: Record<string, unknown>;
  cubeTimeDimensionMapping: Record<string, unknown> | null;
  calculationRule: Record<string, unknown> | null;
  defaultGranularity: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyCausalityEdge = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  sourceEntityKey: string;
  targetEntityKey: string;
  causalityType: string;
  isAttributionPathEnabled: boolean;
  defaultWeight: Record<string, unknown>;
  neo4jRelationshipTypes: string[];
  temporalConstraints: Record<string, unknown> | null;
  filterConditions: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type OntologyEvidenceTypeDefinition = {
  id: string;
  ontologyVersionId: string;
  businessKey: string;
  displayName: string;
  description: string | null;
  status: DefinitionLifecycleState;
  evidenceCategory: string;
  rendererConfig: Record<string, unknown>;
  dataSourceConfig: Record<string, unknown>;
  defaultPriority: string | null;
  isInteractive: boolean;
  templateSchema: Record<string, unknown> | null;
  validationRules: unknown[];
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

export type OntologyGovernanceDefinitions = OntologyRegistryDefinitions & {
  metricVariants: OntologyMetricVariant[];
  timeSemantics: OntologyTimeSemantic[];
  causalityEdges: OntologyCausalityEdge[];
  evidenceTypes: OntologyEvidenceTypeDefinition[];
};

export function isApprovedStatus(status: DefinitionLifecycleState): boolean {
  return status === 'approved';
}

export function isActiveForRuntime(status: DefinitionLifecycleState): boolean {
  return status === 'approved' || status === 'deprecated';
}

export function filterApprovedOnly<T extends { status: DefinitionLifecycleState }>(items: T[]): T[] {
  return items.filter((item) => isApprovedStatus(item.status));
}
