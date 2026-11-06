import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
const origin = 'http://localhost:5173';
async function start(mode, directory) {
  const frontend = mode === 'demo' ? origin : 'https://drivebase-5uhaeb.vercel.app';
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      AUTH_MODE: mode,
      NODE_ENV: mode === 'demo' ? 'test' : 'production',
      DATA_DIR: directory,
      PORT: String(port),
      FRONTEND_URL: frontend,
      GOOGLE_REDIRECT_URI: frontend + '/api/auth/google/callback',
      QUERY_TIMEOUT_MS: '5000',
      TASKFLOW_FRONTEND_URL: 'https://suhaeb-taskflow.vercel.app',
      TASKFLOW_IDENTITY_SECRET: 'local-test-only-identity-secret-at-least-32-chars',
      ...(mode === 'google'
        ? {
            GOOGLE_CLIENT_ID: 'test-client',
            GOOGLE_CLIENT_SECRET: 'test-secret',
            TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
          }
        : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('API did not start: ' + logs));
    }, 10000);
    child.stdout.on('data', (chunk) => {
      logs += chunk;
      if (logs.includes('Drivebase API listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    child.once('exit', () => {
      clearTimeout(timeout);
      reject(new Error('API exited: ' + logs));
    });
  });
  return {
    url: `http://127.0.0.1:${port}`,
    logs: () => logs,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const ended = once(child, 'exit');
      child.kill('SIGTERM');
      await ended;
    },
  };
}
function cleanup(directory) {
  const absolute = resolve(directory);
  assert.ok(
    absolute.startsWith(resolve(tmpdir()) + '\\drivebase-test-') ||
      absolute.startsWith(resolve(tmpdir()) + '/drivebase-test-'),
  );
  rmSync(absolute, { recursive: true, force: true });
}

