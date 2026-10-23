import { z } from 'zod';

const key = z.string().min(1);
const count = z.number().int().nonnegative();
const instant = z.iso.datetime({ offset: true });
const version = z.strictObject({ id: key, capturedAt: instant });
const taskReference = z.strictObject({ objectKey: z.literal('easyv-forge-task'), objectId: key, productVersionId: key });
const applicationReference = z.strictObject({ objectKey: z.literal('easyv-ai-application'), objectId: key, productVersionId: key });
export const failureInspectionSchema = z.strictObject({
  current: version,
  baseline: version.nullable(),
  scopeLabel: key,
  summary: z.strictObject({
    totalFailures: count,
    changedToFailed: count,
    firstVisibleFailures: count,
    failedInBoth: count,
    withoutBaseline: count,
    repeatedApplications: count,
  }),
  repeatedApplications: z.array(z.strictObject({ reference: applicationReference, failureCount: z.number().int().min(2) })).max(10),
  failures: z.array(z.strictObject({
    reference: taskReference,
    application: applicationReference,
    reason: z.string().nullable(),
    createdAt: instant.nullable(),
    finishedAt: instant.nullable(),
    previousStatus: key.nullable(),
    change: z.enum(['CHANGED_TO_FAILED', 'FIRST_VISIBLE_FAILURE', 'FAILED_IN_BOTH', 'NO_BASELINE']),
  })).max(50),
  offset: count.max(10000),
  limit: z.literal(50),
  hasMore: z.boolean(),
});
export type FailureInspection = z.infer<typeof failureInspectionSchema>;
