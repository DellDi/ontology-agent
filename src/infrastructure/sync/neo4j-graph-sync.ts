import type {
  GraphSyncBatch,
  GraphSyncEdge,
  GraphSyncNode,
} from '@/domain/graph/models';

type SyncEntitySnapshot = {
  organizations?: { id: string; name: string }[];
  projects?: { id: string; name: string; organizationId: string }[];
  owners?: { ownerId: string; ownerName: string; projectId: string }[];
  chargeItems?: { id: string; name: string }[];
  receivables?: {
    recordId: string;
    projectId: string | null;
    chargeItemId: string | null;
  }[];
  payments?: {
    recordId: string;
    projectId: string | null;
    chargeItemId: string | null;
  }[];
  serviceOrders?: {
    id: string;
    projectId: string | null;
    isComplaint: boolean;
    hasSatisfaction: boolean;
  }[];
};

function uniqueNodes(nodes: GraphSyncNode[]) {
  return [
    ...new Map(nodes.map((node) => [`${node.kind}:${node.id}`, node])).values(),
  ];
}

function uniqueEdges(edges: GraphSyncEdge[]) {
  return [
    ...new Map(
      edges.map((edge) => [
        `${edge.kind}:${edge.fromKind}:${edge.fromId}:${edge.toKind}:${edge.toId}`,
        edge,
      ]),
    ).values(),
  ];
}

export function buildGraphSyncBatch(snapshot: SyncEntitySnapshot): GraphSyncBatch {
  const nodes: GraphSyncNode[] = [];
  const edges: GraphSyncEdge[] = [];

  for (const organization of snapshot.organizations ?? []) {
    nodes.push({
      kind: 'organization',
      id: organization.id,
      label: organization.name,
    });
  }

  for (const project of snapshot.projects ?? []) {
    nodes.push({
      kind: 'project',
      id: project.id,
      label: project.name,
    });
    edges.push({
      kind: 'contains',
      fromKind: 'organization',
      fromId: project.organizationId,
      toKind: 'project',
      toId: project.id,
      direction: 'outbound',
      source: 'erp-master-data',
      explanation: 'Organization -> Project',
    });
  }

  for (const owner of snapshot.owners ?? []) {
    nodes.push({
      kind: 'owner',
      id: owner.ownerId,
      label: owner.ownerName,
    });
    edges.push({
      kind: 'has-owner',
      fromKind: 'project',
      fromId: owner.projectId,
      toKind: 'owner',
      toId: owner.ownerId,
      direction: 'outbound',
      source: 'erp-master-data',
      explanation: 'Project -> Owner',
    });
  }

  for (const chargeItem of snapshot.chargeItems ?? []) {
    nodes.push({
      kind: 'charge-item',
      id: chargeItem.id,
      label: chargeItem.name,
    });
  }

  for (const receivable of snapshot.receivables ?? []) {
    nodes.push({
      kind: 'receivable',
      id: receivable.recordId,
      label: receivable.recordId,
    });
    if (receivable.projectId) {
      edges.push({
        kind: 'has-receivable',
        fromKind: 'project',
        fromId: receivable.projectId,
        toKind: 'receivable',
        toId: receivable.recordId,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'Project -> Receivable',
      });
    }
    if (receivable.chargeItemId) {
      edges.push({
        kind: 'belongs-to',
        fromKind: 'charge-item',
        fromId: receivable.chargeItemId,
        toKind: 'receivable',
        toId: receivable.recordId,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'ChargeItem -> Receivable',
      });
    }
  }

  for (const payment of snapshot.payments ?? []) {
    nodes.push({
      kind: 'payment',
      id: payment.recordId,
      label: payment.recordId,
    });
    if (payment.projectId) {
      edges.push({
        kind: 'has-payment',
        fromKind: 'project',
        fromId: payment.projectId,
        toKind: 'payment',
        toId: payment.recordId,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'Project -> Payment',
      });
    }
    if (payment.chargeItemId) {
      edges.push({
        kind: 'belongs-to',
        fromKind: 'charge-item',
        fromId: payment.chargeItemId,
        toKind: 'payment',
        toId: payment.recordId,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'ChargeItem -> Payment',
      });
    }
  }

  for (const serviceOrder of snapshot.serviceOrders ?? []) {
    nodes.push({
      kind: 'service-order',
      id: serviceOrder.id,
      label: serviceOrder.id,
    });
    if (serviceOrder.projectId) {
      edges.push({
        kind: 'has-service-order',
        fromKind: 'project',
        fromId: serviceOrder.projectId,
        toKind: 'service-order',
        toId: serviceOrder.id,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'Project -> ServiceOrder',
      });
    }
    if (serviceOrder.isComplaint) {
      nodes.push({
        kind: 'complaint',
        id: serviceOrder.id,
        label: `投诉:${serviceOrder.id}`,
      });
      edges.push({
        kind: 'has-complaint',
        fromKind: 'service-order',
        fromId: serviceOrder.id,
        toKind: 'complaint',
        toId: serviceOrder.id,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'ServiceOrder -> Complaint',
      });
    }
    if (serviceOrder.hasSatisfaction) {
      nodes.push({
        kind: 'satisfaction',
        id: serviceOrder.id,
        label: `满意度:${serviceOrder.id}`,
      });
      edges.push({
        kind: 'has-satisfaction',
        fromKind: 'service-order',
        fromId: serviceOrder.id,
        toKind: 'satisfaction',
        toId: serviceOrder.id,
        direction: 'outbound',
        source: 'erp-derived',
        explanation: 'ServiceOrder -> Satisfaction',
      });
    }
  }

  return {
    nodes: uniqueNodes(nodes),
    edges: uniqueEdges(edges),
  };
}

