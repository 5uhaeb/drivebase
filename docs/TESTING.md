# MVP acceptance checklist

This checklist is prepared for the testing phase after MVP delivery. It is not a record of passing tests. Cloud authorization, storage behavior, browser interactions, and deployment have not been verified by compilation.

## Local workspace

- [ ] Install from the lockfile, typecheck, and build.
- [ ] Start both services and open the local workspace.
- [ ] Create two databases and verify selection, table discovery, and independent contents.
- [ ] Run the guide's CREATE, INSERT, SELECT statements one by one.
- [ ] Check parameterized SQL through the API, errors for multiple statements, and query timeout behavior.
- [ ] Check result truncation and explicit LIMIT/OFFSET pagination.
- [ ] Create, edit, paginate, and delete JSON documents; verify object validation and collection name validation.
- [ ] Download a database and open it in a separate SQLite client.
- [ ] Restart the API and verify metadata, database contents, and active sessions survive.
- [ ] Check empty states, errors, keyboard execution, mobile layout, keyboard focus, and modal dismissal.

## Google integration

- [ ] Sign in with a test Gmail account and approve file-specific Drive access.
- [ ] Verify a Drivebase folder and SQLite database file are created in that account.
- [ ] Verify SQL writes and JSON writes survive an API restart and a fresh session.
- [ ] Sign in as a second account; confirm it cannot list, query, or export the first account's database IDs.
- [ ] Decline consent, revoke access, expire a session, and sign in again; verify useful recovery messages.
- [ ] Validate refresh-token behavior under the configured Google consent-screen publishing status.
- [ ] Simulate Drive quota denial, file deletion, folder deletion, and upload failure.
- [ ] After an interrupted upload, read back the database and establish the actual outcome before retrying.

## Deployment

- [ ] Confirm Vercel API rewrites and frontend-domain OAuth callbacks preserve secure session cookies.
- [ ] Confirm wrong-Origin writes and unauthenticated operations fail.
- [ ] Confirm production rejects AUTH_MODE=demo and missing Google/encryption settings.
- [ ] Confirm only one Render instance/process runs and the metadata disk is persistent.
- [ ] Redeploy Render and verify Drive data, catalog, encrypted tokens, and sessions remain usable.
- [ ] Exercise simultaneous writes against the same database and verify serialization within the one API process.
- [ ] Measure read/write latency and API quotas with representative databases before choosing workload limits.
- [ ] Verify metadata backup and recovery procedures; catalog rebuild from Drive is not implemented.
