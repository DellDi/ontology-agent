export const GRAPH_NODE_KINDS = [
  'organization',
  'project',
  'house',
  'owner',
  'charge-item',
  'receivable',
  'payment',
  'service-order',
  'complaint',
  'satisfaction',
] as const;

export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const GRAPH_EDGE_KINDS = [
  'contains',
  'belongs-to',
  'has-owner',
  'has-receivable',
  'has-payment',
  'has-service-order',
  'has-complaint',
  'has-satisfaction',
  'causal',
] as const;

export type GraphEdgeKind = (typeof GRAPH_EDGE_KINDS)[number];

export type GraphEdgeDirection = 'outbound' | 'inbound' | 'undirected';

export type GraphEvidenceSource =
  | 'erp-master-data'
  | 'erp-derived'
  | 'governed-rule';

export type GraphNodeReference = {
  kind: GraphNodeKind;
  id: string;
  label: string;
  properties?: Record<string, string | number | boolean | null>;
};

export type GraphEdgeReference = {
  kind: GraphEdgeKind;
  from: GraphNodeReference;
  to: GraphNodeReference;
  direction: GraphEdgeDirection;
  source: GraphEvidenceSource;
  explanation: string;
};

export type GraphCandidateFactor = {
  factorKey: string;
  factorLabel: string;
  relationType: GraphEdgeKind;
  direction: GraphEdgeDirection;
  source: GraphEvidenceSource;
  explanation: string;
};

export type GraphCandidateFactorQuery = {
  intentType:
    | 'fee-analysis'
    | 'work-order-analysis'
    | 'complaint-analysis'
    | 'satisfaction-analysis'
    | 'general-analysis';
  metric: string;
  entity: string;
  timeRange: string;
  questionText: string;
};

export type GraphSyncNode = GraphNodeReference;

export type GraphSyncEdge = {
  kind: GraphEdgeKind;
  fromKind: GraphNodeKind;
  fromId: string;
  toKind: GraphNodeKind;
  toId: string;
  direction: GraphEdgeDirection;
  source: GraphEvidenceSource;
  explanation: string;
};

export type GraphSyncBatch = {
  nodes: GraphSyncNode[];
  edges: GraphSyncEdge[];
};
