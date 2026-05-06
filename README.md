# Phresh Mastery — Betting System

Production-ready Next.js + Clerk + Supabase web app for tracking sports betting performance across multiple systems and cappers.

## Stack

- **Next.js 15** (App Router) + TypeScript + React 19
- **Clerk** — email/password auth, hosted UI
- **Supabase Postgres** — DB + triggers (used as DB only; auth is Clerk)
- **Tailwind CSS** — dark theme, electric-blue accent
- **Recharts** — cumulative units chart, per-capper trend
- **html-to-image** — PNG export of dashboard / charts

## Highlights

- Multiple **systems** per user; each system has its own scaling log, cappers, journal, dashboard, exports.
- All capper rollups + the **Daily Betting Journal** are computed by Postgres triggers — there is one source of truth.
- **Two entry modes**: `daily_totals` for fast historical entry, `bet_level` where the day auto-sums from individual bets. Voids excluded.
- **Scaling logic** is deterministic: a new unit size only applies starting on its `effective_date`. No retroactive recalculation.
- Per-system **JSON backup / import** with full round-trip restore.
- PNG export for the dashboard and for individual capper pages.

## Local setup

### 1. Clerk
1. Sign up at https://clerk.com (free tier covers up to 10k MAU).
2. Create an app. Choose **email + password** as the sign-in method.
3. Grab your **Publishable Key** and **Secret Key** from API Keys.

### 2. Supabase project
1. Create a project at https://supabase.com.
2. In the SQL editor, run in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_recompute.sql`
   - `supabase/migrations/0003_clerk.sql`
3. Project Settings → API: copy the **Project URL** and the **service_role** secret. (We don't use the anon key — Clerk handles auth, the server uses the service role.)

### 3. Environment
Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
```

### 4. Install + run
```bash
npm install
npm run dev
```

Then visit http://localhost:3000, sign up, and create your first system.

### 5. (Optional) Seed demo data
After signing up once, edit `supabase/seed.sql` and replace the `select id from auth.users` lookup with your Clerk user ID (visible at the top of the Clerk dashboard, format `user_xxx`), then run the file in the SQL editor.

## Data model

| Table | Purpose |
|---|---|
| `systems` | Top-level betting system (`user_id` = Clerk user ID, text) |
| `scaling_log_entries` | Unit size history (date-banded) |
| `cappers` | Per-system handicappers |
| `capper_day_entries` | One row per capper per date — daily totals or bet-level |
| `capper_bet_entries` | Individual bets when a day is in `bet_level` mode |
| `journal_day_entries` | Auto-derived per-system daily journal |

### Calculation pipeline
1. Insert/update/delete on `capper_day_entries` or `capper_bet_entries` fires `recompute_capper(capper_id)`, which iterates that capper's days in date order and writes back rolling totals (cumulative $, units, ROI, streaks, win rate, etc.).
2. The same trigger then calls `recompute_journal(system_id)`, which wipes and rebuilds `journal_day_entries` from the union of capper days for that system.
3. Inserts/updates/deletes to `scaling_log_entries` recompute every capper in the affected system, then the journal.

The journal is always perfectly in sync — no drift between capper pages and the journal.

### Scaling rules
- Scale **up 25%** when cumulative system units cross `band_start + 25`.
- Scale **down 25%** when cumulative system units drop to `band_start - 25`.
- Round to the nearest whole dollar.
- New size applies **starting the next day** — add a new row to `scaling_log_entries` with `effective_date` set to the day after the threshold was crossed.

### Auth + access control
- Clerk handles all sign-in / sign-up / sessions. UI lives at `/sign-in` and `/sign-up`.
- The server uses the Supabase service role key (bypasses RLS) and filters every query by the Clerk `userId` returned from `auth()`. RLS policies were dropped in `0003_clerk.sql` since the schema's `auth.uid()` calls only work with Supabase Auth.
- **Never expose the service role key to the browser.** All mutating operations are wrapped as Next.js Server Actions in `src/app/(app)/_actions.ts`.

## Deploy to Vercel

1. Push to GitHub (`gh repo create` + `git push`).
2. Import in Vercel.
3. Add env vars (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`).
4. Deploy.

## Usage

- **Dashboard** — KPI summary, cumulative units chart, capper summary, daily summary.
- **Cappers** — list with phase + checklist; click a name to open the capper page (add days, bet-level editor, trend chart).
- **Journal** — read-only daily journal, auto-synced.
- **Scaling Log** — add new unit-size rows when you cross a band.
- **Settings** — edit system metadata; export/import JSON backup.
