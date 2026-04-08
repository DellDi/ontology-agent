import type {
  SemanticMetricDefinition,
  SemanticMetricKey,
} from '@/application/semantic-query/models';

const PROJECT_SCOPE_MEMBERS = {
  organization: 'FinanceReceivables.organizationId',
  project: 'FinanceReceivables.projectId',
} as const;

const PAYMENT_SCOPE_MEMBERS = {
  organization: 'FinancePayments.organizationId',
  project: 'FinancePayments.projectId',
} as const;

const PROJECT_DIMENSIONS = {
  'organization-id': 'FinanceReceivables.organizationId',
  'project-id': 'FinanceReceivables.projectId',
  'project-name': 'FinanceReceivables.projectName',
  'charge-item-name': 'FinanceReceivables.chargeItemName',
} as const;

const PAYMENT_DIMENSIONS = {
  'organization-id': 'FinancePayments.organizationId',
  'project-id': 'FinancePayments.projectId',
  'project-name': 'FinancePayments.projectName',
  'charge-item-name': 'FinancePayments.chargeItemName',
} as const;

const SERVICE_ORDER_DIMENSIONS = {
  'organization-id': 'ServiceOrders.organizationId',
  'project-id': 'ServiceOrders.projectId',
  'project-name': 'ServiceOrders.projectName',
  'service-style-name': 'ServiceOrders.serviceStyleName',
  'service-type-name': 'ServiceOrders.serviceTypeName',
} as const;

const SEMANTIC_METRICS: readonly SemanticMetricDefinition[] = [
  {
    key: 'project-collection-rate',
    title: '项目口径收缴率',
    businessDefinition:
      '项目口径下，年实收 / 年应收 × 100。应收按应收账期圈定，实收按缴款日期统计。',
    formula: 'project-paid-amount / project-receivable-amount * 100',
    sourceFact: '应收主题 + 缴款主题（项目口径）',
    numeratorMetricKey: 'project-paid-amount',
    denominatorMetricKey: 'project-receivable-amount',
    defaultDateDimension: 'receivable-accounting-period',
    scopeMembers: PROJECT_SCOPE_MEMBERS,
    dimensions: PROJECT_DIMENSIONS,
    dateDimensions: {
      'receivable-accounting-period':
        'FinanceReceivables.receivableAccountingPeriod',
      'payment-date': 'FinancePayments.paymentDate',
    },
  },
  {
    key: 'project-receivable-amount',
    title: '项目口径应收金额',
    businessDefinition:
      '项目口径下的应收金额，按应收账期 shouldAccountBook 归属到当年全年账单。',
    formula: 'sum(actual_charge_sum)',
    sourceFact: '应收主题（项目口径）',
    cubeMeasure: 'FinanceReceivables.receivableAmount',
    defaultDateDimension: 'receivable-accounting-period',
    scopeMembers: PROJECT_SCOPE_MEMBERS,
    dimensions: PROJECT_DIMENSIONS,
    dateDimensions: {
      'receivable-accounting-period':
        'FinanceReceivables.receivableAccountingPeriod',
    },
  },
  {
    key: 'project-paid-amount',
    title: '项目口径实收金额',
    businessDefinition:
      '项目口径下的实收金额，按应收账期圈定应收 cohort，再按缴款日期统计 chargePaid。',
    formula: 'sum(charge_paid)',
    sourceFact: '缴款主题（项目口径）',
    cubeMeasure: 'FinancePayments.paidAmount',
    defaultDateDimension: 'payment-date',
    scopeMembers: PAYMENT_SCOPE_MEMBERS,
    dimensions: PAYMENT_DIMENSIONS,
    dateDimensions: {
      'receivable-accounting-period':
        'FinancePayments.receivableAccountingPeriod',
      'payment-date': 'FinancePayments.paymentDate',
    },
  },
  {
    key: 'tail-arrears-collection-rate',
    title: '尾欠口径收缴率',
    businessDefinition:
      '尾欠口径下，年实收 / 年应收 × 100。应收按历史尾欠 cohort 圈定，实收按缴款日期统计。',
    formula: 'tail-arrears-paid-amount / tail-arrears-receivable-amount * 100',
    sourceFact: '应收主题 + 缴款主题（尾欠口径）',
    numeratorMetricKey: 'tail-arrears-paid-amount',
    denominatorMetricKey: 'tail-arrears-receivable-amount',
    defaultDateDimension: 'billing-cycle-end-date',
    scopeMembers: PROJECT_SCOPE_MEMBERS,
    dimensions: PROJECT_DIMENSIONS,
    dateDimensions: {
      'billing-cycle-end-date': 'FinanceReceivables.billingCycleEndDate',
      'payment-date': 'FinancePayments.paymentDate',
    },
  },
  {
    key: 'tail-arrears-receivable-amount',
    title: '尾欠口径应收金额',
    businessDefinition:
      '尾欠口径下的历史尾欠应收金额，按 calcEndDate / calcEndYear 圈定跨年未收账单。',
    formula: 'sum(actual_charge_sum)',
    sourceFact: '应收主题（尾欠口径）',
    cubeMeasure: 'FinanceReceivables.receivableAmount',
    defaultDateDimension: 'billing-cycle-end-date',
    scopeMembers: PROJECT_SCOPE_MEMBERS,
    dimensions: PROJECT_DIMENSIONS,
    dateDimensions: {
      'billing-cycle-end-date': 'FinanceReceivables.billingCycleEndDate',
    },
  },
  {
    key: 'tail-arrears-paid-amount',
    title: '尾欠口径实收金额',
    businessDefinition:
      '尾欠口径下的实收金额，按历史尾欠应收 cohort 圈定，再按缴款日期统计 chargePaid。',
    formula: 'sum(charge_paid)',
    sourceFact: '缴款主题（尾欠口径）',
    cubeMeasure: 'FinancePayments.paidAmount',
    defaultDateDimension: 'payment-date',
    scopeMembers: PAYMENT_SCOPE_MEMBERS,
    dimensions: PAYMENT_DIMENSIONS,
    dateDimensions: {
      'billing-cycle-end-date': 'FinancePayments.billingCycleEndDate',
      'payment-date': 'FinancePayments.paymentDate',
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
    dimensions: SERVICE_ORDER_DIMENSIONS,
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
    dimensions: SERVICE_ORDER_DIMENSIONS,
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
    dimensions: SERVICE_ORDER_DIMENSIONS,
    dateDimensions: {
      'created-at': 'ServiceOrders.createdAt',
      'completed-at': 'ServiceOrders.completedAt',
    },
  },
] as const;

const METRIC_ALIASES: Partial<Record<SemanticMetricKey, SemanticMetricKey>> = {
  'collection-rate': 'project-collection-rate',
  'receivable-amount': 'project-receivable-amount',
  'paid-amount': 'project-paid-amount',
};

export function listSemanticMetrics() {
  return [...SEMANTIC_METRICS];
}

export function getSemanticMetricDefinition(key: SemanticMetricKey) {
  const resolvedKey = METRIC_ALIASES[key] ?? key;
  const metric = SEMANTIC_METRICS.find((item) => item.key === resolvedKey) ?? null;

  if (!metric) {
    return null;
  }

  return key === resolvedKey ? metric : { ...metric, key };
}
