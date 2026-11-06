export interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
  folderId?: string;
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
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
    credentials: 'same-origin',
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'API unavailable. Check that the backend is running.' }));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
