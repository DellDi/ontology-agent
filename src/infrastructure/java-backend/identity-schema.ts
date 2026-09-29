import { z } from 'zod';

export const identityAccountSchema = z.strictObject({
  id: z.number().int().positive(),
  account: z.string(),
  displayName: z.string().nullable(),
  status: z.string(),
  source: z.string(),
  organizationId: z.string().nullable(),
  roles: z.array(z.string()),
  bindings: z.array(z.strictObject({
    sourceKey: z.string(),
    subjectKey: z.string(),
    value: z.string(),
  })),
});

export const identityAccountListSchema = z.strictObject({
  items: z.array(identityAccountSchema),
});

export type IdentityAccount = z.infer<typeof identityAccountSchema>;
