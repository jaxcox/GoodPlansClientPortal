# The Good Plans Co — Client Performance Portal

Coach-and-client weekly performance portal. Rebuild of the original single-file prototype on a real backend, designed multi-tenant from day one so other coaches can be onboarded later without a re-architecture.

## Stack

- **Frontend** — Vite + React + TypeScript + Tailwind CSS v4
- **Backend / database / auth** — Supabase (PostgreSQL + auth + email)
- **Hosting** — Vercel (added in a later phase)

## Phase 1 scope

- Real coach login (hashed passwords via Supabase Auth)
- Multi-tenant database schema with row-level security from day one
- Coach Admin shell (top bar, sub-nav, empty clients list, Logout)
- Brand fields (`brand_name`, etc.) live on the coach record and render in the UI from data — no hardcoded brand strings in the codebase

## First-time setup

You'll need to do all of this once. Maybe 10 minutes total.

### 1. Create a Supabase project

1. Go to <https://supabase.com> and sign up (free).
2. Click **New project**.
3. Name it whatever you like (e.g. `goodplans-portal`). Pick a strong database password — you won't usually need it again, but save it somewhere.
4. Region: closest to you.
5. Click **Create new project**. It takes ~1–2 minutes to provision.

### 2. Copy your project credentials

In the Supabase dashboard:

1. Click the gear icon (Settings) → **API**.
2. Copy the **Project URL** (looks like `https://abcd1234.supabase.co`).
3. Copy the **anon / public** key (a long string starting with `eyJ…`).

In this project folder, create a file called `.env.local` (copy `.env.example` and fill in the values):

```
VITE_SUPABASE_URL=https://abcd1234.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

### 3. Run the schema

In the Supabase dashboard:

1. Click **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase/schema.sql` in this project, copy its entire contents, paste into the editor.
3. Click **Run**. Should say "Success. No rows returned."

This creates the `coaches`, `clients`, `industries`, and `profiles` tables, the row-level-security policies, and a helper function called `bootstrap_coach`.

### 4. Create your auth user

In the Supabase dashboard:

1. Click **Authentication** (left sidebar) → **Users**.
2. Click **Add user** → **Create new user**.
3. Enter your email (`jackie@thegoodplansco.com`) and a password. Tick **Auto Confirm User**.
4. Click **Create user**.

### 5. Bootstrap your coach record

Back in **SQL Editor** → **New query**:

```sql
select bootstrap_coach('jackie@thegoodplansco.com', 'The Good Plans Co');
```

(Use the same email you just created the auth user with.)

This creates a `coaches` record with your brand name and a `profiles` row linking your auth user to it as a coach. You can change the brand name later by updating the row in the **Table Editor**.

### 6. Run the app locally

```sh
npm install
npm run dev
```

Open <http://localhost:5173> and sign in with the email + password from step 4. You should land on the Coach Admin shell with "The Good Plans Co" in the top bar and an empty clients list.

## Edge Functions

The portal uses Supabase Edge Functions for server-only operations (creating client auth users on activation, sending invite emails). They live under `supabase/functions/`. You deploy them once per function, then they run on Supabase's infrastructure.

### Deploy via CLI (recommended — one setup, easy redeploys)

One-time setup:

```sh
npx supabase login          # opens browser to authenticate
npx supabase link --project-ref wpgaxytyqaoxedirzvmq
```

Deploy (or redeploy) the activation function:

```sh
npm run functions:deploy:activate
```

Or deploy all functions in `supabase/functions/`:

```sh
npm run functions:deploy
```

### Deploy via Dashboard (no CLI)

1. Supabase Dashboard → **Edge Functions** (left sidebar) → **Deploy a function** → **Via the dashboard**.
2. **Function name:** `activate-client` (must match exactly).
3. Copy the contents of `supabase/functions/activate-client/index.ts` into the editor.
4. Click **Deploy function**.

Repeat for any other function under `supabase/functions/`.

## Deploy (Vercel)

The portal is a Vite SPA — Vercel auto-detects the build settings (`npm run build` → `dist/`). The bundled `vercel.json` adds a SPA catch-all rewrite so `/coach`, `/client`, and any future client-side routes serve `index.html` instead of 404ing.

### One-time setup

1. Push the repo to GitHub (already at <https://github.com/jaxcox/GoodPlansClientPortal>).
2. Sign up at <https://vercel.com>, click **Add New… → Project**, import the GitHub repo.
3. **Environment variables** — add both, scoped to "Production" + "Preview" + "Development":
   - `VITE_SUPABASE_URL` (same value as your `.env.local`)
   - `VITE_SUPABASE_ANON_KEY` (same value as your `.env.local`)
4. **Deploy.** First deploy lands on a `*.vercel.app` URL. Verify the app loads, you can sign in, and the dashboard renders.

### Custom domain

1. In Vercel → Project Settings → **Domains** → add `portal.thegoodplansco.com`.
2. Vercel shows the CNAME target — add a CNAME record at your DNS provider (wherever `thegoodplansco.com` is registered) pointing `portal` → that target.
3. Vercel issues an SSL cert automatically once DNS propagates.

### Supabase configuration for production

Once the production URL is live, update Supabase Auth → **URL Configuration**:

- **Site URL** = `https://portal.thegoodplansco.com`
- **Redirect URLs** = `https://portal.thegoodplansco.com/**`

Without these, password-reset emails will either reject or send users to the wrong URL.

### Optional: auto-apply migrations / Edge Functions

Supabase Dashboard → **Settings → Integrations → GitHub** → connect the repo. New SQL files under `supabase/migrations/` and new Edge Functions under `supabase/functions/` will auto-deploy on push to `main`. Trade-off: less safety beat — a broken migration in `main` runs on the connected DB without manual approval. Fine at solo-coach scale; consider PR-based workflow with preview branches if collaborators come on board.

## Project structure

```
.
├── docs/                     # Design docs (the 8 HTML view-maps + reference JSX)
├── supabase/
│   └── schema.sql            # Database schema + RLS policies + bootstrap function
├── src/
│   ├── lib/
│   │   ├── supabase.ts       # Supabase client
│   │   ├── auth.tsx          # Auth context + useAuth hook
│   │   └── types.ts          # TypeScript types matching the SQL schema
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   └── CoachAdmin.tsx
│   ├── App.tsx               # Top-level router (auth-aware)
│   ├── main.tsx
│   └── index.css             # Tailwind + brand colors
├── .env.example              # Copy to .env.local with real values
├── README.md                 # This file
└── package.json
```

## Phase plan

1. ✅ **Skeleton** (this phase) — login + admin shell + multi-tenant schema
2. **Client lifecycle** — invite codes, activation, archive
3. **Settings + Custom Industries**
4. **Budget & Goals**
5. **Weekly Entry + Weekly Dashboard**
6. **Cumulative Dashboard modes** (MTD/QTD/YTD)
7. **History**
8. **Polish** — password reset, coach notes, drag reorder, top bar rebalance, save/cancel patterns
9. **Onboarding** — real-client seed + deployment to Vercel