export function attachGraphSyncRuntimeMetadata(
  batch: GraphSyncBatch,
  runtime: {
    scopeOrgId: string;
    lastSeenRunId: string;
    lastSeenAt: string;
  },
): GraphSyncBatch {
  const sharedProperties = {
    scope_org_id: runtime.scopeOrgId,
    last_seen_run_id: runtime.lastSeenRunId,
    last_seen_at: runtime.lastSeenAt,
  };

  return {
    nodes: batch.nodes.map((node) => ({
      ...node,
      properties: {
        ...(node.properties ?? {}),
        ...sharedProperties,
      },
    })),
    edges: batch.edges.map((edge) => ({
      ...edge,
      properties: {
        ...(edge.properties ?? {}),
        ...sharedProperties,
      },
    })),
  };
}

export function buildNeo4jNodeSyncCypher() {
  return `
UNWIND $nodes AS node
MERGE (n:GraphNode {kind: node.kind, id: node.id})
SET n.label = node.label, n += coalesce(node.properties, {})
`;
}

export function buildNeo4jEdgeSyncCypher() {
  return `
UNWIND $edges AS edge
MATCH (from:GraphNode {kind: edge.fromKind, id: edge.fromId})
MATCH (to:GraphNode {kind: edge.toKind, id: edge.toId})
MERGE (from)-[r:GRAPH_EDGE {kind: edge.kind, toId: edge.toId, fromId: edge.fromId}]->(to)
SET r.direction = edge.direction,
    r.source = edge.source,
    r.explanation = edge.explanation,
    r += coalesce(edge.properties, {})
`;
}

export function buildNeo4jSyncCypher() {
  return `${buildNeo4jNodeSyncCypher()}\n${buildNeo4jEdgeSyncCypher()}`;
}

export function buildNeo4jScopedEdgeCleanupCypher() {
  return `
MATCH ()-[r:GRAPH_EDGE]->()
WHERE r.scope_org_id = $scopeOrgId
  AND r.last_seen_run_id <> $lastSeenRunId
DELETE r
`;
}

export function buildNeo4jScopedNodeCleanupCypher() {
  return `
MATCH (n:GraphNode)
WHERE n.scope_org_id = $scopeOrgId
  AND n.last_seen_run_id <> $lastSeenRunId
  AND n.kind IN ['organization', 'project', 'house', 'owner', 'charge-item', 'receivable', 'payment', 'service-order', 'complaint', 'satisfaction']
  AND NOT (n)--()
DELETE n
`;
}

export function buildNeo4jScopedCleanupCypher() {
  return `${buildNeo4jScopedEdgeCleanupCypher()}\n${buildNeo4jScopedNodeCleanupCypher()}`;
}

const graphSyncModule = {
  buildGraphSyncBatch,
  attachGraphSyncRuntimeMetadata,
  buildNeo4jNodeSyncCypher,
  buildNeo4jEdgeSyncCypher,
  buildNeo4jSyncCypher,
  buildNeo4jScopedEdgeCleanupCypher,
  buildNeo4jScopedNodeCleanupCypher,
  buildNeo4jScopedCleanupCypher,
};

export default graphSyncModule;
