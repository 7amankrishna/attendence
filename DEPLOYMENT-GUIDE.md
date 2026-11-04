# RollFlow deployment and three-copy backup guide

RollFlow can run from Vercel or InfinityFree. In both deployments, attendance is written in this order:

1. Supabase PostgreSQL
2. InfinityFree MySQL through the PHP API
3. Google Sheets through the teacher's Google OAuth permission

Each save receives one `sync_id`. The same ID is stored in all three destinations, making mismatches easier to trace. A failure in one destination does not stop the remaining backups. RollFlow displays the result of each destination and keeps failed reports in the browser under `rollflow_pending_syncs`.

## Before deployment

You need:

- An InfinityFree account and MySQL database
- A Supabase project
- A Google Cloud project with Google Sheets API enabled
- Optionally, a Vercel account connected to GitHub

Never put a Supabase secret/service-role key, MySQL password, or Google client secret in the React `.env` file. Browser code may contain only the Supabase publishable key and Google OAuth Client ID.

## Part 1 — Supabase backup

1. Create a Supabase project.
2. Open **SQL Editor**.
3. Run `supabase/setup.sql` from this repository.
4. Open **Authentication → Sign In / Providers → Anonymous Sign-Ins** and enable it.
5. Open **Project Settings → API**.
6. Copy the Project URL and browser-safe publishable key.
7. Add them to `frontend/.env`:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

The app creates a persistent Supabase anonymous-auth session in the teacher's browser. The included Row Level Security policies require authentication and restrict every backup row to its session owner. For multi-device institutional use, replace anonymous sign-in with permanent teacher accounts.

## Part 2 — InfinityFree MySQL and PHP API

### New installation

1. Open InfinityFree Control Panel → **MySQL Databases**.
2. Create a database.
3. Open phpMyAdmin and import `database/setup.sql`.
4. Copy `backend/api/config.example.php` to `backend/api/config.php`.
5. Enter the exact database host, name, username and hosting-account password.
6. In `ALLOWED_ORIGINS`, add your Vercel URL, InfinityFree URL and localhost development URL.
7. Upload the `backend/api` folder to `htdocs/api`.
8. Visit `https://YOUR-INFINITYFREE-DOMAIN/api/health.php`.

Expected response:

```json
{"success":true,"message":"PHP API and MySQL are connected"}
```

### Existing RollFlow database

If you imported an older version of `setup.sql`, run:

```text
database/migrations/002_add_sync_id.sql
```

Do not import the full setup again over an existing database.

### Frontend API environment value

Add this to the frontend environment:

```env
VITE_INFINITYFREE_API_URL=https://YOUR-INFINITYFREE-DOMAIN/api
```

Do not add a trailing slash.

## Part 3 — Google Sheets

1. Open Google Cloud Console.
2. Create/select a project and enable **Google Sheets API**.
3. Configure the OAuth consent screen.
4. Create an OAuth Client ID with type **Web application**.
5. Add Authorized JavaScript origins:
   - `http://localhost:5173`
   - Your Vercel production URL
   - Your InfinityFree HTTPS URL
6. Add the matching Authorized redirect URIs with a trailing slash:
   - `http://localhost:5173/`
   - `https://your-project.vercel.app/`
   - `https://your-site.infinityfreeapp.com/`
7. Add the Client ID to `frontend/.env`:

```env
VITE_GOOGLE_CLIENT_ID=123456789-real-value.apps.googleusercontent.com
```

Do not copy the example literally. It must be the real **Web application** Client ID from Google Cloud. The Client ID is configured only through the deployment environment and is not entered in the teacher interface.

The student spreadsheet should contain a `Students` tab with these headers:

| Roll No | Student Name | Email |
|---|---|---|
| 24CS001 | Aarav Sharma | optional@example.com |

RollFlow creates/updates an `Attendance` tab. The sixth column stores the common Sync ID.

## Deploy the frontend to Vercel

1. Push the repository to GitHub (already done for this project).
2. In Vercel, select **Add New → Project**.
3. Import `7amankrishna/attendence`.
4. Keep the repository root as the Root Directory. `vercel.json` provides the build settings.
5. Add these Environment Variables for Production and Preview:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `VITE_INFINITYFREE_API_URL`
   - `VITE_GOOGLE_CLIENT_ID`
6. Deploy.
7. Add the final Vercel production URL to Google Authorized JavaScript origins and `ALLOWED_ORIGINS` in InfinityFree `config.php`.
8. Rebuild/redeploy after any Vite environment-variable change.

If your Vercel Root Directory is set to `frontend`, the repository also includes `frontend/vercel.json`. In that case, use the normal commands `npm install` and `npm run build`; do not use `npm install --prefix frontend`, which would incorrectly look for `frontend/frontend/package.json`.

### Google authorization troubleshooting

- `YOUR_CLIENT_ID.apps.googleusercontent.com` is a placeholder and cannot authenticate.
- Create a **Web application** OAuth client, not a Desktop client.
- Add the exact origin displayed by RollFlow, for example `https://your-app.vercel.app`, to **Authorized JavaScript origins**. Do not add a path or trailing page name.
- RollFlow uses a full-page Google redirect, so popup permission is not required.
- Add `https://your-domain/` as an Authorized redirect URI as well as `https://your-domain` as an Authorized JavaScript origin.
- After changing a Vercel environment variable, redeploy because Vite embeds it at build time.

## Deploy the frontend to InfinityFree

1. On your computer:

```bash
cd frontend
copy .env.example .env
# Edit .env with your real browser-safe values
npm install
npm run build
```

2. Upload the **contents** of `frontend/dist` into `htdocs`.
3. Upload `backend/api` into `htdocs/api`.
4. Because frontend and PHP share one domain, you may leave `VITE_INFINITYFREE_API_URL` blank before building. The app will use `./api`.
5. Open the site and connect the Google Sheet.

InfinityFree hosts the compiled static React files; it does not run the Vite development server.

## Verification checklist

1. Connect a Google Sheet with edit permission.
2. Mark one test student present.
3. Wait for the header to show **3 copies safe**.
4. In Supabase Table Editor, confirm the row and copy its `sync_id`.
5. In phpMyAdmin, confirm the same `sync_id` in `attendance_records`.
6. In the Google Sheet's `Attendance` tab, confirm the same ID in column F.
7. Change the student to absent and verify all three records update instead of creating duplicates.

If one destination fails, the save dialog identifies it. Use the Sync ID to compare the successful copies and repair the missing destination.
