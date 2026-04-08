import type {
  MetricFilter,
  MetricQueryRequest,
  SemanticMetricDefinition,
} from '@/application/semantic-query/models';

import { CubeMetricQueryValidationError } from './errors';
import { getSemanticMetricDefinition } from './metric-catalog';

type CubeFilter = {
  member: string;
  operator: 'equals' | 'gte' | 'lte';
  values: string[];
};

export type CubeTimeDimension = {
  dimension: string;
  dateRange: [string, string];
  granularity?: string;
};

export type CubeLoadQuery = {
  measures: string[];
  dimensions: string[];
  filters: CubeFilter[];
  timeDimensions: CubeTimeDimension[];
  limit?: number;
};

function assertValues(values: string[], message: string) {
  if (values.length === 0) {
    throw new CubeMetricQueryValidationError(message);
  }
}

function normalizeDateRanges(request: MetricQueryRequest) {
  if (request.dateRanges?.length) {
    return request.dateRanges;
  }

  return request.dateRange ? [request.dateRange] : [];
}

function mapFilter(
  definition: SemanticMetricDefinition,
  filter: MetricFilter,
): CubeFilter {
  const member = definition.dimensions[filter.dimension];

  if (!member) {
    throw new CubeMetricQueryValidationError(
      `Metric "${definition.key}" does not support dimension "${filter.dimension}".`,
    );
  }

  const values = filter.values.map((value) => value.trim()).filter(Boolean);
  assertValues(
    values,
    `Filter "${filter.dimension}" must contain at least one value.`,
  );

  return {
    member,
    operator: 'equals',
    values,
  };
}

export function buildCubeLoadQuery(request: MetricQueryRequest): CubeLoadQuery {
  const definition = getSemanticMetricDefinition(request.metric);

  if (!definition) {
    throw new CubeMetricQueryValidationError(
      `Unsupported semantic metric "${request.metric}".`,
    );
  }

  if (!definition.cubeMeasure) {
    throw new CubeMetricQueryValidationError(
      `Metric "${request.metric}" does not map to a single Cube measure.`,
    );
  }

  const groupBy = request.groupBy ?? [];
  const dimensions = groupBy.map((dimensionKey) => {
    const member = definition.dimensions[dimensionKey];

    if (!member) {
      throw new CubeMetricQueryValidationError(
        `Metric "${request.metric}" does not support group-by dimension "${dimensionKey}".`,
      );
    }

    return member;
  });

  const filters: CubeFilter[] = [
    {
      member: definition.scopeMembers.organization,
      operator: 'equals',
      values: [request.scope.organizationId],
    },
  ];

  if (request.scope.projectIds.length > 0 && definition.scopeMembers.project) {
    filters.push({
      member: definition.scopeMembers.project,
      operator: 'equals',
      values: request.scope.projectIds,
    });
  }

  if (request.filters?.length) {
    filters.push(...request.filters.map((filter) => mapFilter(definition, filter)));
  }

  const timeDimensions = normalizeDateRanges(request).map((dateRange) => {
    const member = definition.dateDimensions[dateRange.dimension];

    if (!member) {
      throw new CubeMetricQueryValidationError(
        `Metric "${request.metric}" does not support date dimension "${dateRange.dimension}".`,
      );
    }

    return {
      dimension: member,
      dateRange: [dateRange.from, dateRange.to],
      granularity: request.granularity,
    } satisfies CubeTimeDimension;
  });

  return {
    measures: [definition.cubeMeasure],
    dimensions,
    filters,
    timeDimensions,
    limit: request.limit,
  };
}
