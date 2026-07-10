# The Good Plans Co — client portal

React + Supabase coaching app at **portal.thegoodplansco.com** (Vercel,
auto-deploys from `main`; GitHub `jaxcox/GoodPlansClientPortal`). Coaching
clients log weekly KPIs; coaches view and manage them. Separate from the
marketing site (different repo: `~/Documents/good-plans-co-website`).

- **`OPERATIONS.md`** in this repo is the owner-facing runbook written for Jackie
  (services, maintenance, backups, troubleshooting) — not a Claude brief.
- Brand copy rules live in `~/.claude/CLAUDE.md` and apply to all portal copy.

## Stack & deploy
- React 18 + react-router-dom; Vite; Tailwind (`src/index.css`, brand tokens).
  Supabase = Postgres + Auth + Edge Functions.
- Repo path `~/Documents/portal rebuild` (note the space). `npm run dev`,
  `npm run build`, `npx tsc --noEmit`.
- Auto-deploys from `main` via Vercel. Supabase project "Good Plans Portal"
  (id `wpgaxytyqaoxedirzvmq`).
- **Edge Functions deploy via the Supabase DASHBOARD paste editor** — CLI login
  fails in this environment. Keep function comments ASCII: the Deno bundler
  rejects non-ASCII characters (em dashes, arrows).

## Key domain logic
- **"Weeks behind":** `src/lib/week.ts` `missedWeeksBetween()`, anchored by
  `entryStartDate()` = the LATER of `client.created_at` and the first day of the
  month after the onboarding-year budget's `ytd_thru_month`. Used in
  `WeeklyDashboard` and `WeeklyEntryPage`. Editing a client's YTD in Settings
  moves this start — that is the intended way to reset the entry expectation.
- **Budgets** are keyed `(client_id, year)`. `ytd_thru_month` is 0-indexed and
  inclusive (5 = through June); YTD actuals cover months as a lump, so weekly
  entry begins the month AFTER it.
- **Boundary weeks** (a Sun-Sat week spanning two months) split into partials A
  and B; the client's starting week only expects partial B.
- KPI registry: `src/lib/kpis.ts`.

## Conventions & gotchas
- **Sticky bars** (Save bar, page headers) stick at
  `top-[var(--app-header-h,48px)]`. `ClientPortal` measures the top nav with a
  CALLBACK ref (NOT a `[]` effect — the header mounts after a loading gate, so a
  `[]` effect measures null once and never re-runs) and publishes
  `--app-header-h`. Never hardcode a header offset; the nav wraps to multiple
  rows in coach view.
- **Client newsletter auto-enroll:** the `activate-client` Edge Function adds a
  client to Resend on activation, mirroring the site's `subscribe.js`. Resend
  segments: "general" `09617aa8-a3e6-4599-b8a7-195b385e8c49`, "clients"
  `b1d20c20-4bb5-45a5-a70a-de629b2896bd`. NOTE: it still sends
  `unsubscribed:false`, which can resurrect a previously-unsubscribed contact on
  activation (low risk, not yet fixed).
- Copy: coach-led tone (the coach drives setup, not the client), industry-
  agnostic labels, "we" not "I", spell out "Key Performance Indicator" then KPI.
