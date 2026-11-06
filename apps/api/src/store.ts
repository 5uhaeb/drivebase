import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';

export interface User {
  id: string;
  email: string;
  name: string;
  picture?: string;
  refreshToken?: string;
  folderId?: string;
}
export interface DatabaseRecord {
  id: string;
  ownerId: string;
  name: string;
  fileId: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}
interface State {
  users: Record<string, User>;
  databases: Record<string, DatabaseRecord>;
  sessions: Record<string, { userId: string; expires: number }>;
}
mkdirSync(config.dataDir, { recursive: true });
const path = join(config.dataDir, 'control.json');
export const state: State = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : { users: {}, databases: {}, sessions: {} };
export function persist() {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  const fd = openSync(temporary, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}
export function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.encryptionKey, 'base64'), iv);
  return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]).toString(
    'base64',
  );
}
export function unseal(value: string) {
  const data = Buffer.from(value, 'base64');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(config.encryptionKey, 'base64'),
    data.subarray(0, 12),
  );
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString();
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function createSession(userId: string) {
  for (const [key, value] of Object.entries(state.sessions))
    if (value.expires < Date.now()) delete state.sessions[key];
  const token = randomBytes(32).toString('base64url');
  state.sessions[digest(token)] = { userId, expires: Date.now() + 7 * 86400000 };
  persist();
  return token;
}
