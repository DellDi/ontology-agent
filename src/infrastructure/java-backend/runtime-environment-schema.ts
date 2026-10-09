import { z } from 'zod';

export const runtimeEnvironmentSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  label: z.string().min(1),
  kind: z.enum(['local', 'shared', 'production']),
  remoteDatabase: z.boolean(),
  database: z.strictObject({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    name: z.string().min(1),
  }).nullable(),
});
