import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/api.ts';

test('a waking server is retried for reads, but a failed write is never repeated', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    return calls === 1
      ? new Response('temporarily unavailable', { status: 502 })
      : Response.json({ status: 'ok' });
  });
  assert.deepEqual(await api('/health'), { status: 'ok' });
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(api('/databases', { method: 'POST', body: '{}' }));
  assert.equal(calls, 1);
});
