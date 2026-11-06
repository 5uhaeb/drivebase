import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { seal, unseal } from './store.js';

const intentSchema = z.object({
  app: z.literal('taskflow'),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expires: z.number().int().positive(),
});
export function createIdentityIntent(state: string) {
  return seal(
    JSON.stringify(intentSchema.parse({ app: 'taskflow', state, expires: Date.now() + 600000 })),
  );
}
export function readIdentityIntent(cookie: unknown) {
  if (typeof cookie !== 'string' || cookie.length > 2000) return null;
  try {
    const intent = intentSchema.parse(JSON.parse(unseal(cookie)));
    return intent.expires > Date.now() ? intent : null;
  } catch {
    return null;
  }
}
export function signIdentity(
  profile: { sub: string; email: string },
  state: string,
  secret: string,
) {
  if (secret.length < 32) throw new Error('Identity signing is not configured');
  const iat = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body =
    encode({ alg: 'HS256', typ: 'JWT' }) +
    '.' +
    encode({
      iss: 'drivebase',
      aud: 'taskflow',
      sub: profile.sub,
      email: profile.email,
      email_verified: true,
      state,
      iat,
      exp: iat + 60,
    });
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
