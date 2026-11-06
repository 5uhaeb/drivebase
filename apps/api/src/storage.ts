import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { config } from './config.js';
import { seal, unseal, type User } from './store.js';

export const oauth = () => new OAuth2Client(config.clientId, config.clientSecret, config.redirect);
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function googleAccessToken(user: User): Promise<string> {
  if (!user.refreshToken) throw new HttpError(401, 'Reconnect Google Drive to continue.');
  const client = oauth();
  client.setCredentials({ refresh_token: unseal(user.refreshToken) });
  client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      user.refreshToken = seal(tokens.refresh_token);
    }
  });
  let access: string | null | undefined;
  try {
    access = (await client.getAccessToken()).token;
  } catch {
    throw new HttpError(401, 'Google access expired or was revoked. Sign in again.');
  }
  if (!access) throw new HttpError(401, 'Reconnect your Google account.');
  return access;
}
export async function driveRequest(user: User, path: string, init: RequestInit = {}) {
  const access = await googleAccessToken(user);
  const response = await fetch(`https://www.googleapis.com/${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${access}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    if (response.status === 404)
      throw new HttpError(404, 'The database file or folder was removed from Drive.');
    if (response.status === 401) throw new HttpError(401, 'Reconnect your Google account.');
    if (response.status === 403 || response.status === 429)
      throw new HttpError(
        503,
        'Drive rejected the request. Check storage, permissions, or quota, then try again.',
      );
    throw new HttpError(
      502,
      'Google Drive is unavailable. The operation was not confirmed; refresh before retrying.',
    );
  }
  return response;
}
export async function ensureFolder(user: User) {
  if (config.mode === 'demo') return 'local';
  if (user.folderId) return user.folderId;
  const response = await driveRequest(user, 'drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Drivebase',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { application: 'drivebase' },
    }),
  });
  user.folderId = ((await response.json()) as { id: string }).id;
  user.folderName = 'Drivebase';
  return user.folderId;
}
export async function selectFolder(user: User, folderId: string) {
  const response = await driveRequest(
    user,
    `drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,trashed,capabilities(canAddChildren)`,
  );
  const folder = (await response.json()) as {
    id: string;
    name: string;
    mimeType: string;
    trashed?: boolean;
    capabilities?: { canAddChildren?: boolean };
  };
  if (folder.mimeType !== 'application/vnd.google-apps.folder' || folder.trashed)
    throw new HttpError(400, 'Choose an existing Drive folder that is not in the trash.');
  if (!folder.capabilities?.canAddChildren)
    throw new HttpError(403, 'You need permission to create files in this folder.');
  user.folderId = folder.id;
  user.folderName = folder.name;
  return folder;
}
function localFile(user: User, id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !/^[a-zA-Z0-9_-]+$/.test(user.id))
    throw new Error('Invalid file identifier');
  return join(config.dataDir, 'databases', user.id, `${id}.sqlite`);
}
export async function download(user: User, fileId: string): Promise<Uint8Array> {
  if (config.mode === 'demo') return new Uint8Array(await readFile(localFile(user, fileId)));
  const response = await driveRequest(
    user,
    `drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
  );
  if (!response.body) throw new HttpError(502, 'Drive returned an empty response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > config.maxBytes)
        throw new HttpError(413, 'Database exceeds the MVP size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Uint8Array(Buffer.concat(chunks));
}
export async function upload(
  user: User,
  name: string,
  bytes: Uint8Array,
  fileId?: string,
): Promise<string> {
  if (bytes.length > config.maxBytes)
    throw new HttpError(413, 'Database exceeds the MVP size limit.');
  if (config.mode === 'demo') {
    const id = fileId || randomUUID();
    const path = localFile(user, id);
    await mkdir(join(config.dataDir, 'databases', user.id), { recursive: true });
    await writeFile(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
    return id;
  }
  const folderId = await ensureFolder(user);
  const boundary = `drivebase_${randomUUID()}`;
  const metadata = fileId
    ? {}
    : { name: `${name}.sqlite`, parents: [folderId], appProperties: { application: 'drivebase' } };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/vnd.sqlite3\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await driveRequest(
    user,
    `upload/drive/v3/files${fileId ? `/${encodeURIComponent(fileId)}` : ''}?uploadType=multipart&supportsAllDrives=true&fields=id`,
    {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(body),
    },
  );
  return ((await response.json()) as { id: string }).id;
}
