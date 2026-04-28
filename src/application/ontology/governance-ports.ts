import type {
  ChangeRequestStatus,
  OntologyApprovalRecord,
  OntologyChangeRequest,
  OntologyPublishRecord,
  ApprovalDecision,
} from '@/domain/ontology/governance';

export type CreateChangeRequestInput = {
  id: string;
  ontologyVersionId: string;
  targetObjectType: string;
  targetObjectKey: string;
  changeType: string;
  title: string;
  description?: string | null;
  beforeSummary?: Record<string, unknown> | null;
  afterSummary?: Record<string, unknown> | null;
  impactScope: string[];
  compatibilityType: string;
  compatibilityNote?: string | null;
  submittedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type OntologyChangeRequestStore = {
  create(input: CreateChangeRequestInput): Promise<OntologyChangeRequest>;
  findById(id: string): Promise<OntologyChangeRequest | null>;
  updateStatus(
    id: string,
    status: ChangeRequestStatus,
    updatedAt: string,
    submittedAt?: string | null,
  ): Promise<OntologyChangeRequest>;
  findByVersionId(ontologyVersionId: string): Promise<OntologyChangeRequest[]>;
  findByStatus(status: ChangeRequestStatus): Promise<OntologyChangeRequest[]>;
  findByVersionAndStatus(
    ontologyVersionId: string,
    status: ChangeRequestStatus,
  ): Promise<OntologyChangeRequest[]>;
  listRecent(limit?: number): Promise<OntologyChangeRequest[]>;
};

export type CreateApprovalRecordInput = {
  id: string;
  changeRequestId: string;
  decision: ApprovalDecision;
  reviewedBy: string;
  comment?: string | null;
  createdAt: string;
};

export type OntologyApprovalRecordStore = {
  create(input: CreateApprovalRecordInput): Promise<OntologyApprovalRecord>;
  findByChangeRequestId(changeRequestId: string): Promise<OntologyApprovalRecord[]>;
};

export type CreatePublishRecordInput = {
  id: string;
  ontologyVersionId: string;
  publishedBy: string;
  previousVersionId?: string | null;
  changeRequestIds: string[];
  publishNote?: string | null;
  createdAt: string;
};

export type OntologyPublishRecordStore = {
  create(input: CreatePublishRecordInput): Promise<OntologyPublishRecord>;
  findByVersionId(ontologyVersionId: string): Promise<OntologyPublishRecord[]>;
  findLatest(): Promise<OntologyPublishRecord | null>;
  listRecent(limit?: number): Promise<OntologyPublishRecord[]>;
};
