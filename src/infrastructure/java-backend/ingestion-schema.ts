import { z } from 'zod';

const key = z.string().min(1);
const instant = z.iso.datetime({ offset: true });
const catalogStatus = z.enum(['active', 'disabled']);
const sourceVersion = z.strictObject({
  datasetKey: key,
  versionId: key,
  runId: key,
});

export const ingestionOverviewSchema = z.strictObject({
  scope: z.enum(['platform', 'organization']),
  runLimit: z.number().int().positive(),
  releaseLimit: z.number().int().positive(),
  sources: z.array(
    z.strictObject({ key, connectorType: key, status: catalogStatus }),
  ),
  datasets: z.array(
    z.strictObject({
      key,
      sourceKey: key,
      status: catalogStatus,
      schemaVersion: z.number().int().positive(),
    }),
  ),
  products: z.array(
    z.strictObject({
      key,
      domainKey: key,
      status: catalogStatus,
      datasetKeys: z.array(key),
    }),
  ),
  runs: z.array(
    z.strictObject({
      id: key,
      kind: z.enum(['source', 'product']),
      targetKey: key,
      mode: z.enum(['full', 'incremental', 'reconcile']),
      status: z.enum([
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ]),
      errorCode: key.nullable(),
      correlationId: key.nullable(),
      createdAt: instant,
      startedAt: instant.nullable(),
      finishedAt: instant.nullable(),
    }),
  ),
  releases: z.array(
    z.strictObject({
      id: key,
      status: z.enum(['draft', 'frozen', 'revoked']),
      capturedAt: instant,
      products: z.array(
        z.strictObject({
          key,
          versionId: key,
          status: z.enum(['building', 'published', 'failed', 'revoked']),
          rowCount: z.number().int().nonnegative(),
          runId: key,
          sources: z.array(sourceVersion),
        }),
      ),
    }),
  ),
});

export type IngestionOverview = z.infer<typeof ingestionOverviewSchema>;

export const ingestionReleaseTaskSchema = z.strictObject({
  id: key,
  sourceKey: key,
  productKeys: z.array(key).min(1),
  mode: z.enum(['full', 'incremental', 'reconcile']),
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  retryOf: key.nullable(),
  requestedBy: key,
  correlationId: key,
  errorCode: key.nullable(),
  createdAt: instant,
  startedAt: instant.nullable(),
  finishedAt: instant.nullable(),
});
export const ingestionReleaseTaskListSchema = z.strictObject({
  items: z.array(ingestionReleaseTaskSchema),
});
export type IngestionReleaseTask = z.infer<typeof ingestionReleaseTaskSchema>;

export const ingestionAccessSchema = z.strictObject({
  canView: z.boolean(),
  canManage: z.boolean(),
  sourceKeys: z.array(key),
  grants: z.array(
    z.strictObject({
      sourceKey: key,
      organizationId: key,
      grantedBy: key,
      grantedAt: instant,
    }),
  ),
});
export type IngestionAccess = z.infer<typeof ingestionAccessSchema>;
