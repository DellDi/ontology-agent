import type {
  OntologyCausalityEdge,
  OntologyEntityDefinition,
  OntologyEvidenceTypeDefinition,
  OntologyFactorDefinition,
  OntologyGovernanceDefinitions,
  OntologyMetricDefinition,
  OntologyMetricVariant,
  OntologyPlanStepTemplate,
  OntologyRegistryDefinitions,
  OntologyTimeSemantic,
  OntologyVersion,
} from '@/domain/ontology/models';
import { filterApprovedOnly } from '@/domain/ontology/models';

import type {
  CreateOntologyCausalityEdgeInput,
  CreateOntologyEntityDefinitionInput,
  CreateOntologyEvidenceTypeDefinitionInput,
  CreateOntologyFactorDefinitionInput,
  CreateOntologyMetricDefinitionInput,
  CreateOntologyMetricVariantInput,
  CreateOntologyPlanStepTemplateInput,
  CreateOntologyTimeSemanticInput,
  CreateOntologyVersionInput,
  OntologyCausalityEdgeStore,
  OntologyEntityDefinitionStore,
  OntologyEvidenceTypeDefinitionStore,
  OntologyFactorDefinitionStore,
  OntologyMetricDefinitionStore,
  OntologyMetricVariantStore,
  OntologyPlanStepTemplateStore,
  OntologyTimeSemanticStore,
  OntologyVersionStore,
} from './ports';

export type OntologyRegistryDeps = {
  versionStore: OntologyVersionStore;
  entityStore: OntologyEntityDefinitionStore;
  metricStore: OntologyMetricDefinitionStore;
  factorStore: OntologyFactorDefinitionStore;
  planStepStore: OntologyPlanStepTemplateStore;
};

export type OntologyGovernanceDeps = OntologyRegistryDeps & {
  metricVariantStore: OntologyMetricVariantStore;
  timeSemanticStore: OntologyTimeSemanticStore;
  causalityEdgeStore: OntologyCausalityEdgeStore;
  evidenceTypeStore: OntologyEvidenceTypeDefinitionStore;
};

export async function createOntologyVersion(
  deps: Pick<OntologyRegistryDeps, 'versionStore'>,
  input: CreateOntologyVersionInput,
): Promise<OntologyVersion> {
  return deps.versionStore.create(input);
}

export async function getCurrentApprovedVersion(
  deps: Pick<OntologyRegistryDeps, 'versionStore'>,
): Promise<OntologyVersion | null> {
  return deps.versionStore.findCurrentApproved();
}

export async function getOntologyVersionById(
  deps: Pick<OntologyRegistryDeps, 'versionStore'>,
  id: string,
): Promise<OntologyVersion | null> {
  return deps.versionStore.findById(id);
}

export type LoadDefinitionsInput = {
  ontologyVersionId: string;
  entities: CreateOntologyEntityDefinitionInput[];
  metrics: CreateOntologyMetricDefinitionInput[];
  factors: CreateOntologyFactorDefinitionInput[];
  planStepTemplates: CreateOntologyPlanStepTemplateInput[];
};

export type LoadDefinitionsResult = {
  entities: OntologyEntityDefinition[];
  metrics: OntologyMetricDefinition[];
  factors: OntologyFactorDefinition[];
  planStepTemplates: OntologyPlanStepTemplate[];
};

export async function loadOntologyDefinitions(
  deps: Omit<OntologyRegistryDeps, 'versionStore'>,
  input: LoadDefinitionsInput,
): Promise<LoadDefinitionsResult> {
  const [entities, metrics, factors, planStepTemplates] = await Promise.all([
    deps.entityStore.bulkCreate(input.entities),
    deps.metricStore.bulkCreate(input.metrics),
    deps.factorStore.bulkCreate(input.factors),
    deps.planStepStore.bulkCreate(input.planStepTemplates),
  ]);

  return { entities, metrics, factors, planStepTemplates };
}

export async function getDefinitionsByVersion(
  deps: Omit<OntologyRegistryDeps, 'versionStore'>,
  ontologyVersionId: string,
): Promise<OntologyRegistryDefinitions> {
  const [entities, metrics, factors, planStepTemplates] = await Promise.all([
    deps.entityStore.findByVersionId(ontologyVersionId),
    deps.metricStore.findByVersionId(ontologyVersionId),
    deps.factorStore.findByVersionId(ontologyVersionId),
    deps.planStepStore.findByVersionId(ontologyVersionId),
  ]);

  return { entities, metrics, factors, planStepTemplates };
}