test('local SQL and document API persists isolated database files', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'drivebase-test-'));
  let server = await start('demo', directory);
  let cookie = '';
  const request = async (
    path,
    { method = 'GET', body, status = 200, session = cookie, requestOrigin = origin } = {},
  ) => {
    const response = await fetch(server.url + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Origin: requestOrigin, Cookie: session },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data) + '\n' + server.logs());
    return { data, response };
  };
  let first, second;
  const query = (sql, params = [], status = 200, id = first) =>
    request(`/databases/${id}/query`, { method: 'POST', body: { sql, params }, status });
  try {
    await t.test('requires login and validates write origins', async () => {
      await request('/databases', { status: 401 });
      await request('/auth/demo', {
        method: 'POST',
        body: {},
        requestOrigin: 'https://untrusted.invalid',
        status: 403,
      });
      const login = await request('/auth/demo', { method: 'POST', body: {} });
      cookie = login.response.headers.get('set-cookie').split(';')[0];
      assert.equal(login.data.user.id, 'demo');
    });
    await t.test('creates separate databases and executes parameterized SQL', async () => {
      first = (
        await request('/databases', {
          method: 'POST',
          body: { name: 'integration-one' },
          status: 201,
        })
      ).data.database.id;
      second = (
        await request('/databases', {
          method: 'POST',
          body: { name: 'integration-two' },
          status: 201,
        })
      ).data.database.id;
      await query('CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
      await query('INSERT INTO notes (title) VALUES (?)', ['A parameterized idea']);
      const output = (await query('SELECT id, title FROM notes')).data;
      assert.deepEqual(output.rows, [[1, 'A parameterized idea']]);
      assert.equal(output.persisted, true);
      assert.equal(output.storage, 'local');
      await query('SELECT * FROM notes', [], 400, second);
    });
    await t.test(
      'rejects multiple statements and failed constraints without persisting writes',
      async () => {
        await query("INSERT INTO notes(title) VALUES('must not save'); SELECT 1", [], 400);
        await query('INSERT INTO notes(title) VALUES(NULL)', [], 400);
        assert.deepEqual((await query('SELECT count(*) FROM notes')).data.rows, [[1]]);
        await query('CREATE TABLE parents (id INTEGER PRIMARY KEY)');
        await query(
          'CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents(id))',
        );
        await query('INSERT INTO children(parent_id) VALUES(123)', [], 400);
        assert.deepEqual((await query('SELECT count(*) FROM children')).data.rows, [[0]]);
      },
    );
    await t.test('creates, replaces, lists, and deletes JSON documents', async () => {
      const endpoint = `/databases/${first}/collections/ideas/documents`;
      await request(endpoint + '/first', {
        method: 'PUT',
        body: { data: { title: 'First draft', tags: ['test'] } },
      });
      await request(endpoint + '/first', {
        method: 'PUT',
        body: { data: { title: 'Updated draft', published: true } },
      });
      let documents = (await request(endpoint)).data.documents;
      assert.equal(documents.length, 1);
      assert.deepEqual(documents[0].data, { title: 'Updated draft', published: true });
      await request(endpoint + '/discard', { method: 'PUT', body: { data: { temporary: true } } });
      await request(endpoint + '/discard', { method: 'DELETE' });
      documents = (await request(endpoint)).data.documents;
      assert.equal(documents.length, 1);
      await request(endpoint + '/invalid', { method: 'PUT', body: { data: [] }, status: 400 });
      const schema = (await request(`/databases/${first}/schema`)).data;
      assert.ok(schema.tables.some((table) => table.name === 'notes'));
      assert.deepEqual(schema.collections, [{ name: 'ideas', count: 1 }]);
    });
    await t.test('serializes concurrent writes without losing updates', async () => {
      await query('CREATE TABLE tally(total INTEGER NOT NULL)');
      await query('INSERT INTO tally VALUES(0)');
      await Promise.all(Array.from({ length: 6 }, () => query('UPDATE tally SET total=total+1')));
      assert.deepEqual((await query('SELECT total FROM tally')).data.rows, [[6]]);
    });
    await t.test(
      'imports validated snapshots and rejects corrupt uploads without changing data',
      async () => {
        const exported = await fetch(server.url + `/api/databases/${first}/export`, {
          headers: { Cookie: cookie },
        });
        const bytes = Buffer.from(await exported.arrayBuffer());
        const importFile = (body) =>
          fetch(server.url + `/api/databases/${second}/import`, {
            method: 'POST',
            headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/vnd.sqlite3' },
            body,
          });
        assert.equal((await importFile(bytes)).status, 200);
        assert.deepEqual((await query('SELECT title FROM notes', [], 200, second)).data.rows, [
          ['A parameterized idea'],
        ]);
        assert.equal((await importFile(Buffer.from('not a database'))).status, 400);
        assert.equal(
          (await importFile(Buffer.concat([bytes.subarray(0, 16), Buffer.alloc(100)]))).status,
          400,
        );
        assert.deepEqual((await query('SELECT title FROM notes', [], 200, second)).data.rows, [
          ['A parameterized idea'],
        ]);
      },
    );
    await t.test(
      'exports a SQLite file and preserves data and sessions across restart',
      async () => {
        const exported = await fetch(server.url + `/api/databases/${first}/export`, {
          headers: { Cookie: cookie },
        });
        assert.equal(exported.status, 200);
        const bytes = Buffer.from(await exported.arrayBuffer());
        assert.equal(bytes.subarray(0, 16).toString(), 'SQLite format 3\u0000');
        await server.stop();
        server = await start('demo', directory);
        assert.deepEqual((await query('SELECT title FROM notes')).data.rows, [
          ['A parameterized idea'],
        ]);
        assert.equal(
          (await request(`/databases/${first}/collections/ideas/documents`)).data.documents[0].data
            .title,
          'Updated draft',
        );
        assert.equal((await request('/auth/me')).data.user.id, 'demo');
      },
    );
    await t.test('rejects another account accessing a database ID', async () => {
      await server.stop();
      const path = join(directory, 'control.json');
      const state = JSON.parse(readFileSync(path, 'utf8'));
      // Seed a second authenticated account without requiring Google in an isolated local test.
      const token = 'integration-session-for-second-user';
      state.users['second-user'] = {
        id: 'second-user',
        email: 'second@example.invalid',
        name: 'Second test user',
      };
      state.sessions[createHash('sha256').update(token).digest('hex')] = {
        userId: 'second-user',
        expires: Date.now() + 60000,
      };
      writeFileSync(path, JSON.stringify(state));
      server = await start('demo', directory);
      const otherCookie = 'drivebase_session=' + token;
      assert.deepEqual((await request('/databases', { session: otherCookie })).data.databases, []);
      await request(`/databases/${first}/schema`, { session: otherCookie, status: 404 });
      await request(`/databases/${first}/query`, {
        method: 'POST',
        body: { sql: 'SELECT 1' },
        session: otherCookie,
        status: 404,
      });
    });
    await t.test('revokes the session on logout', async () => {
      await request('/auth/logout', { method: 'POST', body: {} });
      await request('/databases', { status: 401 });
    });
  } finally {
    await server.stop();
    cleanup(directory);
  }
});

