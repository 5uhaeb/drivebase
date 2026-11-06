import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cloud,
  Code2,
  Database as DatabaseIcon,
  ExternalLink,
  FileJson2,
  FolderOpen,
  HardDrive,
  Layers3,
  LoaderCircle,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Table2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  type User,
  type Database,
  type Schema,
  type DocumentRecord,
  type QueryResult,
} from './api';

const initialSql =
  "SELECT\n  'Hello, Drivebase' AS message,\n  sqlite_version() AS sqlite_version;";
const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
const prettyTime = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
type Tab = 'sql' | 'collections' | 'connection';
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        D<span />
      </span>
      <strong>
        drivebase<span className="brand-dot">.</span>
      </strong>
      <span className="version">MVP</span>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('');
  const [maxBytes, setMaxBytes] = useState(10485760);
  const [databases, setDatabases] = useState<Database[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [schema, setSchema] = useState<Schema>({ tables: [], collections: [] });
  const [tab, setTab] = useState<Tab>('sql');
  const [sql, setSql] = useState(initialSql);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newDatabase, setNewDatabase] = useState(false);
  const [databaseName, setDatabaseName] = useState('');
  const [collection, setCollection] = useState('notes');
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [documentId, setDocumentId] = useState('');
  const [documentJson, setDocumentJson] = useState(
    '{\n  "title": "My first document",\n  "published": false\n}',
  );
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const editor = useRef<HTMLTextAreaElement>(null);
  const selected = databases.find((db) => db.id === selectedId);

  const refreshDatabases = useCallback(async () => {
    const data = await api<{ databases: Database[] }>('/databases');
    setDatabases(data.databases);
    return data.databases;
  }, []);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await api<{ user: User | null; mode: string; maxDatabaseBytes: number }>(
          '/auth/me',
        );
        if (!active) return;
        setUser(data.user);
        setMode(data.mode);
        setMaxBytes(data.maxDatabaseBytes);
        if (data.user) {
          const list = await refreshDatabases();
          if (active) setSelectedId(list[0]?.id || '');
        }
        const authError = new URLSearchParams(location.search).get('error');
        if (authError && active) {
          setError(
            authError === 'sign_in_disabled'
              ? 'Sign-in is disabled while Google Drive setup is pending.'
              : authError === 'google_not_configured'
                ? 'Google sign-in is not configured. Use the local workspace or configure Google credentials.'
                : 'Google connection failed. Please try again and allow Drive file access.',
          );
          window.history.replaceState({}, '', location.pathname);
        }
      } catch (error) {
        if (active) setError((error as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [refreshDatabases]);
  useEffect(() => {
    setResult(null);
    setSchema({ tables: [], collections: [] });
    setDocuments([]);
    setOffset(0);
    setHistory([]);
    setDocumentId('');
    setSql(initialSql);
    if (!selectedId) return;
    let active = true;
    api<Schema>(`/databases/${selectedId}/schema`)
      .then((data) => {
        if (active) setSchema(data);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);
  useEffect(() => {
    setDocuments([]);
    if (tab !== 'collections' || !selectedId || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(collection))
      return;
    let active = true;
    api<{ documents: DocumentRecord[] }>(
      `/databases/${selectedId}/collections/${collection}/documents?offset=${offset}`,
    )
      .then((data) => {
        if (active) setDocuments(data.documents);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [tab, selectedId, collection, offset]);
  useEffect(() => {
    if (!newDatabase && !showGuide) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    (
      modal?.querySelector<HTMLElement>('input') || modal?.querySelector<HTMLElement>('button, a')
    )?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !modal) return;
      const elements = Array.from(
        modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]'),
      );
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trapFocus);
    return () => {
      document.removeEventListener('keydown', trapFocus);
      previousFocus?.focus();
    };
  }, [newDatabase, showGuide]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        setNewDatabase(false);
        setShowGuide(false);
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [busy]);

  async function act(label: string, operation: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function reloadSchema() {
    setSchema(await api<Schema>(`/databases/${selectedId}/schema`));
  }
  async function loginDemo() {
    await act('Opening workspace', async () => {
      const data = await api<{ user: User }>('/auth/demo', { method: 'POST', body: '{}' });
      setUser(data.user);
      const list = await refreshDatabases();
      setSelectedId(list[0]?.id || '');
    });
  }
  async function createDatabase(event: FormEvent) {
    event.preventDefault();
    await act('Creating database', async () => {
      const data = await api<{ database: Database }>('/databases', {
        method: 'POST',
        body: JSON.stringify({ name: databaseName }),
      });
      await refreshDatabases();
      setSelectedId(data.database.id);
      setTab('sql');
      setNewDatabase(false);
      setDatabaseName('');
      setNotice(`${data.database.name} is ready. Start with SQL or add a JSON document.`);
    });
  }
  async function runQuery() {
    if (!selectedId || busy) return;
    await act('Running query', async () => {
      const start = performance.now();
      const data = await api<QueryResult>(`/databases/${selectedId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql }),
      });
      setResult(data);
      setElapsed(Math.round(performance.now() - start));
      setHistory((items) => [sql, ...items.filter((item) => item !== sql)].slice(0, 10));
      setDatabases((items) => items.map((db) => (db.id === data.database.id ? data.database : db)));
      await reloadSchema();
    });
  }
  async function saveDocument(event: FormEvent) {
    event.preventDefault();
    await act('Saving document', async () => {
      const data = JSON.parse(documentJson);
      if (!data || Array.isArray(data) || typeof data !== 'object')
        throw new Error('Enter a JSON object.');
      const id = documentId || crypto.randomUUID();
      await api(
        `/databases/${selectedId}/collections/${encodeURIComponent(collection)}/documents/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify({ data }) },
      );
      setDocumentId(id);
      const list = await api<{ documents: DocumentRecord[] }>(
        `/databases/${selectedId}/collections/${collection}/documents?offset=${offset}`,
      );
      setDocuments(list.documents);
      await reloadSchema();
      await refreshDatabases();
      setNotice(`Document saved to ${mode === 'demo' ? 'local storage' : 'Google Drive'}.`);
    });
  }
  async function deleteDocument(id: string) {
    if (!window.confirm(`Delete document “${id}”?`)) return;
    await act('Deleting document', async () => {
      await api(
        `/databases/${selectedId}/collections/${collection}/documents/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      setDocuments((items) => items.filter((item) => item.id !== id));
      if (documentId === id) {
        setDocumentId('');
        setDocumentJson('{}');
      }
      await reloadSchema();
      await refreshDatabases();
      setNotice('Document deleted.');
    });
  }
  const filtered = databases.filter((db) => db.name.toLowerCase().includes(search.toLowerCase()));
  const alert = (
    <>
      {error && (
        <div className="alert error" role="alert">
          <CircleHelp size={17} />
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </>
  );

  if (loading)
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <span>Opening your workspace…</span>
      </div>
    );
  if (!user)
    return (
      <div className="login-page">
        <nav>
          <Brand />
          <a href="https://github.com/5uhaeb/drivebase" target="_blank" rel="noreferrer">
            View source <ExternalLink size={14} />
          </a>
        </nav>
        <main className="login-layout">
          <section>
            <span className="eyebrow">
              <span className="status-dot" /> YOUR DATA, UNDER YOUR CONTROL
            </span>
            <h1>
              A database.
              <br />A little more
              <br />
              <em>yours.</em>
            </h1>
            <p>
              Write SQL. Store JSON. Keep your database in your own Google Drive. One focused
              workspace for the things you’re building.
            </p>
            <div className="login-actions">
              {mode === 'demo' ? (
                <button className="primary large" disabled={!!busy} onClick={loginDemo}>
                  {busy ? <LoaderCircle size={18} className="spin" /> : <Terminal size={18} />} Open
                  local workspace <ArrowRight size={18} />
                </button>
              ) : mode === 'setup' ? (
                <button className="primary large" disabled aria-describedby="setup-status">
                  <GoogleIcon /> Google sign-in coming soon
                </button>
              ) : (
                <a className="primary large" href="/api/auth/google">
                  <GoogleIcon /> Continue with Google <ArrowRight size={18} />
                </a>
              )}
              <span>
                <ShieldCheck size={14} />{' '}
                {mode === 'setup'
                  ? 'Live preview · Sign-in is currently disabled'
                  : mode === 'demo'
                    ? 'Local development · Google credentials not required'
                    : 'Access limited to files created with Drivebase'}
              </span>
            </div>
            {mode === 'setup' && (
              <p id="setup-status" className="setup-status" role="status">
                Drivebase is live. Google Drive connection setup is in progress; database access
                will open once sign-in is enabled.
              </p>
            )}
            {alert}
            <div className="login-chips">
              <span>
                <Code2 size={16} /> SQL tables
              </span>
              <span>
                <Braces size={16} /> JSON documents
              </span>
              <span>
                <Cloud size={16} /> Your Drive
              </span>
            </div>
          </section>
          <div className="login-visual">
            <div className="visual-heading">
              <span className="terminal-dots">
                <i />
                <i />
                <i />
              </span>
              <span>your-next-idea.sqlite</span>
              <Cloud size={16} />
            </div>
            <div className="visual-code">
              <span className="code-comment">-- Make something yours.</span>
              <br />
              <b>CREATE TABLE</b> ideas (<br />
              &nbsp;&nbsp;id <i>INTEGER PRIMARY KEY</i>,<br />
              &nbsp;&nbsp;name <i>TEXT NOT NULL</i>,<br />
              &nbsp;&nbsp;ready <i>BOOLEAN DEFAULT</i> <span className="code-value">true</span>
              <br />
              );
              <br />
              <br />
              <b>SELECT</b> * <b>FROM</b> ideas;
            </div>
            <div className="visual-result">
              <Check size={15} />
              <span>Your database. Your storage.</span>
              <span className="visual-badge">{mode === 'setup' ? 'Preview' : 'SQL + JSON'}</span>
            </div>
            <div className="floating-drive">
              <Cloud size={24} />
              <div>
                <strong>Room for your next idea.</strong>
                <span>SQL + JSON, together.</span>
              </div>
            </div>
          </div>
        </main>
        <footer>
          DRIVEBASE / EARLY ACCESS<span>Built for independent builders.</span>
        </footer>
      </div>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-badge">
          <span className="workspace-icon">{user.name[0]?.toUpperCase()}</span>
          <div>
            <strong>Personal workspace</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <button className="sidebar-nav selected" onClick={() => setTab('sql')}>
          <Layers3 size={17} /> Databases <span className="count">{databases.length}</span>
        </button>
        <button
          className={`sidebar-nav ${tab === 'connection' ? 'active' : ''}`}
          onClick={() => setTab('connection')}
        >
          <Settings2 size={17} /> Connection
        </button>
        <div className="sidebar-section-label database-label">
          YOUR DATABASES
          <button
            aria-label="Create database"
            disabled={!!busy}
            onClick={() => setNewDatabase(true)}
          >
            <Plus size={16} />
          </button>
        </div>
        <div className="sidebar-databases">
          {databases.map((db) => (
            <button
              disabled={!!busy}
              key={db.id}
              className={`database-nav ${db.id === selectedId ? 'active' : ''}`}
              onClick={() => {
                setSelectedId(db.id);
                setTab('sql');
                setError('');
                setNotice('');
              }}
            >
              <DatabaseIcon size={16} />
              <span>{db.name}</span>
              {db.id === selectedId && <span className="status-dot" />}
            </button>
          ))}
          {!databases.length && <p className="sidebar-hint">Your databases will appear here.</p>}
        </div>
        <div className="sidebar-bottom">
          <div className="storage-card">
            <span className="storage-icon">
              <Cloud size={19} />
            </span>
            <strong>{mode === 'demo' ? 'Local development' : 'Google Drive connected'}</strong>
            <p>
              {mode === 'demo'
                ? 'Files are stored on this computer.'
                : 'Database files live in your Drive.'}
            </p>
            <div className="storage-meter">
              <span
                style={{
                  width: `${Math.min(100, (databases.reduce((sum, db) => sum + db.size, 0) / (maxBytes * 10)) * 100)}%`,
                }}
              />
            </div>
            <small>
              {formatBytes(databases.reduce((sum, db) => sum + db.size, 0))} across{' '}
              {databases.length} databases
            </small>
          </div>
          <button className="sidebar-nav" onClick={() => setShowGuide(true)}>
            <BookOpen size={17} /> Quick guide <ChevronRight size={15} />
          </button>
          <button
            className="profile"
            disabled={!!busy}
            onClick={() =>
              act('Signing out', async () => {
                await api('/auth/logout', { method: 'POST', body: '{}' });
                setUser(null);
                setDatabases([]);
                setSelectedId('');
              })
            }
          >
            <span className="avatar">{user.name[0]?.toUpperCase()}</span>
            <span>
              <strong>{user.name}</strong>
              <small>Sign out</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{' '}
            <strong>{tab === 'connection' ? 'Connection' : 'Databases'}</strong>
            {selected && tab !== 'connection' && (
              <>
                <ChevronRight size={14} />
                <span>{selected.name}</span>
              </>
            )}
          </span>
          <div>
            <span className="environment">
              <span className="status-dot" />
              {mode === 'demo' ? 'LOCAL' : 'DRIVE'}
            </span>
            <button
              className="icon-button"
              aria-label={tab === 'connection' ? 'Back to databases' : 'Connection settings'}
              onClick={() => setTab(tab === 'connection' ? 'sql' : 'connection')}
            >
              {tab === 'connection' ? <DatabaseIcon size={18} /> : <Settings2 size={18} />}
            </button>
            <button
              className="icon-button"
              aria-label="Open quick guide"
              onClick={() => setShowGuide(true)}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <main className="workspace-main">
          {mode === 'demo' && (
            <div className="demo-banner">
              <Terminal size={15} />
              <span>
                Local development mode. Connect Google credentials to store databases in Drive.
              </span>
              <button onClick={() => setTab('connection')}>
                Setup details <ArrowRight size={14} />
              </button>
            </div>
          )}
          {alert}
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR PERSONAL DATA LAYER</div>
              <h1>
                {tab === 'connection' ? 'Your connection' : 'Database studio'}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {tab === 'connection'
                  ? 'A clear view of where your data lives.'
                  : 'A place for your data. Space for your next idea.'}
              </p>
            </div>
            {tab !== 'connection' && (
              <button className="primary" disabled={!!busy} onClick={() => setNewDatabase(true)}>
                <Plus size={17} /> New database
              </button>
            )}
          </div>
          {tab === 'connection' ? (
            <div className="connection-grid">
              <section className="panel connection-panel">
                <div className="connection-hero">
                  <Cloud size={28} />
                  <h2>{mode === 'demo' ? 'Local workspace' : 'Connected to Google Drive'}</h2>
                  <p>
                    {mode === 'demo'
                      ? 'Ready to build locally. Google sign-in is the next setup step.'
                      : `Signed in as ${user.email}`}
                  </p>
                </div>
                <dl>
                  <dt>Storage provider</dt>
                  <dd>{mode === 'demo' ? 'Local filesystem' : 'Your Google Drive'}</dd>
                  <dt>Database engine</dt>
                  <dd>SQLite · SQL + JSON documents</dd>
                  <dt>Write confirmation</dt>
                  <dd>After storage acknowledges the upload</dd>
                  <dt>Database size limit</dt>
                  <dd>{formatBytes(maxBytes)} per database</dd>
                  <dt>Account limit</dt>
                  <dd>10 databases</dd>
                  <dt>Deployment model</dt>
                  <dd>Single backend instance</dd>
                </dl>
                {user.folderId && (
                  <a
                    className="secondary"
                    href={`https://drive.google.com/drive/folders/${user.folderId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <FolderOpen size={16} /> Open Drivebase folder <ExternalLink size={14} />
                  </a>
                )}
              </section>
              <section className="panel connection-panel">
                <span className="eyebrow">GET CONNECTED</span>
                <h2>{mode === 'demo' ? 'Bring your own Drive.' : 'Permission stays focused.'}</h2>
                <p>
                  {mode === 'demo'
                    ? 'Configure the Google OAuth client on the backend, then restart with AUTH_MODE=google.'
                    : 'Drivebase requests access to files it creates. Your other Drive files remain outside that permission.'}
                </p>
                <ol>
                  <li>Create a Google OAuth web client and enable the Drive API.</li>
                  <li>
                    Set the callback to your frontend URL followed by{' '}
                    <code>/api/auth/google/callback</code>.
                  </li>
                  <li>
                    Add the client ID, client secret, and token encryption key to the backend
                    environment.
                  </li>
                  <li>Sign in and grant access to app-created Drive files.</li>
                </ol>
                <p className="muted">
                  Deployment instructions and the complete environment reference are included in the
                  repository.
                </p>
                <a
                  className="text-link"
                  href="https://github.com/5uhaeb/drivebase"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open project documentation <ArrowRight size={15} />
                </a>
              </section>
            </div>
          ) : (
            <>
              <div className="metrics-grid">
                <Metric
                  icon={<DatabaseIcon size={19} />}
                  title="Databases"
                  value={String(databases.length).padStart(2, '0')}
                  detail="In your workspace"
                />
                <Metric
                  icon={<HardDrive size={19} />}
                  title="Stored data"
                  value={formatBytes(databases.reduce((sum, db) => sum + db.size, 0))}
                  detail={mode === 'demo' ? 'On your computer' : 'In your Google Drive'}
                />
                <Metric
                  icon={<Layers3 size={19} />}
                  title="Data models"
                  value="SQL + JSON"
                  detail="One database, two ways to build"
                />
              </div>
              {!databases.length ? (
                <section className="panel empty-workspace">
                  <span className="empty-icon">
                    <DatabaseIcon size={32} />
                  </span>
                  <span className="eyebrow">A FRESH START</span>
                  <h2>Your first database starts here.</h2>
                  <p>
                    Create a database, write your first query, or save a JSON document.
                    <br />
                    We’ll take care of the storage.
                  </p>
                  <button
                    className="primary"
                    disabled={!!busy}
                    onClick={() => setNewDatabase(true)}
                  >
                    <Plus size={17} /> Create your first database
                  </button>
                  <span className="empty-caption">
                    <ShieldCheck size={14} />{' '}
                    {mode === 'demo'
                      ? 'Local files for development'
                      : 'Stored in your personal Google Drive'}
                  </span>
                </section>
              ) : (
                <>
                  <section className="panel studio">
                    <div className="studio-toolbar">
                      <div className="database-selector">
                        <DatabaseIcon size={17} />
                        <select
                          aria-label="Active database"
                          value={selectedId}
                          disabled={!!busy}
                          onChange={(event) => setSelectedId(event.target.value)}
                        >
                          {databases.map((db) => (
                            <option key={db.id} value={db.id}>
                              {db.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={14} />
                        <span className="sqlite-pill">SQLite</span>
                      </div>
                      <div className="studio-toolbar-actions">
                        {selected && (
                          <>
                            <span className="muted database-size">
                              {formatBytes(selected.size)}
                            </span>
                            <a
                              className="icon-button"
                              title="Download SQLite database"
                              aria-label="Download SQLite database"
                              href={`/api/databases/${selectedId}/export`}
                            >
                              <ArrowDownToLine size={16} />
                            </a>
                          </>
                        )}
                        <button
                          className="icon-button"
                          aria-label="Refresh database"
                          disabled={!!busy}
                          onClick={() =>
                            act('Refreshing', async () => {
                              await reloadSchema();
                              await refreshDatabases();
                              setNotice('Database metadata refreshed.');
                            })
                          }
                        >
                          <RefreshCw size={16} className={busy === 'Refreshing' ? 'spin' : ''} />
                        </button>
                      </div>
                    </div>
                    <div className="studio-tabs">
                      <button
                        className={tab === 'sql' ? 'active' : ''}
                        onClick={() => setTab('sql')}
                      >
                        <Code2 size={16} /> SQL editor
                      </button>
                      <button
                        className={tab === 'collections' ? 'active' : ''}
                        onClick={() => setTab('collections')}
                      >
                        <Braces size={16} /> Collections
                      </button>
                      <span>YOUR DATA, YOUR RULES</span>
                    </div>
                    {tab === 'sql' ? (
                      <div className="sql-layout">
                        <aside className="schema-sidebar">
                          <div className="section-label">
                            TABLES <span>{schema.tables.length}</span>
                          </div>
                          {schema.tables.map((table) => (
                            <button
                              key={table.name}
                              disabled={!!busy}
                              title={table.sql}
                              onClick={() => {
                                setSql(
                                  `SELECT * FROM "${table.name.replaceAll('"', '""')}" LIMIT 100;`,
                                );
                                editor.current?.focus();
                              }}
                            >
                              <Table2 size={14} />
                              <span>{table.name}</span>
                            </button>
                          ))}
                          {!schema.tables.length && (
                            <p>
                              No tables yet.
                              <br />
                              Create one with SQL.
                            </p>
                          )}
                          <div className="section-label collection-schema-label">
                            COLLECTIONS <span>{schema.collections.length}</span>
                          </div>
                          {schema.collections.map((item) => (
                            <button
                              disabled={!!busy}
                              key={item.name}
                              onClick={() => {
                                setCollection(item.name);
                                setOffset(0);
                                setTab('collections');
                              }}
                            >
                              <FileJson2 size={14} />
                              <span>{item.name}</span>
                              <small>{item.count}</small>
                            </button>
                          ))}
                          {!schema.collections.length && (
                            <p>
                              Your JSON collections
                              <br />
                              will appear here.
                            </p>
                          )}
                        </aside>
                        <div className="query-workspace">
                          <div className="editor-heading">
                            <span>
                              <span className="status-dot" /> query.sql
                            </span>
                            <button
                              onClick={() => setShowHistory((value) => !value)}
                              disabled={!history.length}
                            >
                              History <span>{history.length}</span>
                            </button>
                          </div>
                          {showHistory && (
                            <div className="query-history">
                              {history.map((query, index) => (
                                <button
                                  key={index}
                                  onClick={() => {
                                    setSql(query);
                                    setShowHistory(false);
                                  }}
                                >
                                  {query.slice(0, 150)}
                                </button>
                              ))}
                            </div>
                          )}
                          <div className="code-editor">
                            <div className="line-numbers" aria-hidden="true">
                              {sql.split('\n').map((_, index) => (
                                <span key={index}>{index + 1}</span>
                              ))}
                            </div>
                            <textarea
                              ref={editor}
                              spellCheck={false}
                              aria-label="SQL query"
                              value={sql}
                              disabled={!!busy}
                              onChange={(event) => setSql(event.target.value)}
                              onKeyDown={(event) => {
                                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                                  event.preventDefault();
                                  void runQuery();
                                }
                                if (event.key === 'Tab') {
                                  event.preventDefault();
                                  const start = event.currentTarget.selectionStart;
                                  const end = event.currentTarget.selectionEnd;
                                  setSql(sql.slice(0, start) + '  ' + sql.slice(end));
                                  requestAnimationFrame(() =>
                                    editor.current?.setSelectionRange(start + 2, start + 2),
                                  );
                                }
                              }}
                            />
                          </div>
                          <div className="editor-footer">
                            <span>
                              <Code2 size={14} /> SQLite syntax <i>·</i> One statement at a time
                            </span>
                            <div>
                              <kbd>Ctrl ↵</kbd>
                              <button
                                className="primary small"
                                disabled={!!busy || !sql.trim() || !selectedId}
                                onClick={runQuery}
                              >
                                {busy === 'Running query' ? (
                                  <LoaderCircle size={14} className="spin" />
                                ) : (
                                  <Play size={14} />
                                )}{' '}
                                {busy === 'Running query' ? 'Running…' : 'Run query'}
                              </button>
                            </div>
                          </div>
                          <div className="results-heading">
                            <span>
                              Results{' '}
                              {result && <span className="count">{result.rows.length}</span>}
                            </span>
                            {result && (
                              <span className="query-status">
                                <Check size={13} />
                                {elapsed} ms <i>·</i>{' '}
                                {result.columns.length
                                  ? `${result.rows.length} rows${result.truncated ? ' (limited)' : ''}`
                                  : `${result.changes} rows affected`}
                              </span>
                            )}
                          </div>
                          {result ? (
                            result.columns.length ? (
                              <div className="results-table-wrap">
                                <table className="results-table">
                                  <thead>
                                    <tr>
                                      <th>#</th>
                                      {result.columns.map((column, index) => (
                                        <th key={index}>{column}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {result.rows.map((row, index) => (
                                      <tr key={index}>
                                        <td>{index + 1}</td>
                                        {row.map((value, index) => (
                                          <td key={index}>
                                            {value === null ? (
                                              <span className="null-value">NULL</span>
                                            ) : (
                                              String(value)
                                            )}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                {!result.rows.length && (
                                  <div className="no-rows">Query completed. No rows returned.</div>
                                )}
                                {result.truncated && (
                                  <div className="table-note">
                                    Results limited to 500 rows. Use LIMIT and OFFSET to explore
                                    more.
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="results-empty">
                                <Check size={24} />
                                <strong>Statement completed</strong>
                                <span>
                                  Changes saved to{' '}
                                  {mode === 'demo' ? 'local storage' : 'Google Drive'}.
                                </span>
                              </div>
                            )
                          ) : (
                            <div className="results-empty">
                              <Terminal size={27} />
                              <strong>A little SQL goes a long way.</strong>
                              <span>Run a query to see your results here.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="documents-workspace">
                        <div className="documents-toolbar">
                          <div>
                            <label htmlFor="collection">Collection</label>
                            <input
                              id="collection"
                              list="collections-list"
                              value={collection}
                              maxLength={64}
                              disabled={!!busy}
                              onChange={(event) => {
                                setCollection(event.target.value);
                                setOffset(0);
                                setDocumentId('');
                              }}
                            />
                            <datalist id="collections-list">
                              {schema.collections.map((item) => (
                                <option key={item.name} value={item.name} />
                              ))}
                            </datalist>
                          </div>
                          <button
                            className="secondary small"
                            disabled={!!busy}
                            onClick={() => {
                              setDocumentId('');
                              setDocumentJson('{}');
                              setNotice('Enter a JSON object and save it to create a document.');
                            }}
                          >
                            <Plus size={15} /> New document
                          </button>
                        </div>
                        <div className="documents-grid">
                          <div className="document-list">
                            <div className="section-label">
                              DOCUMENTS <span>{documents.length}</span>
                            </div>
                            {documents.map((item) => (
                              <button
                                disabled={!!busy}
                                key={item.id}
                                className={documentId === item.id ? 'active' : ''}
                                onClick={() => {
                                  setDocumentId(item.id);
                                  setDocumentJson(JSON.stringify(item.data, null, 2));
                                }}
                              >
                                <FileJson2 size={17} />
                                <span>
                                  <strong>
                                    {String(item.data.title || item.data.name || item.id)}
                                  </strong>
                                  <small>{item.id}</small>
                                </span>
                                <ChevronRight size={14} />
                              </button>
                            ))}
                            {!documents.length && (
                              <div className="document-list-empty">
                                <Braces size={24} />
                                <p>
                                  No documents here yet.
                                  <br />
                                  Save your first JSON object.
                                </p>
                              </div>
                            )}
                            <div className="pagination">
                              <button
                                disabled={!!busy || !offset}
                                onClick={() => setOffset((value) => Math.max(0, value - 100))}
                              >
                                Previous
                              </button>
                              <span>
                                {documents.length ? offset + 1 : 0}–{offset + documents.length}
                              </span>
                              <button
                                disabled={!!busy || documents.length < 100}
                                onClick={() => setOffset((value) => value + 100)}
                              >
                                Next
                              </button>
                            </div>
                          </div>
                          <form className="document-editor" onSubmit={saveDocument}>
                            <div className="document-id-row">
                              <label htmlFor="document-id">Document ID</label>
                              <input
                                id="document-id"
                                value={documentId}
                                disabled={!!busy}
                                maxLength={128}
                                onChange={(event) => setDocumentId(event.target.value)}
                                placeholder="Auto-generated when left empty"
                              />
                            </div>
                            <label className="json-label" htmlFor="document-json">
                              <Braces size={14} /> document.json
                            </label>
                            <textarea
                              id="document-json"
                              spellCheck={false}
                              value={documentJson}
                              disabled={!!busy}
                              onChange={(event) => setDocumentJson(event.target.value)}
                            />
                            <div className="document-save-row">
                              <button
                                type="button"
                                className="danger-text"
                                disabled={
                                  !!busy || !documents.some((item) => item.id === documentId)
                                }
                                onClick={() => deleteDocument(documentId)}
                              >
                                <Trash2 size={15} /> Delete
                              </button>
                              <button
                                className="primary small"
                                disabled={
                                  !!busy ||
                                  !selectedId ||
                                  !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(collection)
                                }
                              >
                                {busy === 'Saving document' ? (
                                  <LoaderCircle size={14} className="spin" />
                                ) : (
                                  <Check size={14} />
                                )}{' '}
                                Save document
                              </button>
                            </div>
                          </form>
                        </div>
                        <p className="collection-note">
                          A collection is created when you save its first document. Names start with
                          a letter and use letters, numbers, hyphens, or underscores.
                        </p>
                      </div>
                    )}
                  </section>
                  <div className="below-studio">
                    <span>
                      <ShieldCheck size={14} />{' '}
                      {mode === 'demo' ? 'Local storage active' : 'Connected to your Google Drive'}
                      <span className="subtle-dot" />
                      {selected ? `Last saved ${prettyTime(selected.updatedAt)}` : 'Ready'}
                    </span>
                    <button onClick={() => setShowGuide(true)}>
                      Need a starting point? <ArrowRight size={14} />
                    </button>
                  </div>
                  <section className="database-list-section">
                    <div>
                      <h2>
                        Your databases <span>{databases.length}</span>
                      </h2>
                      <label className="search-field">
                        <Search size={15} />
                        <input
                          aria-label="Search databases"
                          placeholder="Find a database…"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </label>
                    </div>
                    <div className="database-cards">
                      {filtered.map((db) => (
                        <button
                          disabled={!!busy}
                          key={db.id}
                          className={`database-card ${db.id === selectedId ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedId(db.id);
                            setTab('sql');
                          }}
                        >
                          <div className="database-card-icon">
                            <DatabaseIcon size={21} />
                          </div>
                          <span>
                            <strong>{db.name}</strong>
                            <small>
                              SQLite <i>·</i> {formatBytes(db.size)}
                            </small>
                          </span>
                          <ChevronRight size={17} />
                        </button>
                      ))}
                      {!filtered.length && <p className="muted">No databases match “{search}”.</p>}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>
            DRIVEBASE <i>/</i> YOUR DATA, YOUR DRIVE.
          </span>
          <span>
            <span className="status-dot" /> {busy || 'Ready to build'}
          </span>
        </footer>
      </div>
      {newDatabase && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) setNewDatabase(false);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              disabled={!!busy}
              onClick={() => setNewDatabase(false)}
            >
              <X size={19} />
            </button>
            <span className="empty-icon">
              <DatabaseIcon size={26} />
            </span>
            <h2 id="create-title">A new place for your data.</h2>
            <p>SQL tables and JSON collections, together in one SQLite file.</p>
            <form onSubmit={createDatabase}>
              <label htmlFor="database-name">Database name</label>
              <input
                autoFocus
                id="database-name"
                required
                maxLength={64}
                pattern="[\p{L}\p{N} _.\-]+"
                placeholder="my-next-project"
                value={databaseName}
                disabled={!!busy}
                onChange={(event) => setDatabaseName(event.target.value)}
              />
              <div className="modal-storage">
                <Cloud size={17} />
                <span>
                  {mode === 'demo'
                    ? 'Saved locally for development'
                    : 'Saved to your Drivebase folder in Google Drive'}
                </span>
              </div>
              {error && (
                <p className="inline-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={!!busy || !databaseName.trim()}>
                {busy ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{' '}
                {busy || 'Create database'}
              </button>
            </form>
          </section>
        </div>
      )}
      {showGuide && (
        <div className="modal-backdrop">
          <section
            className="modal guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
          >
            <button
              className="modal-close icon-button"
              aria-label="Close guide"
              onClick={() => setShowGuide(false)}
            >
              <X size={19} />
            </button>
            <span className="eyebrow">A SMALL START</span>
            <h2 id="guide-title">Your first few queries.</h2>
            <p>Create a database, then run each statement separately.</p>
            {[
              'CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL);',
              "INSERT INTO notes (title) VALUES ('My first idea');",
              'SELECT * FROM notes;',
            ].map((query, index) => (
              <div className="guide-query" key={query}>
                <span>0{index + 1}</span>
                <code>{query}</code>
                <button
                  className="icon-button"
                  aria-label={`Use example ${index + 1}`}
                  disabled={!selectedId || !!busy}
                  onClick={() => {
                    setSql(query);
                    setTab('sql');
                    setShowGuide(false);
                  }}
                >
                  <ArrowRight size={16} />
                </button>
              </div>
            ))}
            <p>
              For JSON, open Collections, choose a collection name, and save a document. SQL queries
              return up to 500 rows; document lists show 100 at a time.
            </p>
            <a
              className="text-link"
              href="https://github.com/5uhaeb/drivebase"
              target="_blank"
              rel="noreferrer"
            >
              Project documentation <ExternalLink size={14} />
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
function Metric({
  icon,
  title,
  value,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="metric">
      <div className="metric-top">
        <span>{title}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.8 12.2c0-.7-.1-1.4-.2-2.2H12v4.1h5.5a4.7 4.7 0 0 1-2 3.1v2.6h3.4c2-1.9 2.9-4.6 2.9-7.6ZM12 22a9.9 9.9 0 0 0 6.9-2.5l-3.4-2.6a6.4 6.4 0 0 1-9.4-3.2H2.6v2.7A10.4 10.4 0 0 0 12 22ZM6.1 13.7a6 6 0 0 1 0-3.4V7.6H2.6a10 10 0 0 0 0 8.8l3.5-2.7ZM12 6c1.6 0 3 .5 4.1 1.6l3-3A10 10 0 0 0 2.6 7.6l3.5 2.7A6.3 6.3 0 0 1 12 6Z"
      />
    </svg>
  );
}
