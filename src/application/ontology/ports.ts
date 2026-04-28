import type {
  OntologyCausalityEdge,
  OntologyEntityDefinition,
  OntologyEvidenceTypeDefinition,
  OntologyFactorDefinition,
  OntologyMetricDefinition,
  OntologyMetricVariant,
  OntologyPlanStepTemplate,
  OntologyTimeSemantic,
  OntologyVersion,
  OntologyVersionStatus,
} from '@/domain/ontology/models';
import type {
  CreateToolCapabilityBindingInput,
  ToolCapabilityBinding,
} from '@/domain/ontology/tool-binding';

export type CreateOntologyVersionInput = {
  id: string;
  semver: string;
  displayName: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OntologyVersionStore = {
  create(input: CreateOntologyVersionInput): Promise<OntologyVersion>;
  findById(id: string): Promise<OntologyVersion | null>;
  findCurrentApproved(): Promise<OntologyVersion | null>;
  findCurrentPublished(): Promise<OntologyVersion | null>;
  listApprovedCandidates?(limit?: number): Promise<OntologyVersion[]>;
  listRecent?(limit?: number): Promise<OntologyVersion[]>;
  updateStatus(
    id: string,
    status: OntologyVersionStatus,
    updatedAt: string,
    timestamps?: {
      publishedAt?: string | null;
      deprecatedAt?: string | null;
      retiredAt?: string | null;
    },
  ): Promise<OntologyVersion>;
};

export type CreateOntologyEntityDefinitionInput = Omit<
  OntologyEntityDefinition,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyEntityDefinitionStore = {
  bulkCreate(
    items: CreateOntologyEntityDefinitionInput[],
  ): Promise<OntologyEntityDefinition[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyEntityDefinition[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyEntityDefinition | null>;
};

export type CreateOntologyMetricDefinitionInput = Omit<
  OntologyMetricDefinition,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyMetricDefinitionStore = {
  bulkCreate(
    items: CreateOntologyMetricDefinitionInput[],
  ): Promise<OntologyMetricDefinition[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyMetricDefinition[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyMetricDefinition | null>;
};

export type CreateOntologyFactorDefinitionInput = Omit<
  OntologyFactorDefinition,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyFactorDefinitionStore = {
  bulkCreate(
    items: CreateOntologyFactorDefinitionInput[],
  ): Promise<OntologyFactorDefinition[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyFactorDefinition[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyFactorDefinition | null>;
};

export type CreateOntologyPlanStepTemplateInput = Omit<
  OntologyPlanStepTemplate,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyPlanStepTemplateStore = {
  bulkCreate(
    items: CreateOntologyPlanStepTemplateInput[],
  ): Promise<OntologyPlanStepTemplate[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyPlanStepTemplate[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyPlanStepTemplate | null>;
};

export type CreateOntologyMetricVariantInput = Omit<
  OntologyMetricVariant,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyMetricVariantStore = {
  bulkCreate(
    items: CreateOntologyMetricVariantInput[],
  ): Promise<OntologyMetricVariant[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyMetricVariant[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyMetricVariant | null>;
  findByParentMetric(
    ontologyVersionId: string,
    parentMetricDefinitionId: string,
  ): Promise<OntologyMetricVariant[]>;
};

export type CreateOntologyTimeSemanticInput = Omit<
  OntologyTimeSemantic,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyTimeSemanticStore = {
  bulkCreate(
    items: CreateOntologyTimeSemanticInput[],
  ): Promise<OntologyTimeSemantic[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyTimeSemantic[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyTimeSemantic | null>;
};

export type CreateOntologyCausalityEdgeInput = Omit<
  OntologyCausalityEdge,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyCausalityEdgeStore = {
  bulkCreate(
    items: CreateOntologyCausalityEdgeInput[],
  ): Promise<OntologyCausalityEdge[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyCausalityEdge[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyCausalityEdge | null>;
  findAttributionPaths(
    ontologyVersionId: string,
  ): Promise<OntologyCausalityEdge[]>;
};

export type CreateOntologyEvidenceTypeDefinitionInput = Omit<
  OntologyEvidenceTypeDefinition,
  'createdAt' | 'updatedAt'
> & { createdAt: string; updatedAt: string };

export type OntologyEvidenceTypeDefinitionStore = {
  bulkCreate(
    items: CreateOntologyEvidenceTypeDefinitionInput[],
  ): Promise<OntologyEvidenceTypeDefinition[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<OntologyEvidenceTypeDefinition[]>;
  findByVersionAndKey(
    ontologyVersionId: string,
    businessKey: string,
  ): Promise<OntologyEvidenceTypeDefinition | null>;
};

export type OntologyToolCapabilityBindingStore = {
  bulkCreate(
    items: CreateToolCapabilityBindingInput[],
  ): Promise<ToolCapabilityBinding[]>;
  findByVersionId(
    ontologyVersionId: string,
  ): Promise<ToolCapabilityBinding[]>;
};