test('public setup mode cannot authenticate or change Drive configuration', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'drivebase-test-'));
  const server = await start('setup', directory);
  try {
    const identity = await fetch(server.url + '/api/auth/me').then((response) => response.json());
    assert.equal(identity.mode, 'setup');
    assert.equal(identity.user, null);
    for (const [path, method, body, expected] of [
      ['/auth/demo', 'POST', {}, 404],
      ['/databases', 'POST', { name: 'not-allowed' }, 503],
      ['/drive/picker', 'POST', {}, 503],
      ['/drive/folder', 'PUT', { folderId: 'not-allowed' }, 503],
    ]) {
      const response = await fetch(server.url + '/api' + path, {
        method,
        body: JSON.stringify(body),
        headers: {
          Origin: 'https://drivebase-5uhaeb.vercel.app',
          'Content-Type': 'application/json',
        },
      });
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('set-cookie'), null);
    }
  } finally {
    await server.stop();
    cleanup(directory);
  }
});

test('production Google mode starts without local metadata and requests limited Drive consent', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'drivebase-test-'));
  const server = await start('google', directory);
  try {
    const identity = await fetch(server.url + '/api/auth/me').then((response) => response.json());
    assert.equal(identity.mode, 'google');
    assert.equal(identity.user, null);
    const databases = await fetch(server.url + '/api/databases');
    assert.equal(databases.status, 401);
    const consent = await fetch(server.url + '/api/auth/google', { redirect: 'manual' });
    assert.equal(consent.status, 302);
    const destination = new URL(consent.headers.get('location'));
    assert.equal(destination.origin, 'https://accounts.google.com');
    assert.equal(
      destination.searchParams.get('redirect_uri'),
      'https://drivebase-5uhaeb.vercel.app/api/auth/google/callback',
    );
    assert.equal(destination.searchParams.get('access_type'), 'offline');
    const scopes = destination.searchParams.get('scope').split(' ');
    assert.ok(scopes.includes('https://www.googleapis.com/auth/drive.file'));
    assert.ok(!scopes.includes('https://www.googleapis.com/auth/drive'));
    assert.match(consent.headers.get('set-cookie'), /HttpOnly/);
    assert.match(consent.headers.get('set-cookie'), /Secure/);
    const state = randomBytes(32).toString('base64url');
    const taskflow = await fetch(server.url + '/api/identity/google?app=taskflow&state=' + state, {
      redirect: 'manual',
    });
    assert.equal(taskflow.status, 302);
    const identityScopes = new URL(taskflow.headers.get('location')).searchParams
      .get('scope')
      .split(' ');
    assert.deepEqual(identityScopes.sort(), ['email', 'openid', 'profile']);
    assert.ok(!identityScopes.some((scope) => scope.includes('drive')));
    assert.deepEqual(readdirSync(directory), []);
  } finally {
    await server.stop();
    cleanup(directory);
  }
});
