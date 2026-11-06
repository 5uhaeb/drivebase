import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'drivebase-catalog-test-'));
process.env.AUTH_MODE = 'google';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = directory;
process.env.GOOGLE_CLIENT_ID = 'local-test-client';
process.env.GOOGLE_CLIENT_SECRET = 'local-test-secret';
process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const { createCatalogStore } = await import('../dist/catalog.js');
const { encodeSession, decodeSession, sessionKey } = await import('../dist/session.js');
const { seal } = await import('../dist/store.js');
const { decodeApplicationKey, isApplicationPath } = await import('../dist/application-key.js');
after(() => {
  assert.deepEqual(readdirSync(directory), []);
  rmdirSync(directory);
});

function fixture() {
  const files = new Map();
  let failWrite = false;
  const storage = {
    async find(user) {
      return [...files].find(([, catalog]) => catalog.ownerId === user.id)?.[0];
    },
    async read(_user, id) {
      if (!files.has(id)) throw new Error('Catalog not found');
      return structuredClone(files.get(id));
    },
    async write(_user, catalog, id) {
      if (failWrite) {
        failWrite = false;
        throw new Error('Drive upload failed');
      }
      const fileId = id || 'catalog_' + randomUUID();
      files.set(fileId, structuredClone(catalog));
      return fileId;
    },
  };
  const user = {
    id: 'google-test-owner',
    email: 'owner@example.invalid',
    name: 'Catalog test',
    folderId: 'test_folder',
    folderName: 'Test folder',
    refreshToken: seal('test-refresh-token'),
  };
  return {
    files,
    storage,
    user,
    failNextWrite: () => {
      failWrite = true;
    },
  };
}
const cookieFor = (account) =>
  encodeSession(account.user, account.catalogId, account.sessionId, account.expires);

test('catalog, folder choice, and session survive a new store without local files', async () => {
  const { files, storage, user } = fixture();
  const first = createCatalogStore(storage);
  const account = await first.signIn(user);
  const id = randomUUID();
  account.catalog.databases[id] = {
    id,
    ownerId: user.id,
    name: 'persistent-test',
    fileId: 'sqlite_file_1',
    size: 16384,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  account.user.folderId = 'chosen_folder';
  account.user.folderName = 'Chosen folder';
  await first.save(account);
  const cookie = cookieFor(account);
  const second = createCatalogStore(storage);
  const recovered = await second.authenticate(decodeSession(cookie));
  assert.equal(recovered.user.folderId, 'chosen_folder');
  assert.equal(recovered.catalog.databases[id].fileId, 'sqlite_file_1');
  assert.equal(files.size, 1);
  const stored = JSON.stringify([...files.values()]);
  assert.ok(!stored.includes('refreshToken'));
  assert.ok(!stored.includes('test-refresh-token'));
  assert.deepEqual(readdirSync(directory), []);
  const freshLogin = await second.signIn({
    id: user.id,
    email: user.email,
    name: user.name,
    refreshToken: seal('fresh-test-refresh-token'),
  });
  assert.equal(freshLogin.catalogId, account.catalogId);
  assert.equal(freshLogin.user.folderId, 'chosen_folder');
  assert.equal(freshLogin.catalog.databases[id].name, 'persistent-test');
});

test('logout revokes a copied cookie through the durable session registry', async () => {
  const { storage, user } = fixture();
  const store = createCatalogStore(storage);
  const account = await store.signIn(user);
  const session = decodeSession(cookieFor(account));
  await store.signOut(account);
  await assert.rejects(
    createCatalogStore(storage).authenticate(session),
    (error) => error.status === 401,
  );
});

test('encrypted session rejects tampering, malformed input, and expiry', async () => {
  const { storage, user } = fixture();
  const account = await createCatalogStore(storage).signIn(user);
  const cookie = cookieFor(account);
  assert.equal(decodeSession(cookie).user.id, user.id);
  const tampered = Buffer.from(cookie, 'base64');
  tampered[20] ^= 1;
  assert.equal(decodeSession(tampered.toString('base64')), null);
  assert.equal(decodeSession('invalid-cookie'), null);
  assert.equal(
    decodeSession(encodeSession(user, account.catalogId, account.sessionId, Date.now() - 1)),
    null,
  );
});

test('rejects a foreign catalog and inconsistent database ownership', async () => {
  const { files, storage, user } = fixture();
  const store = createCatalogStore(storage);
  const account = await store.signIn(user);
  const session = decodeSession(cookieFor(account));
  const catalog = files.get(account.catalogId);
  catalog.ownerId = 'another-owner';
  await assert.rejects(store.authenticate(session), (error) => error.status === 409);
  catalog.ownerId = user.id;
  const id = randomUUID();
  catalog.databases[id] = {
    id,
    ownerId: 'another-owner',
    name: 'foreign',
    fileId: 'foreign_file',
    size: 0,
    createdAt: '',
    updatedAt: '',
  };
  await assert.rejects(store.authenticate(session), (error) => error.status === 409);
});

test('rejects expired server-side sessions even when the encrypted cookie is still valid', async () => {
  const { files, storage, user } = fixture();
  const store = createCatalogStore(storage);
  const account = await store.signIn(user);
  const session = decodeSession(cookieFor(account));
  files.get(account.catalogId).sessions[sessionKey(account.sessionId)] = Date.now() - 1;
  await assert.rejects(store.authenticate(session), (error) => error.status === 401);
});

test('failed catalog upload is reported and does not erase previously saved metadata', async () => {
  const { storage, user, failNextWrite } = fixture();
  const store = createCatalogStore(storage);
  const account = await store.signIn(user);
  const session = decodeSession(cookieFor(account));
  account.user.folderId = 'unconfirmed_folder';
  failNextWrite();
  await assert.rejects(store.save(account), /Drive upload failed/);
  const recovered = await createCatalogStore(storage).authenticate(session);
  assert.equal(recovered.user.folderId, 'test_folder');
});

test('application credentials stay scoped to one database and survive browser logout', async () => {
  const { storage, user } = fixture();
  const store = createCatalogStore(storage);
  const account = await store.signIn(user);
  const id = randomUUID();
  account.catalog.databases[id] = {
    id,
    ownerId: user.id,
    name: 'portfolio',
    fileId: 'portfolio_file',
    size: 0,
    createdAt: '',
    updatedAt: '',
  };
  const encoded = await store.issueApplication(account, id, 'portfolio');
  const key = decodeApplicationKey(encoded);
  assert.ok(key);
  assert.equal(decodeSession(encoded), null);
  assert.equal(isApplicationPath(key, `/api/databases/${id}/schema`), true);
  assert.equal(isApplicationPath(key, `/api/databases/${randomUUID()}/query`), false);
  assert.equal(isApplicationPath(key, '/api/integrations/projects'), false);
  const authenticated = await store.authenticateApplication(key);
  assert.equal(authenticated.applicationDatabaseId, id);
  await store.signOut(account);
  assert.equal((await store.authenticateApplication(key)).applicationDatabaseId, id);
  await store.issueApplication(account, id, 'portfolio');
  await assert.rejects(store.authenticateApplication(key), (error) => error.status === 401);
  assert.equal(decodeApplicationKey(encoded.slice(0, -10) + 'tampered'), null);
});
