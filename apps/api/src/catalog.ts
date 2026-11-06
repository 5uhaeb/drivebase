import { z } from 'zod';
import type { User } from './store.js';
import { driveRequest, ensureFolder, HttpError } from './storage.js';
import { newSessionId, sessionKey, type GoogleSession } from './session.js';

const databaseSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1),
  name: z.string().max(64),
  fileId: z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),
  size: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const catalogSchema = z.object({
  version: z.literal(1),
  ownerId: z.string().min(1),
  folderId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,200}$/)
    .optional(),
  folderName: z.string().max(500).optional(),
  databases: z.record(z.string(), databaseSchema),
  sessions: z.record(z.string(), z.number().int().positive()),
});
export type Catalog = z.infer<typeof catalogSchema>;
export interface Account {
  user: User;
  catalog: Catalog;
  catalogId: string;
  sessionId: string;
  expires: number;
}
// Storage injection allows persistence and recovery to be tested without a Google account.
export interface CatalogStorage {
  find(user: User): Promise<string | undefined>;
  read(user: User, id: string): Promise<unknown>;
  write(user: User, catalog: Catalog, id?: string): Promise<string>;
}
const MAX_CATALOG_BYTES = 512 * 1024;
const googleCatalogs: CatalogStorage = {
  async find(user) {
    const query =
      "trashed=false and 'me' in owners and appProperties has { key='application' and value='drivebase' } and appProperties has { key='kind' and value='catalog' }";
    const response = await driveRequest(
      user,
      `drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id),nextPageToken&pageSize=2`,
    );
    const data = (await response.json()) as { files: { id: string }[]; nextPageToken?: string };
    if (data.files.length > 1 || data.nextPageToken)
      throw new HttpError(
        409,
        'Multiple Drivebase catalogs were found. Resolve duplicate catalog files before signing in.',
      );
    return data.files[0]?.id;
  },
  async read(user, id) {
    const response = await driveRequest(
      user,
      `drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
    );
    if (!response.body) throw new HttpError(502, 'Drive returned an empty catalog.');
    const reader = response.body.getReader();
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_CATALOG_BYTES)
          throw new HttpError(413, 'Drivebase catalog exceeds the supported size.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new HttpError(
        409,
        'The Drivebase catalog is not valid JSON. Restore the catalog before continuing.',
      );
    }
  },
  async write(user, catalog, id) {
    const body = JSON.stringify(catalog);
    if (Buffer.byteLength(body) > MAX_CATALOG_BYTES)
      throw new HttpError(413, 'Drivebase catalog exceeds the supported size.');
    if (id) {
      const response = await driveRequest(
        user,
        `upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body,
        },
      );
      return ((await response.json()) as { id: string }).id;
    }
    const boundary = `drivebase_catalog_${newSessionId()}`;
    const metadata = {
      name: 'drivebase-catalog.json',
      mimeType: 'application/json',
      parents: [catalog.folderId],
      appProperties: { application: 'drivebase', kind: 'catalog' },
    };
    const response = await driveRequest(
      user,
      'upload/drive/v3/files?uploadType=multipart&fields=id',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`,
      },
    );
    return ((await response.json()) as { id: string }).id;
  },
};

function validate(value: unknown, user: User): Catalog {
  const result = catalogSchema.safeParse(value);
  if (
    !result.success ||
    result.data.ownerId !== user.id ||
    Object.values(result.data.databases).some((record) => record.ownerId !== user.id)
  )
    throw new HttpError(409, 'The Drivebase catalog is invalid or belongs to a different account.');
  for (const [id, record] of Object.entries(result.data.databases))
    if (id !== record.id)
      throw new HttpError(409, 'The Drivebase catalog contains an invalid database entry.');
  return result.data;
}
export function createCatalogStore(storage: CatalogStorage = googleCatalogs) {
  return {
    async signIn(user: User): Promise<Account> {
      let catalogId = await storage.find(user);
      let catalog: Catalog;
      if (catalogId) {
        catalog = validate(await storage.read(user, catalogId), user);
        user.folderId = catalog.folderId;
        user.folderName = catalog.folderName;
      } else {
        await ensureFolder(user);
        catalog = {
          version: 1,
          ownerId: user.id,
          folderId: user.folderId,
          folderName: user.folderName,
          databases: {},
          sessions: {},
        };
      }
      for (const [key, expires] of Object.entries(catalog.sessions))
        if (expires <= Date.now()) delete catalog.sessions[key];
      const active = Object.keys(catalog.sessions);
      if (active.length >= 20)
        throw new HttpError(
          429,
          'Too many active sessions. Sign out on another device or wait for a session to expire.',
        );
      const sessionId = newSessionId();
      const expires = Date.now() + 7 * 86400000;
      catalog.sessions[sessionKey(sessionId)] = expires;
      catalogId = await storage.write(user, catalog, catalogId);
      return { user, catalog, catalogId, sessionId, expires };
    },
    async authenticate(session: GoogleSession): Promise<Account> {
      if (session.expires <= Date.now()) throw new HttpError(401, 'Sign in to continue.');
      const user: User = { ...session.user };
      const catalog = validate(await storage.read(user, session.catalogId), user);
      const expires = catalog.sessions[sessionKey(session.sessionId)];
      if (!expires || expires <= Date.now() || expires !== session.expires)
        throw new HttpError(401, 'Your session has expired or was signed out.');
      user.folderId = catalog.folderId;
      user.folderName = catalog.folderName;
      return { user, catalog, catalogId: session.catalogId, sessionId: session.sessionId, expires };
    },
    async save(account: Account) {
      account.catalog.folderId = account.user.folderId;
      account.catalog.folderName = account.user.folderName;
      validate(account.catalog, account.user);
      await storage.write(account.user, account.catalog, account.catalogId);
    },
    async signOut(account: Account) {
      delete account.catalog.sessions[sessionKey(account.sessionId)];
      await storage.write(account.user, account.catalog, account.catalogId);
    },
  };
}
export const catalogs = createCatalogStore();
