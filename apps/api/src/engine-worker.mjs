import { parentPort, workerData } from 'node:worker_threads';
import initSqlJs from 'sql.js';

let db;
try {
  const SQL = await initSqlJs();
  db = workerData.bytes ? new SQL.Database(workerData.bytes) : new SQL.Database();
  db.run('PRAGMA foreign_keys=ON');
  const pageSize = Number(db.exec('PRAGMA page_size')[0].values[0][0]);
  db.run(`PRAGMA max_page_count=${Math.max(1, Math.floor(workerData.maxBytes / pageSize))}`);
  const before = db.export();
  const { action } = workerData;
  let result;
  if (action.type === 'create') {
    db.run(
      'CREATE TABLE _drivebase_documents (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)), updated_at TEXT NOT NULL, PRIMARY KEY(collection,id))',
    );
    result = { created: true };
  } else if (action.type === 'sql') {
    const clean = action.sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim();
    if (
      !/^(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE|CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|VIEW)|EXPLAIN)\b/i.test(
        clean,
      )
    )
      throw new Error(
        'Use a single SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, or EXPLAIN statement.',
      );
    if (/_drivebase_/i.test(clean))
      throw new Error('Internal document tables are managed through the collection API.');
    const statements = db.iterateStatements(action.sql);
    let count = 0;
    // The iterator owns and finalizes each prepared statement.
    for (const _statement of statements) {
      count++;
    }
    if (count !== 1) throw new Error('Run exactly one SQL statement at a time.');
    db.run('BEGIN');
    const stmt = db.prepare(action.sql);
    try {
      stmt.bind(action.params || []);
      const columns = stmt.getColumnNames();
      const rows = [];
      let truncated = false;
      while (stmt.step()) {
        if (rows.length >= 500) {
          truncated = true;
          break;
        }
        rows.push(
          stmt
            .get()
            .map((value) =>
              value instanceof Uint8Array ? `[blob: ${value.length} bytes]` : value,
            ),
        );
      }
      result = { columns, rows, changes: db.getRowsModified(), truncated };
    } finally {
      stmt.free();
    }
    db.run('COMMIT');
  } else if (action.type === 'schema') {
    const tables = db.exec(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_drivebase_%' ORDER BY name",
    );
    const collections = db.exec(
      'SELECT collection, count(*) FROM _drivebase_documents GROUP BY collection ORDER BY collection',
    );
    result = {
      tables: tables[0]?.values.map(([name, sql]) => ({ name, sql })) || [],
      collections: collections[0]?.values.map(([name, count]) => ({ name, count })) || [],
    };
  } else if (action.type === 'list-documents') {
    const stmt = db.prepare(
      'SELECT id, body, updated_at FROM _drivebase_documents WHERE collection=? ORDER BY updated_at DESC, id LIMIT 100 OFFSET ?',
    );
    stmt.bind([action.collection, action.offset || 0]);
    const documents = [];
    while (stmt.step()) {
      const [id, body, updatedAt] = stmt.get();
      documents.push({ id, data: JSON.parse(body), updatedAt });
    }
    stmt.free();
    result = { documents, limit: 100, offset: action.offset || 0 };
  } else if (action.type === 'put-document') {
    const updatedAt = new Date().toISOString();
    db.run(
      'INSERT INTO _drivebase_documents(collection,id,body,updated_at) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at',
      [action.collection, action.id, JSON.stringify(action.data), updatedAt],
    );
    result = { id: action.id, data: action.data, updatedAt };
  } else if (action.type === 'delete-document') {
    db.run('DELETE FROM _drivebase_documents WHERE collection=? AND id=?', [
      action.collection,
      action.id,
    ]);
    result = { deleted: db.getRowsModified() > 0 };
  } else throw new Error('Unknown database operation');
  const bytes = db.export();
  const changed = action.type === 'create' || !Buffer.from(before).equals(Buffer.from(bytes));
  parentPort.postMessage({ result, changed, bytes });
} catch (error) {
  parentPort.postMessage({
    error: error instanceof Error ? error.message : 'Database operation failed',
  });
} finally {
  db?.close();
}
