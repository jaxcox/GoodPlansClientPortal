# Manual database backups

Plain-English instructions for running a monthly snapshot of the portal's database. Takes 2 minutes.

## When to run this

Once a month is plenty for now. Pick a day — first of the month, last day of the month, the 15th, whatever's easy to remember. Run it then.

If you're about to do something risky (a big database change, a migration that scares you), run it right before too.

## How to run it

### Step 1 — Open Supabase
1. Go to <https://supabase.com> and sign in
2. Click your project
3. In the left sidebar, click **SQL Editor**
4. Click **+ New query**

### Step 2 — Paste the backup query
Open the file `full-backup.sql` in this same folder. Copy everything in it. Paste into the Supabase SQL Editor.

(Or even faster: in Terminal from the project folder, run `cat supabase/backups/full-backup.sql | pbcopy` — that copies the file to your clipboard. Then Cmd+V in the SQL Editor.)

### Step 3 — Run it
Click the green **Run** button (or hit Cmd+Enter).

You'll see one row with one giant cell of text. That's expected — the entire database is packed into that single JSON value.

### Step 4 — Download
Look for a **"Download CSV"** or **download arrow** button on the result toolbar. Click it.

You'll get a file named something like `result.csv`. Rename it to `portal-backup-2026-05-28.csv` (with today's date) so future-you can tell snapshots apart.

### Step 5 — Save somewhere safe
Drag the file into Dropbox, iCloud, Google Drive, a USB stick — anywhere you trust. **The Downloads folder doesn't count.** A laptop crash and you lose the backup.

That's it.

---

## How to know your backup is good

Open the CSV file in any text editor (TextEdit, BBEdit, VS Code). You should see a big block of JSON with recognizable bits — client company names, dates, KPI values. If the file says `null` everywhere or is empty, something went wrong. Run it again.

---

## What if you need to restore?

The CSV file isn't directly importable — it's a snapshot for safekeeping, not a one-click restore. **If you ever need to recover data**, open a Claude Code session in the portal project, share the backup file, and ask me to write a restore script. I'll parse the JSON and re-insert the data into the database.

Hopefully you never need it. The point is having it.

---

## Keeping a rolling archive

Some tips for storing backups well:

- **Keep the last 6** at minimum. Older ones can be deleted to save space.
- **Don't overwrite** — each one is a snapshot of a different point in time. The filename's date is what makes them useful.
- **Test occasionally**: once a year, ask Claude to write a "verify this backup" script that confirms the file is parseable and complete.

---

## When to graduate to the paid plan

Manual monthly backups are a stopgap. They're better than nothing but have real gaps:
- If something goes wrong between backups, you lose up to a month of data
- Restoring requires human work (Claude writing the recovery script)
- It's on you to remember every month

The **Supabase Pro plan at $25/month** adds automatic daily backups, 30 days of restorable history, and one-click restore. Move to that plan when:
- You have 5+ paying clients on the portal, OR
- The loss of a week's worth of data would actually hurt your business / relationships, OR
- You realize you keep forgetting to run the monthly backup
