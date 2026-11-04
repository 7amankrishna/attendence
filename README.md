# RollFlow Attendance Tracker

RollFlow is a teacher-first attendance tracker. Instead of showing an overwhelming table of the whole class, it presents a small configurable batch and automatically moves to the next group.

## Included features

- Five students at a time by default
- Teacher-selectable rows and columns
- Present, absent, late and excused states
- Automatic next-group movement
- Undo and keyboard shortcuts
- Search and status filters
- Incomplete-student warning before save
- Five-day progress and at-risk students
- Responsive mobile layout
- PHP REST API with PDO prepared statements
- MySQL schema and 25 sample students
- Demo fallback when the API is not connected
- Google Sheets OAuth connection
- Import students from an existing Sheet
- Permission-aware attendance updates with a success dialog
- Ordered three-copy backup: Supabase → InfinityFree MySQL → Google Sheets
- Shared Sync ID for cross-database troubleshooting
- Automatic backup after each attendance mark
- Vercel and InfinityFree deployment support

## Project structure

```text
frontend/        React + Vite application
backend/api/     PHP endpoints for InfinityFree
database/        MySQL setup file
supabase/        Supabase backup-table setup
vercel.json      Vercel build and SPA routing
```

For complete deployment instructions, read [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md).

## Run locally

```bash
cd frontend
npm install
npm run dev
```

Without a PHP server, the UI automatically uses demo data. To test the full backend locally, put `backend/api` in a PHP web server, copy `config.example.php` to `config.php`, and set `VITE_API_URL` in `frontend/.env`.

## Connect React to MySQL on InfinityFree

React must not connect directly to MySQL. The correct flow is:

```text
React browser app → PHP API → InfinityFree MySQL
```

### 1. Create the database

1. Open the InfinityFree Control Panel.
2. Open **MySQL Databases** and create a database named `rollflow`.
3. Save the displayed database hostname, database name and database username.
4. Open phpMyAdmin, select the database, choose **Import**, and import `database/setup.sql`.

### 2. Configure PHP

1. Copy `backend/api/config.example.php` as `backend/api/config.php`.
2. Enter the exact credentials from your InfinityFree account.
3. Use the MySQL hostname from the panel. Do not use `localhost`.
4. Keep `config.php` private and never upload it to GitHub.

### 3. Build React on your computer

```bash
cd frontend
npm install
npm run build
```

InfinityFree does not run Node.js. Vite creates static browser files inside `frontend/dist`.

### 4. Upload to InfinityFree

Inside the domain's `htdocs` folder, upload:

```text
htdocs/
  index.html          from frontend/dist
  assets/             from frontend/dist
  api/                contents of backend/api, including your config.php
```

Upload the **contents** of `dist`, not the `dist` folder itself. Because the frontend and API are on the same domain, the default `./api` URL works without changes.

### 5. Test the connection

Visit:

```text
https://YOUR-DOMAIN/api/health.php
```

Expected result:

```json
{"success":true,"message":"PHP API and MySQL are connected"}
```

Then open your domain. The yellow **Demo data** label should disappear, and saved attendance will be stored in MySQL.

## Important security note

This is suitable for a college project/demo. Before real institutional use, add teacher login, CSRF protection, role permissions, an audit log, backups, and a restricted `ALLOWED_ORIGIN`.

## Connect Google Sheets

### Google Cloud setup

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create or select a project.
3. Enable **Google Sheets API**.
4. Configure the OAuth consent screen.
5. Create an **OAuth Client ID** with application type **Web application**.
6. Add these Authorized JavaScript origins:
   - `http://localhost:5173` for local development
   - Your InfinityFree domain, for example `https://your-site.infinityfreeapp.com`
7. Copy `frontend/.env.example` to `frontend/.env` and add:

```env
VITE_GOOGLE_CLIENT_ID=123456789-real-value.apps.googleusercontent.com
```

Use your real Web OAuth Client ID. The text `YOUR_CLIENT_ID...` is only an example and will be rejected by the app. The value is deployment configuration and is not shown as an input in the teacher interface. Google authorization uses a full-page redirect instead of a popup.

Run `npm run build` again after changing the client ID, because Vite places environment values into the compiled frontend.

### Sheet format

Create a tab called `Students` (or put this data in the first tab) with headers:

| Roll No | Student Name | Email |
|---|---|---|
| 24CS001 | Aarav Sharma | optional@example.com |

The teacher clicks **Connect Google Sheet**, pastes the Sheet URL, and signs in. RollFlow imports the students. When attendance is saved, the app creates or updates an `Attendance` tab containing:

| Date | Roll No | Student Name | Status | Updated At | Sync ID |
|---|---|---|---|---|---|

The update is an upsert by `Date + Roll No`, so saving again changes the existing record instead of creating a duplicate. If the signed-in Google account only has view access, RollFlow shows a permission error and does not claim that the update succeeded.
