import type {
  SemanticMetricDefinition,
  SemanticMetricKey,
} from '@/application/semantic-query/models';

const SEMANTIC_METRICS: readonly SemanticMetricDefinition[] = [
  {
    key: 'collection-rate',
    title: '收缴率',
    businessDefinition: '按受治理口径统计的实收金额 / 应收金额。',
    formula: 'paid_amount / charge_sum',
    sourceFact: '收费主题（应收 + 实收）',
    cubeMeasure: 'Finance.collectionRate',
    defaultDateDimension: 'business-date',
    scopeMembers: {
      organization: 'Finance.organizationId',
      project: 'Finance.projectId',
    },
    dimensions: {
      'organization-id': 'Finance.organizationId',
      'project-id': 'Finance.projectId',
      'project-name': 'Finance.projectName',
      'charge-item-name': 'Finance.chargeItemName',
    },
    dateDimensions: {
      'business-date': 'Finance.businessDate',
    },
  },
  {
    key: 'receivable-amount',
    title: '应收金额',
    businessDefinition: '按受治理口径汇总的应收金额。',
    formula: 'sum(receivable_amount)',
    sourceFact: '应收主题',
    cubeMeasure: 'Finance.receivableAmount',
    defaultDateDimension: 'business-date',
    scopeMembers: {
      organization: 'Finance.organizationId',
      project: 'Finance.projectId',
    },
    dimensions: {
      'organization-id': 'Finance.organizationId',
      'project-id': 'Finance.projectId',
      'project-name': 'Finance.projectName',
      'charge-item-name': 'Finance.chargeItemName',
    },
    dateDimensions: {
      'business-date': 'Finance.businessDate',
    },
  },
  {
    key: 'paid-amount',
    title: '实收金额',
    businessDefinition: '按受治理口径汇总的实收金额。',
    formula: 'sum(paid_amount)',
    sourceFact: '实收主题',
    cubeMeasure: 'Finance.paidAmount',
    defaultDateDimension: 'business-date',
    scopeMembers: {
      organization: 'Finance.organizationId',
      project: 'Finance.projectId',
    },
    dimensions: {
      'organization-id': 'Finance.organizationId',
      'project-id': 'Finance.projectId',
      'project-name': 'Finance.projectName',
      'charge-item-name': 'Finance.chargeItemName',
    },
    dateDimensions: {
      'business-date': 'Finance.businessDate',
    },
  },
  {
    key: 'service-order-count',
    title: '工单总量',
    businessDefinition: '按受治理口径统计的工单数量。',
    formula: 'count(service_order_id)',
    sourceFact: '工单主题',
    cubeMeasure: 'ServiceOrders.count',
    defaultDateDimension: 'created-at',
    scopeMembers: {
      organization: 'ServiceOrders.organizationId',
      project: 'ServiceOrders.projectId',
    },
    dimensions: {
      'organization-id': 'ServiceOrders.organizationId',
      'project-id': 'ServiceOrders.projectId',
      'project-name': 'ServiceOrders.projectName',
      'service-style-name': 'ServiceOrders.serviceStyleName',
      'service-type-name': 'ServiceOrders.serviceTypeName',
    },
    dateDimensions: {
      'created-at': 'ServiceOrders.createdAt',
      'completed-at': 'ServiceOrders.completedAt',
    },
  },
  {
    key: 'complaint-count',
    title: '投诉量',
    businessDefinition: '从工单主题中按“投诉”语义切分的投诉数量。',
    formula: 'count(service_order_id where service_style_name = 投诉)',
    sourceFact: '工单主题（投诉子集）',
    cubeMeasure: 'ServiceOrders.complaintCount',
    defaultDateDimension: 'created-at',
    scopeMembers: {
      organization: 'ServiceOrders.organizationId',
      project: 'ServiceOrders.projectId',
    },
    dimensions: {
      'organization-id': 'ServiceOrders.organizationId',
      'project-id': 'ServiceOrders.projectId',
      'project-name': 'ServiceOrders.projectName',
      'service-style-name': 'ServiceOrders.serviceStyleName',
    },
    dateDimensions: {
      'created-at': 'ServiceOrders.createdAt',
      'completed-at': 'ServiceOrders.completedAt',
    },
  },
  {
    key: 'average-satisfaction',
    title: '平均满意度',
    businessDefinition:
      '按工单满意度字段 `satisfaction` 聚合出的平均满意度，并保留 `satisfactionEval` 作为客户评价满意度枚举语义。',
    formula: 'avg(satisfaction)',
    sourceFact: '工单主题（满意度派生）',
    cubeMeasure: 'ServiceOrders.averageSatisfaction',
    defaultDateDimension: 'completed-at',
    scopeMembers: {
      organization: 'ServiceOrders.organizationId',
      project: 'ServiceOrders.projectId',
    },
    dimensions: {
      'organization-id': 'ServiceOrders.organizationId',
      'project-id': 'ServiceOrders.projectId',
      'project-name': 'ServiceOrders.projectName',
      'service-style-name': 'ServiceOrders.serviceStyleName',
    },
    dateDimensions: {
      'created-at': 'ServiceOrders.createdAt',
      'completed-at': 'ServiceOrders.completedAt',
    },
  },
  {
    key: 'average-close-duration-hours',
    title: '平均关闭时长',
    businessDefinition: '工单从创建到完成的平均关闭时长（小时）。',
    formula: 'avg(completed_at - created_at)',
    sourceFact: '工单主题',
    cubeMeasure: 'ServiceOrders.averageCloseDurationHours',
    defaultDateDimension: 'completed-at',
    scopeMembers: {
      organization: 'ServiceOrders.organizationId',
      project: 'ServiceOrders.projectId',
    },
    dimensions: {
      'organization-id': 'ServiceOrders.organizationId',
      'project-id': 'ServiceOrders.projectId',
      'project-name': 'ServiceOrders.projectName',
      'service-style-name': 'ServiceOrders.serviceStyleName',
      'service-type-name': 'ServiceOrders.serviceTypeName',
    },
    dateDimensions: {
      'created-at': 'ServiceOrders.createdAt',
      'completed-at': 'ServiceOrders.completedAt',
    },
  },
  {
    key: 'average-response-duration-hours',
    title: '平均响应时长',
    businessDefinition: '工单从创建到首次响应的平均响应时长（小时）。',
    formula: 'avg(first_response_at - created_at)',
    sourceFact: '工单主题',
    cubeMeasure: 'ServiceOrders.averageResponseDurationHours',
    defaultDateDimension: 'created-at',
    scopeMembers: {
      organization: 'ServiceOrders.organizationId',
      project: 'ServiceOrders.projectId',
    },
    dimensions: {
      'organization-id': 'ServiceOrders.organizationId',
      'project-id': 'ServiceOrders.projectId',
      'project-name': 'ServiceOrders.projectName',
      'service-style-name': 'ServiceOrders.serviceStyleName',
      'service-type-name': 'ServiceOrders.serviceTypeName',
    },
    dateDimensions: {
      'created-at': 'ServiceOrders.createdAt',
      'completed-at': 'ServiceOrders.completedAt',
    },
  },
] as const;

export function listSemanticMetrics() {
  return [...SEMANTIC_METRICS];
}

export function getSemanticMetricDefinition(key: SemanticMetricKey) {
  return SEMANTIC_METRICS.find((metric) => metric.key === key) ?? null;
}
