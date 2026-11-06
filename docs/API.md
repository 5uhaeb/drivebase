# MVP API

All routes are under `/api`. The dashboard uses the frontend origin's `/api` proxy. Google authentication uses an encrypted HTTP-only session cookie, with a session ID hash and expiry stored in the user's private Drive catalog. The backend reads and validates that catalog before each authenticated request. Local demo sessions use local metadata.

Write requests require the exact configured `FRONTEND_URL` Origin header. Requests with bodies require `Content-Type: application/json`. Errors have the shape `{ "error": "message" }`. Rate limit: 120 requests per minute per client IP, including authorization routes.

## Application connections

The signed-in owner's Connection page can provision the portfolio, watchparty, and taskflow databases via `POST /integrations/projects`. It downloads a private credentials bundle containing database IDs and encrypted application keys. Keep this file outside source control. Calling the endpoint again replaces the preceding keys for these projects.

Server applications authenticate with `Authorization: Bearer <apiKey>`. Each key permits only its database's routes, requires a matching active hash in the Drive catalog, expires after 180 days, and survives dashboard logout. Valid application credentials do not require a browser Origin header. Google access must remain authorized independently; Google's Testing mode can expire refresh tokens after seven days.

`POST /databases/:id/import` accepts `application/vnd.sqlite3` up to the database size limit. It validates a Drivebase SQLite snapshot before replacing that database's file. Export the destination first when it contains data. Import preserves the database's ID and Drive file ID.

| Method | Route                                                          | Purpose                                     |
| ------ | -------------------------------------------------------------- | ------------------------------------------- |
| GET    | `/health`                                                      | API status, version, mode                   |
| GET    | `/auth/me`                                                     | Current user, mode, size limit              |
| POST   | `/auth/demo`                                                   | Local-only demo session                     |
| GET    | `/auth/google`                                                 | Redirect to Google consent                  |
| GET    | `/auth/google/callback`                                        | OAuth callback                              |
| POST   | `/auth/logout`                                                 | End the current session                     |
| GET    | `/databases`                                                   | List current user's databases               |
| POST   | `/databases`                                                   | Create database: `{ "name": "my-project" }` |
| GET    | `/databases/:id/schema`                                        | SQL tables and document collections         |
| POST   | `/databases/:id/query`                                         | Execute one SQL statement                   |
| GET    | `/databases/:id/export`                                        | Download SQLite file                        |
| GET    | `/databases/:id/collections/:collection/documents?offset=0`    | Up to 100 documents                         |
| PUT    | `/databases/:id/collections/:collection/documents/:documentId` | Create or replace an object document        |
| DELETE | `/databases/:id/collections/:collection/documents/:documentId` | Delete one document                         |

## Folder selection

`POST /drive/picker` supplies Google's browser picker with a short-lived access token, restricted browser API key, and project number for the signed-in Google account. This response must not be logged or cached. Refresh tokens remain on the backend.

`PUT /drive/folder` accepts `{ "folderId": "..." }` after the user has selected that folder in Google Picker. The server verifies the folder MIME type, trash state, and `canAddChildren` capability through the user's authorized Drive API client. It changes the destination of new databases only. Merely knowing a folder ID does not grant access to it.

Both endpoints require a session, the configured request Origin, and Google mode. They are disabled in setup mode.

## SQL

```json
{
  "sql": "SELECT * FROM notes WHERE id = ?",
  "params": [1]
}
```

Parameters support strings, finite numbers, and null. SQL is limited to one statement per call. Explicit transactions, ATTACH, PRAGMA, VACUUM, and CREATE TRIGGER are not supported through this endpoint. JSON collections are managed through the collection API.

```json
{
  "columns": ["id", "title"],
  "rows": [[1, "My first idea"]],
  "changes": 0,
  "truncated": false,
  "persisted": true,
  "storage": "google-drive",
  "database": {
    "id": "...",
    "name": "...",
    "fileId": "...",
    "size": 16384,
    "ownerId": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

`persisted: true` means that this successful operation's resulting state is present in the selected storage provider (unchanged reads require no upload). The service does not implement exactly-once delivery. After a network or upload error, read back before retrying a mutation. Result rows are capped at 500; use LIMIT and OFFSET. Blobs are represented by a size description in query output, rather than raw bytes.

## Documents

Collection names start with an ASCII letter, then contain up to 63 ASCII letters, digits, underscores, or hyphens. Document IDs contain 1–128 ASCII letters, digits, underscores, or hyphens. Collections appear after their first saved document; empty collection definitions are not retained.

PUT body:

```json
{
  "data": {
    "title": "My first note",
    "tags": ["idea"],
    "published": false
  }
}
```

PUT replaces the whole document at the given ID. It is not a patch or MongoDB query endpoint. Listing returns `{ "documents": [{ "id": "...", "data": {}, "updatedAt": "..." }], "limit": 100, "offset": 0, ... }`. JSON reads are ordered by update time descending, then document ID.
