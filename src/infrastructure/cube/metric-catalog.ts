import type {
  SemanticDateDimensionKey,
  SemanticMetricDefinition,
  SemanticMetricKey,
} from '@/application/semantic-query/models';
import { filterApprovedOnly } from '@/domain/ontology/models';
import type {
  OntologyGovernanceDefinitions,
  OntologyMetricVariant,
  OntologyTimeSemantic,
} from '@/domain/ontology/models';

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

const LEGACY_SEMANTIC_METRICS: readonly SemanticMetricDefinition[] = [
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

const GOVERNED_FINANCE_METRIC_KEYS = new Set<SemanticMetricKey>([
  'project-collection-rate',
  'project-receivable-amount',
  'project-paid-amount',
  'tail-arrears-collection-rate',
  'tail-arrears-receivable-amount',
  'tail-arrears-paid-amount',
]);

const METRIC_ALIASES: Partial<Record<SemanticMetricKey, SemanticMetricKey>> = {
  'collection-rate': 'project-collection-rate',
  'receivable-amount': 'project-receivable-amount',
  'paid-amount': 'project-paid-amount',
};

function isSemanticMetricKey(value: string): value is SemanticMetricKey {
  return LEGACY_SEMANTIC_METRICS.some((item) => item.key === value);
}

function isSemanticDateDimensionKey(
  value: string,
): value is SemanticDateDimensionKey {
  return [
    'business-date',
    'receivable-accounting-period',
    'billing-cycle-end-date',
    'payment-date',
    'created-at',
    'completed-at',
  ].includes(value);
}

function findLegacyMetric(key: SemanticMetricKey) {
  return LEGACY_SEMANTIC_METRICS.find((item) => item.key === key) ?? null;
}

function findGovernedTimeSemantic(
  timeSemantics: OntologyTimeSemantic[],
  businessKey: SemanticDateDimensionKey,
) {
  return timeSemantics.find((item) => item.businessKey === businessKey) ?? null;
}

function readStringRecordValue(
  record: Record<string, unknown> | null | undefined,
  key: string,
) {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function resolveGovernedCubeDimension(
  metricKey: SemanticMetricKey,
  dimensionKey: SemanticDateDimensionKey,
  timeSemantic: OntologyTimeSemantic | null,
  fallbackMember: string,
) {
  if (metricKey === 'project-paid-amount' && dimensionKey === 'receivable-accounting-period') {
    return 'FinancePayments.receivableAccountingPeriod';
  }

  if (metricKey === 'tail-arrears-paid-amount' && dimensionKey === 'billing-cycle-end-date') {
    return 'FinancePayments.billingCycleEndDate';
  }

  return (
    readStringRecordValue(timeSemantic?.cubeTimeDimensionMapping, 'cubeDimension') ??
    fallbackMember
  );
}

function resolveGovernedDefaultDateDimension(
  variant: OntologyMetricVariant,
  legacyMetric: SemanticMetricDefinition,
) {
  if (
    variant.businessKey === 'project-collection-rate' ||
    variant.businessKey === 'project-receivable-amount'
  ) {
    return 'receivable-accounting-period' as const;
  }

  if (
    variant.businessKey === 'tail-arrears-collection-rate' ||
    variant.businessKey === 'tail-arrears-receivable-amount'
  ) {
    return 'billing-cycle-end-date' as const;
  }

  if (
    variant.businessKey === 'project-paid-amount' ||
    variant.businessKey === 'tail-arrears-paid-amount'
  ) {
    return 'payment-date' as const;
  }

  return legacyMetric.defaultDateDimension;
}

function resolveGovernedDateDimensions(
  variant: OntologyMetricVariant,
  timeSemantics: OntologyTimeSemantic[],
  legacyMetric: SemanticMetricDefinition,
) {
  const metricKey = variant.businessKey as SemanticMetricKey;
  const dateDimensions = Object.entries(legacyMetric.dateDimensions).reduce<
    Partial<Record<SemanticDateDimensionKey, string>>
  >((acc, [dimensionKey, legacyMember]) => {
    if (!legacyMember || !isSemanticDateDimensionKey(dimensionKey)) {
      return acc;
    }

    const timeSemantic = findGovernedTimeSemantic(timeSemantics, dimensionKey);
    acc[dimensionKey] = resolveGovernedCubeDimension(
      metricKey,
      dimensionKey,
      timeSemantic,
      legacyMember,
    );
    return acc;
  }, {});

  return dateDimensions;
}

function projectMetricVariant(
  variant: OntologyMetricVariant,
  timeSemantics: OntologyTimeSemantic[],
): SemanticMetricDefinition | null {
  if (!isSemanticMetricKey(variant.businessKey)) {
    return null;
  }

  const legacyMetric = findLegacyMetric(variant.businessKey);

  if (!legacyMetric) {
    return null;
  }

  const cubeMeasure = readStringRecordValue(variant.cubeViewMapping, 'cubeMeasure');
  const numeratorMetricKey = readStringRecordValue(
    variant.cubeViewMapping,
    'numeratorMetricKey',
  );
  const denominatorMetricKey = readStringRecordValue(
    variant.cubeViewMapping,
    'denominatorMetricKey',
  );
  const formula =
    readStringRecordValue(variant.cubeViewMapping, 'formula') ?? legacyMetric.formula;
  const sourceFact =
    readStringRecordValue(variant.metadata, 'sourceFact') ?? legacyMetric.sourceFact;

  return {
    ...legacyMetric,
    title: variant.displayName,
    businessDefinition: variant.description ?? legacyMetric.businessDefinition,
    formula,
    sourceFact,
    cubeMeasure: cubeMeasure ?? legacyMetric.cubeMeasure,
    numeratorMetricKey:
      (numeratorMetricKey as SemanticMetricKey | null) ?? legacyMetric.numeratorMetricKey,
    denominatorMetricKey:
      (denominatorMetricKey as SemanticMetricKey | null) ??
      legacyMetric.denominatorMetricKey,
    defaultDateDimension: resolveGovernedDefaultDateDimension(variant, legacyMetric),
    dateDimensions: resolveGovernedDateDimensions(variant, timeSemantics, legacyMetric),
  } satisfies SemanticMetricDefinition;
}

export function buildGovernedSemanticMetrics(
  definitions: Pick<OntologyGovernanceDefinitions, 'metricVariants' | 'timeSemantics'>,
): SemanticMetricDefinition[] {
  const approvedVariants = filterApprovedOnly(definitions.metricVariants).filter((variant) =>
    GOVERNED_FINANCE_METRIC_KEYS.has(variant.businessKey as SemanticMetricKey),
  );
  const approvedTimeSemantics = filterApprovedOnly(definitions.timeSemantics);

  return approvedVariants
    .map((variant) => projectMetricVariant(variant, approvedTimeSemantics))
    .filter((metric): metric is SemanticMetricDefinition => Boolean(metric));
}

export function mergeGovernedSemanticMetrics(
  governedMetrics: SemanticMetricDefinition[],
) {
  const overriddenKeys = new Set(governedMetrics.map((metric) => metric.key));

  return [
    ...governedMetrics,
    ...LEGACY_SEMANTIC_METRICS.filter((metric) => !overriddenKeys.has(metric.key)),
  ];
}

export function listSemanticMetrics(
  catalog: readonly SemanticMetricDefinition[] = LEGACY_SEMANTIC_METRICS,
) {
  return [...catalog];
}

export function getSemanticMetricDefinition(
  key: SemanticMetricKey,
  catalog: readonly SemanticMetricDefinition[] = LEGACY_SEMANTIC_METRICS,
) {
  const resolvedKey = METRIC_ALIASES[key] ?? key;
  const metric = catalog.find((item) => item.key === resolvedKey) ?? null;

  if (!metric) {
    return null;
  }

  return key === resolvedKey ? metric : { ...metric, key };
}
