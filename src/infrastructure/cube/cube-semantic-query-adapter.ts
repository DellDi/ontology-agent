import 'server-only';

import type {
  MetricDateRange,
  MetricQueryRequest,
  MetricQueryResult,
  MetricQueryRow,
  SemanticDateDimensionKey,
  SemanticMetricDefinition,
  SemanticMetricKey,
  SemanticQueryHealth,
} from '@/application/semantic-query/models';
import type { SemanticQueryPort } from '@/application/semantic-query/ports';

import {
  CubeMetricQueryValidationError,
  CubeProviderResponseError,
  CubeProviderTimeoutError,
  CubeProviderUnavailableError,
} from './errors';
import { getSemanticMetricDefinition, listSemanticMetrics } from './metric-catalog';
import { loadApprovedSemanticMetricCatalog } from './governed-metric-catalog';
import {
  buildCubeLoadQuery,
  type CubeTimeDimension,
} from './query-builder';
import { getCubeProviderConfig } from './config';

type FetchLike = typeof fetch;

type CubeResponsePayload = {
  data?: Record<string, unknown>[];
};

function buildTimeDimensionKey(
  timeDimension: CubeTimeDimension | undefined,
) {
  if (!timeDimension?.granularity) {
    return timeDimension?.dimension ?? null;
  }

  return `${timeDimension.dimension}.${timeDimension.granularity}`;
}

function normalizeDateRanges(request: MetricQueryRequest) {
  if (request.dateRanges?.length) {
    return request.dateRanges;
  }

  return request.dateRange ? [request.dateRange] : [];
}

