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
