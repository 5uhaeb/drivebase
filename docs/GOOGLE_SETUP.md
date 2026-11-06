# Connect an existing Google Drive folder

The folder link supplies its ID; it does not grant our Render server permission to upload database files. This setup uses a Google OAuth web client and Google's folder picker with the limited `drive.file` permission. A folder does not need to be public.

## 1. Create the Google Cloud project

Open [Google Cloud Console](https://console.cloud.google.com/projectcreate) while signed in to the account that can edit your database folder. Create a project named **Drivebase**. Select it in the project selector.

Open **APIs & Services → Library** and enable both:

- **Google Drive API**
- **Google Picker API**

On the project's dashboard, record its **Project number**. Use the numeric project number, not the project ID or OAuth client ID.

## 2. Configure Google sign-in

Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**).

1. Set the app name to **Drivebase**, with your support and contact email.
2. Choose an external audience and keep publishing status in **Testing** for the prototype.
3. Add your own Gmail address under **Test users**.
4. In **Data Access / Scopes**, add identity scopes (`openid`, email, profile) and **`https://www.googleapis.com/auth/drive.file`**. Do not add Gmail API or full Drive access.
5. Under **Clients**, create an OAuth client of type **Web application**.
6. Add this authorized JavaScript origin:

```text
https://drivebase-5uhaeb.vercel.app
```

7. Add this authorized redirect URI exactly:

```text
https://drivebase-5uhaeb.vercel.app/api/auth/google/callback
```

8. Download the client JSON file and keep it outside the Git repository. The backend needs its client ID and client secret. Share the local file path with the coding agent, rather than pasting the secret into chat.

The consent-screen testing status can limit refresh-token lifetime. Reauthorization may be needed while testing; confirm current Google restrictions before using the service unattended.

## 3. Create the folder-picker API key

In the **same Cloud project**, open **APIs & Services → Credentials → Create credentials → API key**.

- Under **Application restrictions**, select **Websites / HTTP referrers** and allow both `https://drivebase-5uhaeb.vercel.app/*` and `https://docs.google.com/*`. Google's picker iframe uses the second origin.
- Under **API restrictions**, restrict the key to **Google Picker API**.
- Keep the generated key and project number for the backend configuration.

This browser API key is used by Google's picker. It is separate from the OAuth client secret. The picker also receives a short-lived access token; the Google refresh token is carried in an encrypted HTTP-only session cookie that only Render can decrypt.

## 4. Configure Render before enabling accounts

The current free backend runs with `AUTH_MODE=setup`, which disables sign-in. Before enabling Google mode:

1. Keep the service on the **Free** plan with one instance. The database catalog and session registry are stored in Drive, so a persistent Render disk is unnecessary.
2. Configure these variables on the **drivebase-api** Render service:

| Variable                      | Value                                                          |
| ----------------------------- | -------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`            | From the OAuth client JSON                                     |
| `GOOGLE_CLIENT_SECRET`        | From the OAuth client JSON                                     |
| `GOOGLE_PICKER_API_KEY`       | The restricted browser API key                                 |
| `GOOGLE_CLOUD_PROJECT_NUMBER` | The numeric Cloud project number                               |
| `FRONTEND_URL`                | `https://drivebase-5uhaeb.vercel.app`                          |
| `GOOGLE_REDIRECT_URI`         | `https://drivebase-5uhaeb.vercel.app/api/auth/google/callback` |
| `TOKEN_ENCRYPTION_KEY`        | A stable base64-encoded 32-byte random key                     |
| `AUTH_MODE`                   | `google`                                                       |

Generate the encryption key once with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it backed up securely and preserve it across deploys. Do not put any client secret or refresh token in frontend variables or Git.

## 5. Choose your folder and test

1. Visit the live site and sign in using the Google account added as a test user.
2. Open **Connection → Choose an existing folder**.
3. In Google's picker, select the folder you shared for database testing. The backend verifies that it is a folder and that the account can create files there. Pasting a folder ID does not bypass authorization.
4. Confirm the folder name in Connection settings, then create a **new** database named `folder-test`.
5. Run these statements separately:

```sql
CREATE TABLE test_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
```

```sql
INSERT INTO test_items(value) VALUES ('Drive persistence test');
```

```sql
SELECT * FROM test_items;
```

6. Save a JSON document in Collections and confirm that `folder-test.sqlite` appears inside the selected Drive folder.
7. Reload the page, restart the backend, and verify the SQL row and JSON document remain available. Download the SQLite file for an independent check.

Selecting a folder changes where **new databases** are created. Existing databases keep their original file IDs and locations; this operation does not move them or import the folder's other contents.

References: [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [file-specific Drive scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Google Picker setup](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample).