function parseNumber(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function createAbortController(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

function mapRows(
  request: MetricQueryRequest,
  definition: SemanticMetricDefinition,
  payload: CubeResponsePayload,
): MetricQueryResult {
  const rows = payload.data ?? [];
  const requestDateRanges = normalizeDateRanges(request);
  const timeKey =
    requestDateRanges.length === 1
      ? buildTimeDimensionKey({
          dimension:
            definition.dateDimensions[requestDateRanges[0].dimension] ??
            definition.dateDimensions[definition.defaultDateDimension]!,
          dateRange: [requestDateRanges[0].from, requestDateRanges[0].to],
          granularity: request.granularity,
        })
      : null;

  return {
    metric: request.metric,
    rows: rows.map((row) => {
      const dimensions = Object.fromEntries(
        (request.groupBy ?? []).map((dimensionKey) => {
          const member = definition.dimensions[dimensionKey];
          return [dimensionKey, member ? String(row[member] ?? '') || null : null];
        }),
      );

      return {
        value: parseNumber(row[definition.cubeMeasure!]),
        time: timeKey ? String(row[timeKey] ?? '') || null : null,
        dimensions,
        raw: row,
      };
    }),
    raw: payload as Record<string, unknown>,
  };
}

async function readJsonResponse(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function roundPercentage(value: number) {
  return Number(value.toFixed(4));
}

function cloneRange(
  range: MetricDateRange,
  dimension: SemanticDateDimensionKey,
): MetricDateRange {
  return {
    ...range,
    dimension,
  };
}

function buildTailBillingRange(baseRange: MetricDateRange | null): MetricDateRange | null {
  if (!baseRange) {
    return null;
  }

  const searchYear = Number.parseInt(baseRange.to.slice(0, 4), 10);

  if (!Number.isFinite(searchYear)) {
    return null;
  }

  return {
    dimension: 'billing-cycle-end-date',
    from: '1900-01-01',
    to: `${String(searchYear).padStart(4, '0')}-01-31`,
  };
}

function withDateRanges(
  request: MetricQueryRequest,
  dateRanges: MetricDateRange[],
): MetricQueryRequest {
  return {
    ...request,
    dateRange: dateRanges[0],
    dateRanges: dateRanges.length > 1 ? dateRanges : undefined,
  };
}

function findRange(
  ranges: MetricDateRange[],
  dimension: SemanticDateDimensionKey,
) {
  return ranges.find((range) => range.dimension === dimension) ?? null;
}

function isMetric(
  key: SemanticMetricKey,
  expected: SemanticMetricKey[],
) {
  return expected.includes(key);
}

function normalizeFinanceMeasureRequest(
  request: MetricQueryRequest,
): MetricQueryRequest {
  const dateRanges = normalizeDateRanges(request);
  const baseRange = dateRanges.at(-1) ?? null;

  if (
    isMetric(request.metric, [
      'project-receivable-amount',
      'receivable-amount',
    ])
  ) {
    const receivableRange =
      findRange(dateRanges, 'receivable-accounting-period') ??
      findRange(dateRanges, 'business-date') ??
      findRange(dateRanges, 'payment-date') ??
      baseRange;

    return receivableRange
      ? withDateRanges(request, [
          cloneRange(receivableRange, 'receivable-accounting-period'),
        ])
      : request;
  }

  if (
    isMetric(request.metric, [
      'project-paid-amount',
      'paid-amount',
    ])
  ) {
    const receivableRange =
      findRange(dateRanges, 'receivable-accounting-period') ??
      findRange(dateRanges, 'business-date') ??
      baseRange;
    const paymentRange =
      findRange(dateRanges, 'payment-date') ??
      findRange(dateRanges, 'business-date') ??
      baseRange;

    return withDateRanges(
      request,
      [receivableRange, paymentRange]
        .filter((range): range is MetricDateRange => Boolean(range))
        .map((range, index) =>
          cloneRange(
            range,
            index === 0 ? 'receivable-accounting-period' : 'payment-date',
          ),
        ),
    );
  }

  if (request.metric === 'tail-arrears-receivable-amount') {
    const billingRange =
      findRange(dateRanges, 'billing-cycle-end-date') ??
      buildTailBillingRange(baseRange);

    return billingRange ? withDateRanges(request, [billingRange]) : request;
  }

  if (request.metric === 'tail-arrears-paid-amount') {
    const billingRange =
      findRange(dateRanges, 'billing-cycle-end-date') ??
      buildTailBillingRange(baseRange);
    const paymentRange =
      findRange(dateRanges, 'payment-date') ??
      findRange(dateRanges, 'business-date') ??
      baseRange;

    return withDateRanges(
      request,
      [billingRange, paymentRange].filter(
        (range): range is MetricDateRange => Boolean(range),
      ),
    );
  }

  return request;
}

function buildResultKey(row: MetricQueryRow) {
  return JSON.stringify(row.dimensions);
}

function combineRatioResults(input: {
  metric: SemanticMetricKey;
  numerator: MetricQueryResult;
  denominator: MetricQueryResult;
}): MetricQueryResult {
  const numeratorByKey = new Map(
    input.numerator.rows.map((row) => [buildResultKey(row), row]),
  );

  const rows = input.denominator.rows.flatMap((denominatorRow) => {
    const denominatorValue = denominatorRow.value ?? 0;

    if (denominatorValue <= 0) {
      return [];
    }

    const numeratorRow = numeratorByKey.get(buildResultKey(denominatorRow));
    const numeratorValue = numeratorRow?.value ?? 0;

    return [
      {
        value: roundPercentage((numeratorValue / denominatorValue) * 100),
        time: denominatorRow.time ?? numeratorRow?.time ?? null,
        dimensions: denominatorRow.dimensions,
        raw: {
          numerator: numeratorRow?.raw ?? null,
          denominator: denominatorRow.raw,
        },
      } satisfies MetricQueryRow,
    ];
  });

  return {
    metric: input.metric,
    rows,
    raw: {
      numerator: input.numerator.raw,
      denominator: input.denominator.raw,
    },
  };
}

export function createCubeSemanticQueryAdapter(
  fetchImpl: FetchLike = fetch,
): SemanticQueryPort {
  const config = getCubeProviderConfig();

  async function executeLoadQuery(query: ReturnType<typeof buildCubeLoadQuery>) {
    const { controller, clear } = createAbortController(config.timeoutMs);

    try {
      const response = await fetchImpl(`${config.apiUrl}/load`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: config.apiToken,
        },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = await readJsonResponse(response);
        throw new CubeProviderResponseError(
          `Cube load query failed with status ${response.status}.`,
          response.status,
          payload,
        );
      }

      return (await response.json()) as CubeResponsePayload;
    } catch (error) {
      if (error instanceof CubeProviderResponseError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new CubeProviderTimeoutError();
      }

      throw new CubeProviderUnavailableError(
        error instanceof Error ? error.message : 'Cube load query failed.',
      );
    } finally {
      clear();
    }
  }

  return {
    async runMetricQuery(request) {
      const runtimeCatalog = await loadApprovedSemanticMetricCatalog();
      const definition = getSemanticMetricDefinition(request.metric, runtimeCatalog);

      if (!definition) {
        throw new CubeMetricQueryValidationError(
          `Unsupported semantic metric "${request.metric}".`,
        );
      }

      if (definition.numeratorMetricKey && definition.denominatorMetricKey) {
        const numeratorRequest = normalizeFinanceMeasureRequest({
          ...request,
          metric: definition.numeratorMetricKey,
        });
        const denominatorRequest = normalizeFinanceMeasureRequest({
          ...request,
          metric: definition.denominatorMetricKey,
        });
        const numeratorDefinition = getSemanticMetricDefinition(
          numeratorRequest.metric,
          runtimeCatalog,
        );
        const denominatorDefinition = getSemanticMetricDefinition(
          denominatorRequest.metric,
          runtimeCatalog,
        );

        if (!numeratorDefinition?.cubeMeasure || !denominatorDefinition?.cubeMeasure) {
          throw new CubeMetricQueryValidationError(
            `Metric "${request.metric}" is missing concrete numerator or denominator cube measures.`,
          );
        }

        const [numeratorPayload, denominatorPayload] = await Promise.all([
          executeLoadQuery(buildCubeLoadQuery(numeratorRequest, numeratorDefinition)),
          executeLoadQuery(buildCubeLoadQuery(denominatorRequest, denominatorDefinition)),
        ]);

        return combineRatioResults({
          metric: request.metric,
          numerator: mapRows(
            numeratorRequest,
            numeratorDefinition,
            numeratorPayload,
          ),
          denominator: mapRows(
            denominatorRequest,
            denominatorDefinition,
            denominatorPayload,
          ),
        });
      }

      const normalizedRequest = normalizeFinanceMeasureRequest(request);
      const normalizedDefinition =
        getSemanticMetricDefinition(normalizedRequest.metric, runtimeCatalog) ?? definition;

      return mapRows(
        normalizedRequest,
        normalizedDefinition,
        await executeLoadQuery(
          buildCubeLoadQuery(normalizedRequest, normalizedDefinition),
        ),
      );
    },

    async checkHealth(): Promise<SemanticQueryHealth> {
      const startedAt = Date.now();
      const { controller, clear } = createAbortController(config.timeoutMs);

      try {
        const response = await fetchImpl(`${config.apiUrl}/meta`, {
          method: 'GET',
          headers: {
            Authorization: config.apiToken,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await readJsonResponse(response);
          throw new CubeProviderResponseError(
            `Cube health check failed with status ${response.status}.`,
            response.status,
            payload,
          );
        }

        return {
          ok: true,
          status: response.status,
          latencyMs: Date.now() - startedAt,
          checkedAt: new Date().toISOString(),
          apiUrl: config.apiUrl,
        };
      } catch (error) {
        if (error instanceof CubeProviderResponseError) {
          return {
            ok: false,
            status: error.status,
            latencyMs: Date.now() - startedAt,
            checkedAt: new Date().toISOString(),
            apiUrl: config.apiUrl,
          };
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new CubeProviderTimeoutError();
        }

        throw new CubeProviderUnavailableError(
          error instanceof Error ? error.message : 'Cube health check failed.',
        );
      } finally {
        clear();
      }
    },

    getMetricCatalog() {
      return listSemanticMetrics();
    },
  };
}
