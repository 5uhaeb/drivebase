import express, {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import {
  state,
  persist,
  seal,
  digest,
  createSession,
  type User,
  type DatabaseRecord,
} from './store.js';
import {
  oauth,
  download,
  upload,
  HttpError,
  googleAccessToken,
  selectFolder,
  assertPrivateApplicationStorage,
} from './storage.js';
import { execute, serialized } from './engine.js';
import { catalogs, type Account } from './catalog.js';
import { decodeSession, encodeSession } from './session.js';
import { decodeApplicationKey, isApplicationPath } from './application-key.js';
import { createIdentityIntent, readIdentityIntent, signIdentity } from './identity.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(
  '/api',
  rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }),
);
const cookie = {
  httpOnly: true,
  secure: config.production,
  sameSite: 'lax' as const,
  path: '/api',
};
const requestAccounts = new WeakMap<Request, Account>();
function databaseRecords(req: Request): Record<string, DatabaseRecord> {
  return requestAccounts.get(req)?.catalog.databases || state.databases;
}
async function saveAccount(req: Request) {
  const account = requestAccounts.get(req);
  if (account) await catalogs.save(account);
  else persist();
}
function setGoogleCookie(res: Response, account: Account) {
  res.cookie(
    'drivebase_session',
    encodeSession(account.user, account.catalogId, account.sessionId, account.expires),
    {
      ...cookie,
      maxAge: Math.max(0, account.expires - Date.now()),
    },
  );
}
const publicUser = (user: User) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  picture: user.picture,
  folderId: user.folderId,
  folderName: user.folderName,
});
function currentUser(req: Request): User {
  if (config.mode === 'setup')
    throw new HttpError(503, 'Sign-in is disabled while Google Drive setup is pending.');
  if (config.mode === 'google') {
    const account = requestAccounts.get(req);
    if (!account) throw new HttpError(401, 'Sign in to continue.');
    return account.user;
  }
  const token = req.cookies.drivebase_session;
  const session = typeof token === 'string' ? state.sessions[digest(token)] : undefined;
  if (!session || session.expires < Date.now() || !state.users[session.userId])
    throw new HttpError(401, 'Sign in to continue.');
  return state.users[session.userId];
}
function owned(req: Request, user: User, id: string): DatabaseRecord {
  const record = databaseRecords(req)[id];
  if (!record || record.ownerId !== user.id) throw new HttpError(404, 'Database not found.');
  return record;
}
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const applicationKey = decodeApplicationKey(req.get('authorization')?.replace(/^Bearer /, ''));
    if (!applicationKey && req.get('origin') !== new URL(config.frontend).origin)
      return next(new HttpError(403, 'Request origin is not allowed.'));
    const databaseImport =
      /^\/databases\/[a-f0-9-]+\/import$/i.test(req.path) && req.is('application/vnd.sqlite3');
    if (req.method !== 'DELETE' && !databaseImport && !req.is('application/json'))
      return next(new HttpError(415, 'Use application/json.'));
  }
  next();
});
app.get('/api/health', (_req, res) =>
  res.json({ status: 'ok', mode: config.mode, version: '0.1.0' }),
);
function withAccount(handler: RequestHandler): RequestHandler {
  return async (req, res, next) => {
    if (config.mode !== 'google') return handler(req, res, next);
    const applicationKey = decodeApplicationKey(req.get('authorization')?.replace(/^Bearer /, ''));
    if (applicationKey) {
      if (!isApplicationPath(applicationKey, req.path))
        throw new HttpError(403, 'Application key cannot access this resource.');
      return serialized(`account:${applicationKey.user.id}`, async () => {
        const account = await catalogs.authenticateApplication(applicationKey);
        requestAccounts.set(req, account);
        try {
          return await handler(req, res, next);
        } finally {
          requestAccounts.delete(req);
        }
      });
    }
    const optional = ['/api/auth/me', '/api/auth/logout'].includes(req.path);
    const session = decodeSession(req.cookies.drivebase_session);
    if (!session) {
      if (optional) return handler(req, res, next);
      throw new HttpError(401, 'Sign in to continue.');
    }
    // Lock the complete handler, including storage writes, even if the client disconnects.
    return serialized(`account:${session.user.id}`, async () => {
      let account: Account;
      try {
        account = await catalogs.authenticate(session);
      } catch (error) {
        if (optional && error instanceof HttpError && error.status === 401)
          return handler(req, res, next);
        throw error;
      }
      requestAccounts.set(req, account);
      setGoogleCookie(res, account);
      try {
        return await handler(req, res, next);
      } finally {
        requestAccounts.delete(req);
      }
    });
  };
}
const accountRoutes = {
  get: (path: string, handler: RequestHandler) => app.get(path, withAccount(handler)),
  post: (path: string, handler: RequestHandler) => app.post(path, withAccount(handler)),
  put: (path: string, handler: RequestHandler) => app.put(path, withAccount(handler)),
  delete: (path: string, handler: RequestHandler) => app.delete(path, withAccount(handler)),
};
accountRoutes.get('/api/auth/me', (req, res) => {
  let user: User | null = null;
  try {
    user = currentUser(req);
  } catch {}
  res.set('Cache-Control', 'no-store').json({
    user: user ? publicUser(user) : null,
    mode: config.mode,
    maxDatabaseBytes: config.maxBytes,
  });
});
app.post('/api/auth/demo', (_req, res) => {
  if (config.mode !== 'demo' || config.production) throw new HttpError(404, 'Not found.');
  const user = (state.users.demo ||= {
    id: 'demo',
    name: 'Local workspace',
    email: 'demo@localhost',
  });
  res
    .cookie('drivebase_session', createSession(user.id), { ...cookie, maxAge: 7 * 86400000 })
    .json({ user: publicUser(user) });
});
app.get('/api/auth/google', (_req, res) => {
  res.clearCookie('drivebase_identity', cookie);
  if (config.mode === 'setup') return res.redirect(`${config.frontend}/?error=sign_in_disabled`);
  if (config.mode !== 'google')
    return res.redirect(`${config.frontend}/?error=google_not_configured`);
  const nonce = randomBytes(24).toString('base64url');
  res.cookie('drivebase_oauth_state', nonce, { ...cookie, maxAge: 600000 });
  res.redirect(
    oauth().generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      state: nonce,
      scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
    }),
  );
});
app.get('/api/identity/google', (req, res) => {
  if (
    config.mode !== 'google' ||
    !process.env.TASKFLOW_FRONTEND_URL ||
    !process.env.TASKFLOW_IDENTITY_SECRET
  )
    throw new HttpError(503, 'Taskflow sign-in is not configured yet.');
  const { state } = z
    .object({ app: z.literal('taskflow'), state: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .parse(req.query);
  const nonce = randomBytes(24).toString('base64url');
  res.cookie('drivebase_identity', createIdentityIntent(state), { ...cookie, maxAge: 600000 });
  res.cookie('drivebase_oauth_state', nonce, { ...cookie, maxAge: 600000 });
  res.redirect(oauth().generateAuthUrl({ state: nonce, scope: ['openid', 'email', 'profile'] }));
});
app.get('/api/auth/google/callback', async (req, res) => {
  const identityIntent = readIdentityIntent(req.cookies.drivebase_identity);
  res.clearCookie('drivebase_identity', cookie);
  try {
    if (config.mode !== 'google') throw new Error('Google is not configured');
    const expected = req.cookies.drivebase_oauth_state;
    const actual = typeof req.query.state === 'string' ? req.query.state : '';
    res.clearCookie('drivebase_oauth_state', cookie);
    if (
      typeof expected !== 'string' ||
      Buffer.byteLength(actual) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      throw new Error('Invalid OAuth state');
    if (typeof req.query.code !== 'string') throw new Error('Authorization was declined');
    const client = oauth();
    const { tokens } = await client.getToken(req.query.code);
    if (!tokens.id_token) throw new Error('Missing identity token');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.clientId,
    });
    const profile = ticket.getPayload();
    if (!profile?.sub || !profile.email || !profile.email_verified)
      throw new Error('A verified Google email is required');
    if (identityIntent) {
      const target = new URL('/auth/callback', process.env.TASKFLOW_FRONTEND_URL!);
      target.hash = new URLSearchParams({
        token: signIdentity(
          { sub: profile.sub, email: profile.email },
          identityIntent.state,
          process.env.TASKFLOW_IDENTITY_SECRET || '',
        ),
        state: identityIntent.state,
      }).toString();
      return res.redirect(target.toString());
    }
    const user: User = {
      id: profile.sub,
      email: profile.email,
      name: profile.name || profile.email,
      picture: profile.picture,
    };
    if (tokens.refresh_token) user.refreshToken = seal(tokens.refresh_token);
    const priorSession = decodeSession(req.cookies.drivebase_session);
    if (!user.refreshToken && priorSession?.user.id === user.id)
      user.refreshToken = priorSession.user.refreshToken;
    if (!user.refreshToken) throw new Error('Offline access was not granted');
    const account = await serialized(`account:${user.id}`, () => catalogs.signIn(user));
    setGoogleCookie(res, account);
    res.redirect(config.frontend);
  } catch (error) {
    console.error(
      'Google authorization failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    if (identityIntent && process.env.TASKFLOW_FRONTEND_URL)
      return res.redirect(
        new URL(
          '/auth/callback#error=google_connection_failed',
          process.env.TASKFLOW_FRONTEND_URL,
        ).toString(),
      );
    res.redirect(`${config.frontend}/?error=google_connection_failed`);
  }
});
accountRoutes.post('/api/auth/logout', async (req, res) => {
  const account = requestAccounts.get(req);
  if (account) await catalogs.signOut(account);
  else if (config.mode === 'demo') {
    if (typeof req.cookies.drivebase_session === 'string')
      delete state.sessions[digest(req.cookies.drivebase_session)];
    persist();
  }
  res.clearCookie('drivebase_session', cookie).json({ success: true });
});
accountRoutes.post('/api/drive/picker', async (req, res) => {
  const user = currentUser(req);
  if (config.mode !== 'google')
    throw new HttpError(400, 'Folder selection requires Google sign-in.');
  if (!config.pickerApiKey || !config.googleProjectNumber)
    throw new HttpError(
      503,
      'Google Picker is not configured yet. Add the Picker API key and Cloud project number on the backend.',
    );
  res.json({
    accessToken: await googleAccessToken(user),
    apiKey: config.pickerApiKey,
    projectNumber: config.googleProjectNumber,
  });
});
accountRoutes.put('/api/drive/folder', async (req, res) => {
  const user = currentUser(req);
  if (config.mode !== 'google')
    throw new HttpError(400, 'Folder selection requires Google sign-in.');
  const { folderId } = z
    .object({ folderId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/) })
    .parse(req.body);
  await serialized(`folder:${user.id}`, () => selectFolder(user, folderId));
  await saveAccount(req);
  res.json({ user: publicUser(user) });
});
accountRoutes.post('/api/integrations/projects', async (req, res) => {
  const user = currentUser(req);
  const account = requestAccounts.get(req);
  if (!account || config.mode !== 'google') throw new HttpError(400, 'Google sign-in is required.');
  const projects: Record<string, unknown> = {};
  await assertPrivateApplicationStorage(user);
  for (const name of ['portfolio', 'watchparty', 'taskflow']) {
    let record = Object.values(account.catalog.databases).find((db) => db.name === name);
    if (!record) {
      if (Object.keys(account.catalog.databases).length >= 10)
        throw new HttpError(400, 'The account database limit has been reached.');
      const created = await execute(undefined, { type: 'create' });
      const fileId = await upload(user, name, created.bytes);
      const now = new Date().toISOString();
      record = {
        id: randomUUID(),
        ownerId: user.id,
        name,
        fileId,
        size: created.bytes.length,
        createdAt: now,
        updatedAt: now,
      };
      account.catalog.databases[record.id] = record;
      await catalogs.save(account);
    }
    await assertPrivateApplicationStorage(user, record.fileId);
    const apiKey = await catalogs.issueApplication(account, record.id, name);
    projects[name] = { databaseId: record.id, apiKey };
  }
  res.json({ version: 1, apiUrl: config.frontend + '/api', projects });
});
app.use('/api/databases', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
accountRoutes.get('/api/databases', (req, res) => {
  const user = currentUser(req);
  res.json({
    databases: Object.values(databaseRecords(req))
      .filter((db) => db.ownerId === user.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  });
});
accountRoutes.post('/api/databases', async (req, res) => {
  const user = currentUser(req);
  const { name } = z
    .object({
      name: z
        .string()
        .trim()
        .min(1)
        .max(64)
        .regex(/^[\p{L}\p{N} _.-]+$/u),
    })
    .parse(req.body);
  const record = await serialized(`folder:${user.id}`, async () => {
    if (Object.values(databaseRecords(req)).filter((db) => db.ownerId === user.id).length >= 10)
      throw new HttpError(400, 'The MVP supports up to 10 databases per account.');
    const created = await execute(undefined, { type: 'create' });
    const fileId = await upload(user, name, created.bytes);
    const now = new Date().toISOString();
    const record: DatabaseRecord = {
      id: randomUUID(),
      ownerId: user.id,
      name,
      fileId,
      size: created.bytes.length,
      createdAt: now,
      updatedAt: now,
    };
    databaseRecords(req)[record.id] = record;
    await saveAccount(req);
    return record;
  });
  res.status(201).json({ database: record });
});
async function operation(req: Request, res: Response, action: Record<string, unknown>) {
  const user = currentUser(req);
  const record = owned(req, user, String(req.params.id));
  const payload = await serialized(`db:${record.id}`, async () => {
    const bytes = await download(user, record.fileId);
    if (bytes.length > config.maxBytes)
      throw new HttpError(413, 'Database exceeds the size limit.');
    const output = await execute(bytes, action);
    if (output.changed) {
      await upload(user, record.name, output.bytes, record.fileId);
      record.size = output.bytes.length;
      record.updatedAt = new Date().toISOString();
      await saveAccount(req);
    }
    return {
      ...output.result,
      database: record,
      persisted: true,
      storage: config.mode === 'demo' ? 'local' : 'google-drive',
    };
  });
  res.json(payload);
}
accountRoutes.get('/api/databases/:id/schema', (req, res) =>
  operation(req, res, { type: 'schema' }),
);
app.post(
  '/api/databases/:id/import',
  express.raw({ type: 'application/vnd.sqlite3', limit: config.maxBytes }),
  withAccount(async (req, res) => {
    const user = currentUser(req);
    const record = owned(req, user, String(req.params.id));
    await assertPrivateApplicationStorage(user, record.fileId);
    if (
      !Buffer.isBuffer(req.body) ||
      req.body.subarray(0, 16).toString() !== 'SQLite format 3\u0000'
    )
      throw new HttpError(400, 'Upload a valid SQLite database.');
    await serialized(`db:${record.id}`, async () => {
      const checked = await execute(req.body, { type: 'schema' });
      await upload(user, record.name, checked.bytes, record.fileId);
      record.size = checked.bytes.length;
      record.updatedAt = new Date().toISOString();
      await saveAccount(req);
      res.json({ database: record, persisted: true, ...checked.result });
    });
  }),
);
accountRoutes.post('/api/databases/:id/query', (req, res) => {
  const body = z
    .object({
      sql: z.string().trim().min(1).max(20000),
      params: z
        .array(z.union([z.string().max(100000), z.number().finite(), z.null()]))
        .max(100)
        .default([]),
    })
    .parse(req.body);
  return operation(req, res, { type: 'sql', ...body });
});
const collectionName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/);
const documentId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
accountRoutes.get('/api/databases/:id/collections/:collection/documents', (req, res) =>
  operation(req, res, {
    type: 'list-documents',
    collection: collectionName.parse(req.params.collection),
    offset: z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset),
  }),
);
accountRoutes.put(
  '/api/databases/:id/collections/:collection/documents/:documentId',
  (req, res) => {
    const { data } = z.object({ data: z.record(z.string(), z.unknown()) }).parse(req.body);
    return operation(req, res, {
      type: 'put-document',
      collection: collectionName.parse(req.params.collection),
      id: documentId.parse(req.params.documentId),
      data,
    });
  },
);
accountRoutes.delete(
  '/api/databases/:id/collections/:collection/documents/:documentId',
  (req, res) =>
    operation(req, res, {
      type: 'delete-document',
      collection: collectionName.parse(req.params.collection),
      id: documentId.parse(req.params.documentId),
    }),
);
accountRoutes.get('/api/databases/:id/export', async (req, res) => {
  const user = currentUser(req);
  const record = owned(req, user, String(req.params.id));
  await serialized(`db:${record.id}`, async () => {
    const bytes = await download(user, record.fileId);
    res
      .set('Content-Type', 'application/vnd.sqlite3')
      .attachment(`${record.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}.sqlite`)
      .send(Buffer.from(bytes));
  });
});
app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof z.ZodError)
    return res.status(400).json({
      error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    });
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid JSON body.' });
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large')
    return res.status(413).json({ error: 'Request body exceeds the 256 KiB limit.' });
  console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
  res
    .status(500)
    .json({ error: 'The request failed. Refresh the database before retrying a write.' });
});
const server = app.listen(config.port, config.production ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(`Drivebase API listening on ${config.port} (${config.mode})`),
);
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 30000).unref();
  });
