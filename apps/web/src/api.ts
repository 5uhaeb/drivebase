export interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
  folderId?: string;
  folderName?: string;
}
export interface Database {
  id: string;
  name: string;
  fileId: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}
export interface Schema {
  tables: { name: string; sql: string }[];
  collections: { name: string; count: number }[];
}
export interface DocumentRecord {
  id: string;
  data: Record<string, unknown>;
  updatedAt: string;
}
export interface QueryResult {
  columns: string[];
  rows: (string | number | null)[][];
  changes: number;
  truncated: boolean;
  database: Database;
  persisted: boolean;
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const attempts = !options.method || options.method.toUpperCase() === 'GET' ? 3 : 1;
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      response = await fetch(`/api${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers },
        credentials: 'same-origin',
      });
      if (![502, 503, 504].includes(response.status) || attempt === attempts - 1) break;
    } catch (error) {
      if (attempt === attempts - 1 || options.signal?.aborted) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (!response) throw new Error('Could not connect to the server. Please try again.');
  const data = await response
    .json()
    .catch(() => ({ error: 'API unavailable. Check that the backend is running.' }));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
