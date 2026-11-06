import 'dotenv/config';
import { resolve } from 'node:path';

export const config = {
  port: Number(process.env.PORT || 4000),
  production: process.env.NODE_ENV === 'production',
  mode: process.env.AUTH_MODE || 'demo',
  frontend: process.env.FRONTEND_URL || 'http://localhost:5173',
  redirect: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5173/api/auth/google/callback',
  clientId: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  encryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  dataDir: resolve(process.env.DATA_DIR || '.data'),
  maxBytes: Number(process.env.MAX_DATABASE_BYTES || 10 * 1024 * 1024),
  queryTimeout: Number(process.env.QUERY_TIMEOUT_MS || 5000),
};
if (!['demo', 'google', 'setup'].includes(config.mode))
  throw new Error('AUTH_MODE must be demo, google, or setup');
if (config.production && config.mode === 'demo')
  throw new Error('Production requires AUTH_MODE=google or setup');
if (
  config.mode === 'google' &&
  (!config.clientId ||
    !config.clientSecret ||
    Buffer.from(config.encryptionKey, 'base64').length !== 32)
) {
  throw new Error(
    'Google mode requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and a 32-byte base64 TOKEN_ENCRYPTION_KEY',
  );
}
if (
  config.production &&
  (!config.frontend.startsWith('https://') || !config.redirect.startsWith('https://'))
)
  throw new Error('Production URLs must use HTTPS');
if (
  new URL(config.redirect).origin !== new URL(config.frontend).origin ||
  new URL(config.redirect).pathname !== '/api/auth/google/callback'
)
  throw new Error('GOOGLE_REDIRECT_URI must be FRONTEND_URL plus /api/auth/google/callback');
if (
  !Number.isInteger(config.maxBytes) ||
  config.maxBytes < 16384 ||
  config.maxBytes > 10 * 1024 * 1024
)
  throw new Error('MAX_DATABASE_BYTES must be between 16384 and 10485760');
if (
  !Number.isInteger(config.queryTimeout) ||
  config.queryTimeout < 100 ||
  config.queryTimeout > 30000
)
  throw new Error('QUERY_TIMEOUT_MS must be between 100 and 30000');
