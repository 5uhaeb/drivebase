import { Worker } from 'node:worker_threads';
import { config } from './config.js';
import { HttpError } from './storage.js';

const queues = new Map<string, Promise<unknown>>();
export async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queues.set(key, current);
  try {
    return await current;
  } finally {
    if (queues.get(key) === current) queues.delete(key);
  }
}
export function execute(
  bytes: Uint8Array | undefined,
  action: Record<string, unknown>,
): Promise<{ result: any; changed: boolean; bytes: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./engine-worker.mjs', import.meta.url), {
      workerData: { bytes, action, maxBytes: config.maxBytes },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    let settled = false;
    const finish = (error?: Error, value?: any) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(new HttpError(408, 'Query exceeded the execution time limit.')),
      config.queryTimeout,
    );
    worker.once('message', (value) =>
      value.error ? finish(new HttpError(400, value.error)) : finish(undefined, value),
    );
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(new HttpError(400, `Query worker stopped (${code}).`));
    });
  });
}
