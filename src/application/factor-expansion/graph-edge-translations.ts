import type { GraphEdgeKind, GraphEdgeDirection, GraphEvidenceSource } from '@/domain/graph/models';

const EDGE_KIND_LABELS: Record<GraphEdgeKind, string> = {
  'contains': '包含',
  'belongs-to': '所属',
  'has-owner': '业主关联',
  'has-receivable': '应收关联',
  'has-payment': '缴费关联',
  'has-service-order': '工单关联',
  'has-complaint': '投诉关联',
  'has-satisfaction': '满意度关联',
  'causal': '因果关系',
};

const DIRECTION_LABELS: Record<GraphEdgeDirection, string> = {
  'outbound': '外向',
  'inbound': '内向',
  'undirected': '无方向',
};

const SOURCE_LABELS: Record<GraphEvidenceSource, string> = {
  'erp-master-data': 'ERP 主数据',
  'erp-derived': 'ERP 派生',
  'governed-rule': '治理规则',
};

export function translateEdgeKind(kind: GraphEdgeKind | string): string {
  return EDGE_KIND_LABELS[kind as GraphEdgeKind] ?? kind;
}

export function translateDirection(direction: GraphEdgeDirection | string): string {
  return DIRECTION_LABELS[direction as GraphEdgeDirection] ?? direction;
}

export function translateEvidenceSource(source: GraphEvidenceSource | string): string {
  return SOURCE_LABELS[source as GraphEvidenceSource] ?? source;
}
