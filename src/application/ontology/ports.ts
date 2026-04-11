import type {
  OntologyEntityDefinition,
  OntologyFactorDefinition,
  OntologyMetricDefinition,
  OntologyPlanStepTemplate,
  OntologyVersion,
  OntologyVersionStatus,
} from '@/domain/ontology/models';

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
