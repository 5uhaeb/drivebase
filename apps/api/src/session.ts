import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { seal, unseal, digest, type User } from './store.js';

export const credentialUserSchema = z.object({
  id: z.string().min(1).max(128),
  email: z.string().email().max(320),
  name: z.string().max(200),
  picture: z.string().max(500).optional(),
  refreshToken: z.string().min(1).max(1500),
});
const sessionSchema = z.object({
  version: z.literal(1),
  user: credentialUserSchema,
  catalogId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  sessionId: z.string().min(32).max(100),
  expires: z.number().int().positive(),
});
export type GoogleSession = z.infer<typeof sessionSchema>;
export const sessionKey = digest;
export function newSessionId() {
  return randomBytes(32).toString('base64url');
}
export function encodeSession(user: User, catalogId: string, sessionId: string, expires: number) {
  const data = sessionSchema.parse({
    version: 1,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      refreshToken: user.refreshToken,
    },
    catalogId,
    sessionId,
    expires,
  });
  const token = seal(JSON.stringify(data));
  if (token.length > 3600) throw new Error('Google session exceeds the browser cookie size limit.');
  return token;
}
export function decodeSession(token: unknown): GoogleSession | null {
  if (typeof token !== 'string' || token.length > 3600) return null;
  try {
    const session = sessionSchema.parse(JSON.parse(unseal(token)));
    return session.expires > Date.now() ? session : null;
  } catch {
    return null;
  }
}
