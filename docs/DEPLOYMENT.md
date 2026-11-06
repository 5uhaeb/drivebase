# Deployment

The frontend and backend must use the same `main` source revision. The database server must run as a single Render instance with a persistent disk. A paid Render plan is needed for that disk; check current pricing before deployment.

## Setup-only preview

Until Google credentials are available, the public preview uses `AUTH_MODE=setup` on a free Render instance. This mode disables Google sign-in, rejects the demo login, and rejects database operations. The frontend explicitly displays that Drive setup is pending. No account credentials or database data are accepted in this mode, so a persistent disk is not needed yet. Free Render services can sleep when idle; the first page load may wait for the backend to start.

Before changing to `AUTH_MODE=google`, move the backend to a paid plan, attach the persistent disk at `/var/data`, set `DATA_DIR=/var/data`, configure the Google credentials and token encryption key, and register the exact frontend callback URL. Do not enable user accounts on ephemeral control storage. The root `render.yaml` describes the full Google-enabled deployment rather than the temporary free preview.

## Google setup

1. Create a Google Cloud project and enable **Google Drive API**.
2. Configure the Google Auth consent screen. During development keep it in Testing and add the intended Google accounts as test users. Review Google's current testing restrictions and refresh-token expiry rules before relying on background access.
3. Add identity scopes (`openid`, email, profile) and **`https://www.googleapis.com/auth/drive.file`**. Full Drive access and Gmail API permissions are unnecessary.
4. Create an OAuth client of type **Web application**.
5. Add the authorized redirect URI for local development: **`http://localhost:5173/api/auth/google/callback`**. Use `localhost` consistently, rather than switching to `127.0.0.1` in the browser.
6. For deployment, add **`https://YOUR-FRONTEND.vercel.app/api/auth/google/callback`**. Add a custom frontend domain as a separate redirect URI if used.
7. Set `AUTH_MODE=google`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL`, and `TOKEN_ENCRYPTION_KEY` on the API.

Generate the encryption key locally:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Keep the generated key in the Render secret settings and a secure backup. Do not commit it, put it in frontend variables, or regenerate it during each deployment.

On sign-in, users approve file-specific Drive access and offline authorization. The API creates a visible **Drivebase** folder. It accesses files it creates through this permission. It does not need access to every file in the user's Drive.

Sharing a personal Drive folder with a service account is not the authentication approach used here. Service accounts have no personal storage quota and cannot own files.

## Render backend

1. Connect the private GitHub repository to Render.
2. Create a Blueprint from the root `render.yaml`. It configures one Node service, a 1 GiB persistent disk, and the API health endpoint.
3. Set `FRONTEND_URL` to the exact frontend origin, without a trailing slash.
4. Set `GOOGLE_REDIRECT_URI` to that origin plus `/api/auth/google/callback`.
5. Add the Google client credentials and the generated encryption key.
6. Confirm `NODE_ENV=production`, `AUTH_MODE=google`, and `DATA_DIR=/var/data`.
7. Record the actual Render service URL. It may differ from the suggested `drivebase-api.onrender.com` name.

Build: `npm ci --include=dev && npm run build -w apps/api`

Start: `npm run start -w apps/api`

Health: `/api/health`

Do not enable horizontal scaling or add a Node process manager with multiple workers. Preserve the disk and encryption key across redeployments. Render disks impose deployment downtime; this prototype accepts that limitation.

## Vercel frontend

1. Import the repository into Vercel.
2. Set **Root Directory to the repository root**, not `apps/web`.
3. Use the root `vercel.json`. Set Framework Preset to **Other** if auto-detection overrides the static configuration.
4. In `vercel.json`, replace the `/api/:path*` destination with the actual Render URL while preserving `/api/:path*`.
5. Keep the API rewrite before the SPA fallback. The build command is `npm run build -w apps/web`, output `apps/web/dist`.
6. Deploy and copy the final frontend URL into the Render and Google settings described above.

No Google secret belongs on Vercel or in a `VITE_*` variable. Cookies are host-only, HTTP-only, SameSite=Lax, and secure in production. Vercel proxies the Google callback response so the cookie belongs to the frontend origin. Do not call Render directly from frontend JavaScript.

Preview domains require matching Google redirect URIs and backend frontend-origin settings; they are not automatically supported. Use a fixed staging frontend/backend pair for integration testing.

## Environment reference

| Variable               | Purpose                                                                         |
| ---------------------- | ------------------------------------------------------------------------------- |
| `PORT`                 | Render-provided port; local default 4000                                        |
| `NODE_ENV`             | `production` in Render                                                          |
| `AUTH_MODE`            | `demo` for local only, `setup` for disabled sign-in, `google` for real accounts |
| `FRONTEND_URL`         | Browser origin and allowed write-request Origin                                 |
| `GOOGLE_REDIRECT_URI`  | Frontend `/api/auth/google/callback` URL                                        |
| `GOOGLE_CLIENT_ID`     | Google OAuth web client ID                                                      |
| `GOOGLE_CLIENT_SECRET` | Google OAuth web client secret                                                  |
| `TOKEN_ENCRYPTION_KEY` | Base64 encoding of 32 random bytes                                              |
| `DATA_DIR`             | Durable metadata directory; `/var/data` on Render                               |
| `MAX_DATABASE_BYTES`   | Default and maximum 10485760, 10 MiB; may be lowered to at least 16 KiB         |
| `QUERY_TIMEOUT_MS`     | Default 5000                                                                    |

## Before real users

Complete the acceptance checklist, verify consent-screen publishing requirements, arrange metadata backups, and resolve the single-writer and ambiguous-upload limitations for the intended workload. A successful build is not evidence that OAuth or cloud persistence has been exercised.

References: [Google OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [service-account file ownership](https://developers.google.com/workspace/drive/api/guides/folder), [Render disks](https://render.com/docs/disks).
