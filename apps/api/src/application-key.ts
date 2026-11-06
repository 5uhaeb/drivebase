import { z } from 'zod';
import { seal, unseal, type User } from './store.js';
import { credentialUserSchema } from './session.js';

const schema = z.object({
  version: z.literal(1),
  purpose: z.literal('database-application'),
  user: credentialUserSchema,
  catalogId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  databaseId: z.string().uuid(),
  keyId: z.string().min(32).max(100),
  expires: z.number().int().positive(),
});
export type ApplicationKey = z.infer<typeof schema>;
export function encodeApplicationKey(
  user: User,
  catalogId: string,
  databaseId: string,
  keyId: string,
  expires: number,
) {
  const { id, email, name, picture, refreshToken } = user;
  return (
    'dbk1_' +
    seal(
      JSON.stringify(
        schema.parse({
          version: 1,
          purpose: 'database-application',
          user: { id, email, name, picture, refreshToken },
          catalogId,
          databaseId,
          keyId,
          expires,
        }),
      ),
    )
  );
}
export function decodeApplicationKey(value: unknown): ApplicationKey | null {
  if (typeof value !== 'string' || !value.startsWith('dbk1_') || value.length > 5000) return null;
  try {
    const key = schema.parse(JSON.parse(unseal(value.slice(5))));
    return key.expires > Date.now() ? key : null;
  } catch {
    return null;
  }
}
export function isApplicationPath(key: ApplicationKey, path: string) {
  const base = `/api/databases/${key.databaseId}`;
  return path === base || path.startsWith(base + '/');
}
