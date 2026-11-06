# Drivebase

A personal database server with a Vercel dashboard, a Render API, and database files stored in each user's Google Drive. SQL tables and JSON document collections share a SQLite engine.

**Status:** MVP implementation. Type checks and production compilation are part of delivery; live Google authorization and deployed end-to-end testing belong to the next testing phase. This is a small-workload prototype, not a production database service.

The hosted preview can run in `AUTH_MODE=setup`. This displays the public landing page with sign-in disabled and rejects all database access. It does not expose local demo mode. See the [deployment guide](docs/DEPLOYMENT.md#setup-only-preview) before enabling Google accounts.

## Included

- Responsive database dashboard, database creation, and account connection view.
- SQL editor with table discovery, query history for the current tab, query results, and keyboard execution.
- JSON document collections with create/update/delete, IDs, and pagination.
- Downloadable SQLite databases.
- Google Picker folder selection for saving new databases in an existing writable folder.
- Google sign-in plus `drive.file` consent; a visible `Drivebase` folder created in the user's Drive.
- Encrypted HTTP-only login cookies, durable session revocation, tenant ownership checks, and request origin validation.
- Per-account request serialization and isolated query workers with a timeout.
- Local development mode with filesystem storage and no Google credentials.
- Vercel configuration and a free Render Blueprint; Google-mode metadata lives in Drive.

## Run locally

Requires Node **22.12+** and npm. From the repository root:

```sh
npm ci
npm run dev
```

Open **http://localhost:5173** and choose **Open local workspace**. The API runs on port 4000. Development mode stores metadata and database files under `apps/api/.data/`; these files are ignored by Git. Do not expose development mode to the internet.

No `.env` is required for local mode. To configure Google, copy `apps/api/.env.example` to `apps/api/.env` and follow [Google setup](docs/DEPLOYMENT.md#google-setup). The API workspace loads its own `.env` when launched through npm.

```sh
npm run typecheck
npm run build
npm test
```

Build outputs are `apps/api/dist/` and `apps/web/dist/`. `npm start` starts the compiled API only. The frontend is served by Vercel in deployment and Vite during development.

## Architecture

```mermaid
flowchart LR
    Browser --> Vercel[React dashboard on Vercel]
    Vercel -->|same-origin /api proxy| Render[Render API / single instance]
    Render --> Google[Google identity and Drive APIs]
    Render --> Worker[Isolated SQLite query worker]
    Worker --> Render
    Render --> Drive[User's Drivebase folder / SQLite files and catalog]
    Browser --> Session[Encrypted HTTP-only session cookie]
    Session --> Render
```

The API downloads the selected database for each operation, executes against an in-memory SQLite working copy, and uploads changed bytes before responding with success. Working database copies are not treated as durable. JSON collections use a private SQLite table and a separate HTTP interface; this is document CRUD, not MongoDB wire-protocol compatibility.

The UI is React with Vite. Vercel hosts static assets and proxies `/api` to Render. This keeps session cookies on the frontend origin without depending on third-party cookies. OAuth callbacks also pass through that same frontend origin. The Google redirect URI must use the frontend domain.

## Storage and operational limits

- Run **one API process and one service instance**. Locks are in-process. Do not run clustered Node workers, multiple replicas, or two deployments against the same account files.
- Default database limit: **10 MiB**; account limit: **10 databases**. The limit can be lowered through configuration; this prototype caps it at 10 MiB and applies a matching SQLite page limit.
- Each operation transfers the whole SQLite file. Large or write-heavy databases are unsuitable for this design.
- SQL supports one statement per request, with up to 500 returned rows, a default five-second worker timeout, and a 128 MiB JS heap limit per worker. WASM memory is not fully governed by the JS heap limit; strict total-memory isolation is future work.
- Google-mode requests for one account are serialized from catalog read through completed storage writes, including requests whose client disconnects. External edits, multiple backend instances, and cross-file transactions are unsupported.
- A failed/timed-out Drive upload can have an uncertain outcome. Refresh and read back before retrying. There is no exactly-once request protocol or automatic write retry.
- Session expiry is seven days, with up to 20 active sessions per account. A session cookie contains an authenticated, encrypted Google credential that only the backend can decrypt. It is HTTP-only and secure in production. The Drive catalog stores hashes of random session IDs and expiries, so logout also invalidates a copied cookie. Google's browser folder picker receives a separate short-lived access token.
- Google mode stores database locations, destination folder preferences, and session records in a private, app-created **drivebase-catalog.json** file in Drive. It does not write account metadata or credentials to Render's filesystem. Signing in again discovers the catalog by its app properties after a restart or a cleared browser session. Do not delete or share this catalog; a deleted catalog cannot be rebuilt from database files automatically.
- Keep `TOKEN_ENCRYPTION_KEY` stable in Render's secret settings. Changing it requires users to sign in again; their Drive catalog and database files remain available. Browser cookies are needed for interactive access; unattended jobs and API keys are outside this version.
- The catalog initially lives in the app-created Drivebase folder. Choosing another database folder changes the destination of new databases without moving the catalog or existing files. If a new database upload succeeds but its catalog update fails, an unlisted file may remain in Drive; there is no cross-file transaction.
- User-created SQL triggers are not supported. JSON editing accepts object documents, with a 256 KiB request limit and 100 documents per list page.
- API keys, a public SDK, database deletion/import, backups/version restore, sharing, and distributed coordination are outside this MVP.

## Deployment and testing

See [deployment instructions](docs/DEPLOYMENT.md), [API reference](docs/API.md), and the [MVP acceptance checklist](docs/TESTING.md). No live cloud deployment is implied by the presence of these configuration files.

For Google credentials and choosing a specific existing folder, follow the [step-by-step Google setup guide](docs/GOOGLE_SETUP.md). Local API tests cover SQL, document CRUD, concurrent writes, persistence after restart, account isolation, and disabled sign-in; they do not exercise real Google authorization or Drive uploads.

## References

- [Google Drive file-specific permission scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google OAuth for web servers](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Render free services](https://render.com/docs/free)
- [sql.js SQLite engine](https://sql.js.org/)
