export type SemanticMetricKey =
  | 'collection-rate'
  | 'receivable-amount'
  | 'paid-amount'
  | 'service-order-count'
  | 'complaint-count'
  | 'average-satisfaction'
  | 'average-close-duration-hours'
  | 'average-response-duration-hours';

export type SemanticDimensionKey =
  | 'organization-id'
  | 'project-id'
  | 'project-name'
  | 'charge-item-name'
  | 'service-style-name'
  | 'service-type-name';

export type SemanticDateDimensionKey =
  | 'business-date'
  | 'created-at'
  | 'completed-at';

export type SemanticGranularity =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';

export type MetricQueryScope = {
  organizationId: string;
  projectIds: string[];
};

export type MetricDateRange = {
  dimension: SemanticDateDimensionKey;
  from: string;
  to: string;
};

export type MetricFilter = {
  dimension: SemanticDimensionKey;
  values: string[];
};

export type MetricQueryRequest = {
  metric: SemanticMetricKey;
  scope: MetricQueryScope;
  dateRange?: MetricDateRange;
  granularity?: SemanticGranularity;
  groupBy?: SemanticDimensionKey[];
  filters?: MetricFilter[];
  limit?: number;
};

export type MetricQueryRow = {
  value: number | null;
  time: string | null;
  dimensions: Record<string, string | null>;
  raw: Record<string, unknown>;
};

export type MetricQueryResult = {
  metric: SemanticMetricKey;
  rows: MetricQueryRow[];
  raw: Record<string, unknown>;
};

export type SemanticMetricDefinition = {
  key: SemanticMetricKey;
  title: string;
  businessDefinition: string;
  formula: string;
  sourceFact: string;
  cubeMeasure: string;
  defaultDateDimension: SemanticDateDimensionKey;
  scopeMembers: {
    organization: string;
    project?: string;
  };
  dimensions: Partial<Record<SemanticDimensionKey, string>>;
  dateDimensions: Partial<Record<SemanticDateDimensionKey, string>>;
  pendingConfirmation?: string[];
};

export type SemanticQueryHealth = {
  ok: boolean;
  status: number;
  latencyMs: number;
  checkedAt: string;
  apiUrl: string;
};

export type CubeProviderConfig = {
  apiUrl: string;
  apiToken: string;
  timeoutMs: number;
};
