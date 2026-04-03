import 'server-only';

import type {
  MetricQueryRequest,
  MetricQueryResult,
  SemanticMetricDefinition,
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
  const timeKey = buildTimeDimensionKey(
    request.dateRange
      ? {
          dimension:
            definition.dateDimensions[request.dateRange.dimension] ??
            definition.dateDimensions[definition.defaultDateDimension]!,
          dateRange: [request.dateRange.from, request.dateRange.to],
          granularity: request.granularity,
        }
      : undefined,
  );

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
        value: parseNumber(row[definition.cubeMeasure]),
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

export function createCubeSemanticQueryAdapter(
  fetchImpl: FetchLike = fetch,
): SemanticQueryPort {
  const config = getCubeProviderConfig();

  return {
    async runMetricQuery(request) {
      const definition = getSemanticMetricDefinition(request.metric);

      if (!definition) {
        throw new CubeMetricQueryValidationError(
          `Unsupported semantic metric "${request.metric}".`,
        );
      }

      const query = buildCubeLoadQuery(request);
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

        return mapRows(
          request,
          definition,
          (await response.json()) as CubeResponsePayload,
        );
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
