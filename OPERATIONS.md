# Operations & Tech Stack

Plain-English reference for the Good Plans Co Client Portal. Written for you (a non-coder) to come back to whenever you need a refresher.

The portal is live at **<https://portal.thegoodplansco.com>**.

---

## What you actually own

Several separate services power the portal. Each has its own account and dashboard. They all talk to each other behind the scenes.

| Service | What it does | Dashboard | Cost today |
|---|---|---|---|
| **Vercel** | Runs the website (serves it to anyone who visits the URL) | [vercel.com](https://vercel.com) | Free |
| **Supabase** | The database (clients, entries, budgets), login system, and small server-side helpers | [supabase.com](https://supabase.com) | Free |
| **Resend** | Sends all emails (password resets, invites, reminders, messages) | [resend.com](https://resend.com) | Free |
| **Hover** | Where the domain `thegoodplansco.com` is registered | [hover.com](https://hover.com) | ~$15/year |
| **GitHub** | Where the source code is stored. Vercel pulls from it. | [github.com/jaxcox/GoodPlansClientPortal](https://github.com/jaxcox/GoodPlansClientPortal) | Free |

**Total running cost right now: about $15/year (just the domain).** Stays free up to ~50K monthly users and 3K emails/month.

---

## What each service does, in plain terms

### Vercel — the host
Think of Vercel as the building your website lives in. When someone types `portal.thegoodplansco.com`, Vercel hands them the pages. It also automatically rebuilds the site whenever new code lands.

### Supabase — the back office
Three things in one:
- **Database**: every client, weekly entry, budget number, and message lives here.
- **Authentication**: handles all logins (coach + clients). When you reset a password, Supabase generates the link.
- **Edge Functions**: tiny server-side programs the portal calls for special tasks (activating new clients, sending invite emails, the weekly-reminder cron). You don't interact with them directly; they run when needed.

### Resend — the mail room
Every email your portal sends — password reset, client invite, weekly reminder, Message Coach — goes through Resend. They route it from `noreply@thegoodplansco.com` (or `jackie@thegoodplansco.com` for personal messages) to the recipient.

### Hover — the address book
You bought `thegoodplansco.com` from Hover. They're the official registrar. As long as you renew, the domain is yours. Hover sends a renewal reminder before it lapses.

### GitHub — the filing cabinet
Every line of the portal's code is stored here, including the full history of every change ever made. Vercel watches this and rebuilds when code changes.

---

## Behind the scenes (libraries the code uses)

You don't have accounts for these — they're just tools the code uses. Listed for completeness:

- **React + TypeScript**: the language/framework the app is written in
- **Vite**: turns the code into something a browser can run
- **Tailwind CSS**: how the visual styling works (colors, spacing, layout)
- **Driver.js**: the guided tour library for new clients
- **@react-pdf/renderer**: generates the Download Report PDFs
- **Inter + Playfair Display fonts**: from Google Fonts (also free)

---

## Making updates to the portal

You don't write code. You work with **Claude** (me) inside the Claude Code app. Here's how a typical session looks:

### Starting a session
1. Open **Terminal** (Spotlight: type "terminal")
2. Paste this and hit Enter:
   ```
   cd "/Users/jackieferrier/Documents/portal rebuild"
   ```
3. Type `claude` and hit Enter. Claude Code launches with full context of the project.
4. Describe what you want changed. Examples:
   - "Change the welcome card greeting to say X."
   - "Add a button on the dashboard that..."
   - "Why does the Weekly Entry page show Y when..."
   - "I want a new page that..."

### How a change goes live

When you ask for a change:

1. **I read** the relevant code
2. **I edit** the files
3. **I run a typecheck** to make sure I didn't break anything
4. **We commit** the change (saves it to the project's history)
5. **We push** to GitHub
6. **Vercel automatically rebuilds** (~1 minute)
7. **The live site updates** at `portal.thegoodplansco.com`

Most changes ship in under 5 minutes from when you describe them.

### Common things I can help with
- New features (pages, forms, calculations)
- Bug fixes
- Copy / wording changes
- Visual tweaks (colors, spacing, layouts)
- Email template edits
- Email content changes
- New KPIs or fields
- Whatever you can describe

### Common things you do directly (no Claude needed)
- Adding new clients → Coach Admin → + Add Client
- Resending invite codes → Send Invite button on the client card
- Setting client budgets → Budget & Goals page
- Resetting a client's password → Reset Password on the client card
- Sending a message to a client → Coach view of their portal → Message Client
- Changing your own password → Coach Account page

---

## Service limits (what to keep an eye on)

You're nowhere near these limits today, but worth knowing:

### Vercel (Hobby plan, free)
- **100 GB bandwidth/month** — the portal would need thousands of clients to hit this
- **100 deploys/day** — we typically do 1–10 deploys per session, no issue

### Supabase (Free plan)
- **500 MB database** — current usage is well under 1 MB
- **50,000 monthly active users** — not even close
- **Pauses after 7 days of inactivity** — **important**: see "Monthly Maintenance" below

### Resend (Free plan)
- **3,000 emails per month** total
- **100 emails per day**
- At current scale you'll use ~10–50 emails/month

### Hover (Domain)
- **$15ish/year** renewal — auto-renew is probably enabled but verify

---

## Monthly maintenance

Do these once a month, takes 2 minutes total:

1. **Log into Supabase** ([supabase.com](https://supabase.com) → your project). This resets their 7-day inactivity timer. If a project pauses, the portal goes down until you log back in. Just visiting the dashboard is enough.

2. **Glance at Vercel deploys** ([vercel.com](https://vercel.com) → your project → Deployments). Top entry should say "Ready". If you see a failed deploy at the top, something broke — open Claude Code and ask.

3. **Glance at Resend** ([resend.com](https://resend.com) → Emails). Quick scan for any "Bounced" or "Complained" rows that suggest delivery problems.

## Annual maintenance

1. **Domain renewal at Hover** — verify auto-renew is on. Lapsing the domain means the portal goes dark.
2. **Review free-tier limits** — if your client list ever grows past ~20–30 actively-using clients, take a look at whether you're approaching any limit.

---

## What to do if something breaks

### "The portal won't load"
1. Check Vercel deploys. If the most recent deploy is "Ready" but the site still doesn't load, it's likely a Supabase issue (paused project, etc.).
2. Try the raw `*.vercel.app` URL (Vercel project → Settings → Domains has it). If that loads but `portal.thegoodplansco.com` doesn't, it's a DNS issue.
3. Open Claude Code and ask. I can check the logs.

### "A client can't sign in"
1. Coach Admin → find them in the Clients list. Are they Active or Pending?
   - **Pending**: they haven't activated yet. Click Send Invite to re-send the code.
   - **Active**: their account is good. Try Reset Password to give them a fresh temporary one.
2. Check the email address on their card matches what they're typing.

### "Emails aren't arriving"
1. Check spam folders (delivery from `noreply@thegoodplansco.com` should be reliable but new senders sometimes land in spam).
2. Resend dashboard → Emails — look for the specific send. If it shows "Delivered" but they never got it, it's in their spam. If it shows "Bounced", their email address is bad.

### "Something looks wrong on the page"
- Open Claude Code, describe what you're seeing, where, and what you expected instead. I'll look at the code and fix.

---

## Important URLs (bookmark these)

| Thing | URL |
|---|---|
| Live portal | <https://portal.thegoodplansco.com> |
| Coach login | <https://portal.thegoodplansco.com/coach> |
| Client login | <https://portal.thegoodplansco.com/client> |
| Source code (GitHub) | <https://github.com/jaxcox/GoodPlansClientPortal> |
| Vercel project | <https://vercel.com> |
| Supabase project | <https://supabase.com> |
| Resend dashboard | <https://resend.com> |
| Hover (domain) | <https://hover.com> |

---

## Files in this project worth knowing about

You don't need to open these, but in case you ever do:

- **`/public/logo.png`** — your brand logo. Used on Coach Admin, login screens, email headers. Replace this file to swap the logo everywhere.
- **`/public/favicon-32.png`** — the browser-tab icon. Auto-generated from logo.png.
- **`/.env.local`** — your Supabase keys for local development. Never share, never commits to GitHub (it's in `.gitignore`).
- **`/README.md`** — first-time setup instructions if you ever spin up a fresh copy of the portal.
- **`/OPERATIONS.md`** — this file.
- **`/supabase/migrations/`** — all the database changes ever made, in order.

---

## Backups and "what if I lose everything"

### Code
Backed up on GitHub. Even if your laptop dies, the code is recoverable from there in 1 minute.

### Database (Supabase) — the gap that matters
**Supabase free tier doesn't include automatic backups.** The data is replicated within Supabase's own infrastructure so total platform loss is very rare, but you have **no protection against accidental deletion** (a mistaken SQL command, a bad migration, a hacked credential).

**Realistic risk today**: you have one real client + a few demos. A wipe would be annoying but recoverable (recreate demos in 30 min; real client re-enters recent weeks from notes/memory).

**Realistic risk at 5–10 real clients**: losing months of weekly entries from multiple businesses is a genuine business problem. Hard to explain.

#### Free mitigations (no upgrade)
1. **Manual monthly dump (already set up)** (5 min). The query lives at [`supabase/backups/full-backup.sql`](supabase/backups/full-backup.sql) and step-by-step instructions are in [`supabase/backups/README.md`](supabase/backups/README.md). Paste the query into Supabase SQL Editor, click Run, click Download CSV, save the file somewhere safe. Once a month.
2. **Automated weekly dump via Edge Function** (~1 hr setup). Runs on a cron, exports the database to JSON, emails it to you via Resend. Rolling archive in your inbox. Ask me to build this when you want it.
3. **Supabase CLI local dump** (~30 min setup, run monthly). Run `supabase db dump` from your laptop → saves a SQL file → back it up like any document.

#### Paid option
**Supabase Pro at $25/month** adds daily automatic backups, 30 days of restorable history, and point-in-time recovery. Recommended when:
- You have 5+ paying clients on the portal, OR
- You're charging clients money and they expect their data to be safe, OR
- You ever do a database migration that scares you (the safety net is worth $25 that month alone)

**My recommendation today**: stay on free, set up the manual monthly dump when convenient. Upgrade to Pro when you have real client trust on the line.

### Email history
Resend keeps a log of sent emails for 30 days. Useful for debugging "did the email actually go out?" — but not a backup of message content beyond the 30-day window.

### DNS records
Stored at Hover; visible on their dashboard. If anything ever goes weird with DNS, you can see/edit the records there.

---

## When you add a marketing site at the apex domain

When the marketing site at `thegoodplansco.com` (the apex, no `portal.` prefix) is ready:

### What changes
- The **portal** stays exactly where it is at `portal.thegoodplansco.com` — no changes to it, no risk to existing data.
- A **new Vercel project** gets created for the marketing site code (separate repo, separate deploys).
- New DNS records at Hover point the apex (`thegoodplansco.com`) and `www.thegoodplansco.com` at the new Vercel project.

### The setup workflow
1. The marketing site code goes into its own GitHub repo (whoever builds the site sets this up).
2. In Vercel: **Add New Project** → import that repo (same flow as the portal).
3. In the new Vercel project: **Settings → Domains** → add `thegoodplansco.com` and `www.thegoodplansco.com`.
4. Vercel shows the **exact DNS records** to add (usually an A record or "ALIAS" for the apex, plus a CNAME for `www`).
5. At Hover, add those records to the DNS page (same place where you added `portal`).
6. Wait ~10 minutes for DNS to propagate. Vercel auto-issues SSL.

### Important: don't touch the existing portal CNAME
The DNS record you added for `portal` (CNAME → Vercel) stays. Apex and subdomain records are independent. After adding the marketing site, the Hover DNS page should have:
- A record (or ALIAS) for the apex `@`
- CNAME for `www`
- CNAME for `portal` (unchanged from today)

### If you're building the marketing site in a no-code tool
If the marketing site ends up being built in **Webflow / Squarespace / Carrd / etc.**, those platforms host the site themselves. In that case skip the Vercel steps above and follow their DNS instructions instead — point `thegoodplansco.com` at their servers. The portal subdomain stays untouched on Vercel either way.

### What this would cost
- Vercel: still free (their Hobby plan handles two projects fine)
- DNS: still free (Hover doesn't charge for DNS records)
- No new accounts needed if you use Vercel for both

---

*Last updated: 2026-05-28. If big architectural changes happen, ask me to refresh this doc.*
