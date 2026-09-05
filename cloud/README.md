# renmiao cloud authentication

This directory contains the account API and administrator console for renmiao.
The Electron app's existing `127.0.0.1:23333-23337` server remains a
local Agent hook transport; it is not the public account service.

## Local development

```bash
npm run dev
```

This command starts the local API on the first free port in `8787–8791`, waits
for its health check, and launches the Electron desktop app with the matching
API address. It avoids the common stale-process `EADDRINUSE` problem. Local
accounts, sessions, and audit records are persisted at
`~/.renmiao/auth-dev.json`, so restarting the app or updating the source does
not require users to register again. Verification codes are sent through
Resend and are never printed to the terminal. Set `RENMI_AUTH_DATA_PATH` to
override the local data-file location.

Before running it, copy `cloud/.env.example` to `cloud/.env`, generate the
administrator password hash, and fill in `RESEND_API_KEY` and a verified
`AUTH_EMAIL_FROM` sender address. If those values are missing, the API exits
with a configuration error instead of exposing codes locally.

The admin console is available at `http://127.0.0.1:<the-selected-port>/admin/`
while the local service is running.

In the administrator console, `重置密码` opens a form for the administrator
to set a new password directly. It does not send a code to the user's email;
the API hashes the new password and revokes the user's existing sessions.

Usernames are display labels and may repeat; the bound email remains unique
per account. Each user row also has a `资料` editor. It manages the account's active pet
theme/variant/color/accessory and the complete Study Companion state (tasks,
Pomodoro timer, view, points, and streaks). The desktop app loads this profile
after login, saves changes periodically, saves again on logout/quit, and keeps
the local study file only as a per-account cache. A first login may migrate
legacy unbound local study data to that account; a different account never
reads that cache.

## Cloud deployment

1. Create a managed PostgreSQL/Supabase project.
2. Run `cloud/db/001_auth.sql`.

   The SQL is idempotent and includes the `users.profile_state` and
   `users.profile_updated_at` columns used for durable account profiles. It also
   removes the legacy unique constraint on `username_normalized` while keeping
   the unique constraint on `email_hash`. Run it again on an existing project
   so all migrations are applied.
3. Generate a password hash:

   ```bash
   node cloud/api/cli.js hash-password
   ```

4. Configure the variables in `cloud/.env.example` through the deployment
   platform's secret store.
5. Configure the email provider's SPF/DKIM records.
6. Start the API with `node cloud/api/index.js`.
7. Build the Electron app with `RENMI_AUTH_API_URL` set to the deployed HTTPS
   API URL.

For example, use
`RENMI_AUTH_API_URL=https://auth.example.com npm run build:mac` or the
corresponding Windows/Linux build command. The packaging hook embeds only this
public endpoint; database keys and administrator credentials remain server-side
secrets.

For a hosted process, bind `AUTH_HOST` to `0.0.0.0` and set
`AUTH_TRUST_PROXY=1` only when the platform puts a trusted reverse proxy in
front of the service. The API itself does not terminate TLS; put it behind the
platform's HTTPS endpoint.

The Supabase service-role key must stay on the API server. It must never be
placed in the Electron bundle, browser code, or admin page.

Profile writes use `profile_updated_at` as an optimistic concurrency token. If
an administrator edits a profile while the desktop app is saving, the client
receives the newer cloud profile and applies it instead of overwriting the
administrator's change.

The current API uses Node's built-in scrypt password KDF so this repository can
run without a native cloud dependency. Before production, keep the parameters
under review and consider migrating to Argon2id if the hosting platform makes
it available. Production deployments should also replace the process-local
rate limiter with a shared Redis/Upstash limiter when running multiple API
instances.
