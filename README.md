# Phresh Mastery — Betting System

Production-ready Next.js + Supabase web app for tracking sports betting performance across multiple systems and cappers.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **Supabase** — Postgres + auth (email/password) + RLS + triggers
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

### 1. Supabase project
1. Create a project at https://supabase.com
2. In the SQL editor, run in order:
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_recompute.sql`
3. Enable email/password auth (Auth → Providers).
4. (Optional) Disable email confirmation under Auth → Providers → Email if you want instant sign-in for testing.

### 2. Environment
Copy `.env.example` to `.env.local` and fill in the values from your Supabase project settings:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
```

### 3. Install + run
```bash
npm install
npm run dev
```

Then visit http://localhost:3000, sign up, and create your first system.

### 4. (Optional) Seed demo data
After signing up at least once, run `supabase/seed.sql` in the SQL editor. It picks up the first user account and creates a demo system with two cappers and ~60 days of randomized history. Triggers will populate all rollups automatically.

## Data model

| Table | Purpose |
|---|---|
| `systems` | Top-level per-user betting system |
| `scaling_log_entries` | Unit size history (date-banded) |
| `cappers` | Per-system handicappers |
| `capper_day_entries` | One row per capper per date — daily totals or bet-level |
| `capper_bet_entries` | Individual bets when a day is in `bet_level` mode |
| `journal_day_entries` | Auto-derived per-system daily journal |
| `system_backups` | (optional) saved JSON backups |

### Calculation pipeline
1. Insert/update/delete on `capper_day_entries` or `capper_bet_entries` fires `recompute_capper(capper_id)`, which iterates that capper's days in date order and writes back rolling totals (cumulative $, units, ROI, streaks, win rate, etc.).
2. The same trigger then calls `recompute_journal(system_id)`, which wipes and rebuilds `journal_day_entries` from the union of capper days for that system.
3. Inserts/updates/deletes to `scaling_log_entries` recompute every capper in the affected system, then the journal.

This means the journal is always perfectly in sync — there is no drift between capper pages and the journal.

### Scaling rules
- Scale **up 25%** when cumulative system units cross `band_start + 25`.
- Scale **down 25%** when cumulative system units drop to `band_start - 25`.
- Round to the nearest whole dollar.
- New size applies **starting the next day** — add a new row to `scaling_log_entries` with `effective_date` set to the day after the threshold was crossed.

## Deploy to Vercel

1. Push to GitHub.
2. Import the repo in Vercel.
3. Set environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Deploy.

## Usage

- **Dashboard** — KPI summary, cumulative units chart, capper summary, daily summary.
- **Cappers** — list with phase + checklist; click a name to open the capper page (add days, bet-level editor, trend chart).
- **Journal** — read-only daily journal, auto-synced.
- **Scaling Log** — add new unit-size rows when you cross a band.
- **Settings** — edit system metadata; export/import JSON backup.