export async function getCurrentApprovedDefinitions(
  deps: OntologyRegistryDeps,
): Promise<{ version: OntologyVersion; definitions: OntologyRegistryDefinitions } | null> {
  const version = await deps.versionStore.findCurrentApproved();

  if (!version) {
    return null;
  }

  const definitions = await getDefinitionsByVersion(deps, version.id);

  return { version, definitions };
}

export type LoadGovernanceDefinitionsInput = {
  ontologyVersionId: string;
  metricVariants: CreateOntologyMetricVariantInput[];
  timeSemantics: CreateOntologyTimeSemanticInput[];
  causalityEdges: CreateOntologyCausalityEdgeInput[];
  evidenceTypes: CreateOntologyEvidenceTypeDefinitionInput[];
};

export type LoadGovernanceDefinitionsResult = {
  metricVariants: OntologyMetricVariant[];
  timeSemantics: OntologyTimeSemantic[];
  causalityEdges: OntologyCausalityEdge[];
  evidenceTypes: OntologyEvidenceTypeDefinition[];
};

export async function loadGovernanceDefinitions(
  deps: Pick<OntologyGovernanceDeps, 'metricVariantStore' | 'timeSemanticStore' | 'causalityEdgeStore' | 'evidenceTypeStore'>,
  input: LoadGovernanceDefinitionsInput,
): Promise<LoadGovernanceDefinitionsResult> {
  const [metricVariants, timeSemantics, causalityEdges, evidenceTypes] = await Promise.all([
    deps.metricVariantStore.bulkCreate(input.metricVariants),
    deps.timeSemanticStore.bulkCreate(input.timeSemantics),
    deps.causalityEdgeStore.bulkCreate(input.causalityEdges),
    deps.evidenceTypeStore.bulkCreate(input.evidenceTypes),
  ]);

  return { metricVariants, timeSemantics, causalityEdges, evidenceTypes };
}

export async function getGovernanceDefinitionsByVersion(
  deps: Pick<OntologyGovernanceDeps, 'entityStore' | 'metricStore' | 'factorStore' | 'planStepStore' | 'metricVariantStore' | 'timeSemanticStore' | 'causalityEdgeStore' | 'evidenceTypeStore'>,
  ontologyVersionId: string,
): Promise<OntologyGovernanceDefinitions> {
  const [entities, metrics, factors, planStepTemplates, metricVariants, timeSemantics, causalityEdges, evidenceTypes] =
    await Promise.all([
      deps.entityStore.findByVersionId(ontologyVersionId),
      deps.metricStore.findByVersionId(ontologyVersionId),
      deps.factorStore.findByVersionId(ontologyVersionId),
      deps.planStepStore.findByVersionId(ontologyVersionId),
      deps.metricVariantStore.findByVersionId(ontologyVersionId),
      deps.timeSemanticStore.findByVersionId(ontologyVersionId),
      deps.causalityEdgeStore.findByVersionId(ontologyVersionId),
      deps.evidenceTypeStore.findByVersionId(ontologyVersionId),
    ]);

  return {
    entities,
    metrics,
    factors,
    planStepTemplates,
    metricVariants,
    timeSemantics,
    causalityEdges,
    evidenceTypes,
  };
}

export async function getApprovedGovernanceDefinitions(
  deps: OntologyGovernanceDeps,
): Promise<{ version: OntologyVersion; definitions: OntologyGovernanceDefinitions } | null> {
  const version = await deps.versionStore.findCurrentApproved();

  if (!version) {
    return null;
  }

  const all = await getGovernanceDefinitionsByVersion(deps, version.id);

  return {
    version,
    definitions: {
      entities: filterApprovedOnly(all.entities),
      metrics: filterApprovedOnly(all.metrics),
      factors: filterApprovedOnly(all.factors),
      planStepTemplates: filterApprovedOnly(all.planStepTemplates),
      metricVariants: filterApprovedOnly(all.metricVariants),
      timeSemantics: filterApprovedOnly(all.timeSemantics),
      causalityEdges: filterApprovedOnly(all.causalityEdges),
      evidenceTypes: filterApprovedOnly(all.evidenceTypes),
    },
  };
}
