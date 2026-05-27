// Edge Function: send-weekly-reminders
// Called on a Tuesday + Thursday schedule (Supabase Scheduled Edge Functions
// or pg_cron). For each activated, non-archived client with
// weekly_reminder_enabled=true who hasn't yet saved a weekly_entries row for
// the most-recently-completed Sunday, sends a short branded reminder via
// Resend.
//
// Auth: requires `Authorization: Bearer <CRON_SECRET>` header. The
// scheduled-job config passes this; anyone else hitting the function from the
// open internet without the secret gets 401. (Function can't use the standard
// user-JWT pattern because cron has no user context.)
//
// Deploy:
//   - Dashboard: Edge Functions → New function → name `send-weekly-reminders`
//     → paste this file → Deploy.
//   - Mark JWT verification OFF on the function (Settings → Verify JWT) since
//     we authenticate via CRON_SECRET instead.
//   - Schedule: Database → Cron (or Scheduled Functions) → new job:
//       Schedule: `0 13 * * 2,4`  (13:00 UTC Tue + Thu — ~9am EDT)
//       Method: POST
//       URL: https://<project>.supabase.co/functions/v1/send-weekly-reminders
//       Headers: Authorization: Bearer <CRON_SECRET value>
//
// Env vars (Supabase auto-injects all but CRON_SECRET + RESEND_API_KEY):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY  (same as send-client-invite — already set)
//   CRON_SECRET     ← set via Project Settings → Edge Functions → Secrets

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PORTAL_URL = 'https://portal.thegoodplansco.com'
const FROM_ADDRESS = 'The Good Plans Co <noreply@thegoodplansco.com>'
const REPLY_TO = 'noreply@thegoodplansco.com'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed')
  }

  // 1. Verify the caller has the CRON_SECRET. Cron jobs pass it in
  // the Authorization header; anyone else hitting this endpoint without
  // it gets bounced. Both sides are .trim()'d to tolerate stray
  // whitespace (a trailing newline on the saved secret is a common
  // paste-into-dashboard artifact that otherwise breaks the compare).
  const cronSecret = Deno.env.get('CRON_SECRET')
  if (!cronSecret) {
    return jsonError(500, 'CRON_SECRET not configured')
  }
  const auth = (req.headers.get('Authorization') ?? '').trim()
  const expected = `Bearer ${cronSecret.trim()}`
  if (auth !== expected) {
    // Logs let us diagnose mismatches without exposing the full secret.
    console.warn('CRON_SECRET mismatch', {
      authLength: auth.length,
      expectedLength: expected.length,
      authPrefix: auth.slice(0, 14),
      expectedPrefix: expected.slice(0, 14),
      authSuffix: auth.slice(-6),
      expectedSuffix: expected.slice(-6),
    })
    return jsonError(401, 'Unauthorized')
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return jsonError(500, 'RESEND_API_KEY not configured')
  }

  // 2. Compute the Sunday of the most-recently-completed week. That's
  // the week we expect entries for; if a client hasn't saved one, they
  // get a reminder. Mirrors mostRecentCompletedWeekStart() in lib/week.ts.
  const now = new Date()
  const dow = now.getUTCDay() // 0 = Sunday
  const thisWeekSunday = new Date(now)
  thisWeekSunday.setUTCHours(0, 0, 0, 0)
  thisWeekSunday.setUTCDate(thisWeekSunday.getUTCDate() - dow)
  const lastWeekSunday = new Date(thisWeekSunday)
  lastWeekSunday.setUTCDate(lastWeekSunday.getUTCDate() - 7)
  const lastWeekIso = isoDate(lastWeekSunday)
  const lastWeekSaturday = new Date(lastWeekSunday)
  lastWeekSaturday.setUTCDate(lastWeekSaturday.getUTCDate() + 6)
  const weekLabel = `${formatMd(lastWeekSunday)}–${formatMd(lastWeekSaturday)}`

  // 3. Pull all eligible clients (activated, not archived, opted in)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: clients, error: clientsErr } = await admin
    .from('clients')
    .select('id, email, contact_name, company_name')
    .eq('activated', true)
    .eq('archived', false)
    .eq('weekly_reminder_enabled', true)
  if (clientsErr) return jsonError(500, clientsErr.message)
  if (!clients || clients.length === 0) {
    return jsonOk({ checked: 0, sent: 0, skipped: 0, failed: 0 })
  }

  // 4. Find which of those already have a row for lastWeekSunday. One
  // query for the whole batch — cheaper than per-client checks.
  const clientIds = clients.map((c) => c.id)
  const { data: existing, error: existingErr } = await admin
    .from('weekly_entries')
    .select('client_id')
    .eq('week_start_date', lastWeekIso)
    .in('client_id', clientIds)
  if (existingErr) return jsonError(500, existingErr.message)
  const haveEntered = new Set((existing ?? []).map((r) => r.client_id))

  // 5. Send to clients who DON'T have an entry yet
  let sent = 0
  let skipped = 0
  let failed = 0
  const failures: Array<{ clientId: string; error: string }> = []

  for (const client of clients) {
    if (haveEntered.has(client.id)) {
      skipped++
      continue
    }
    if (!client.email) {
      skipped++
      continue
    }

    const html = buildReminderHtml({
      contactName: client.contact_name ?? null,
      weekLabel,
    })
    const text = buildReminderText({
      contactName: client.contact_name ?? null,
      weekLabel,
    })

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        reply_to: REPLY_TO,
        to: client.email,
        subject: 'Your weekly entry is open',
        html,
        text,
        // List-Unsubscribe header improves spam-filter scoring. Client
        // has portal access, so first target is the in-portal Settings
        // page where the reminder toggle lives; mailto: fallback lets
        // recipients opt out by email too. Per CAN-SPAM, transactional
        // emails don't strictly require unsubscribe — this is purely
        // for deliverability.
        headers: {
          'List-Unsubscribe':
            '<https://portal.thegoodplansco.com/>, <mailto:jackie@thegoodplansco.com?subject=Unsubscribe>',
        },
      }),
    })

    if (sendRes.ok) {
      sent++
    } else {
      failed++
      let detail = ''
      try {
        const errBody = await sendRes.json()
        detail =
          typeof errBody?.message === 'string' ? errBody.message : ''
      } catch {
        /* response wasn't JSON */
      }
      failures.push({
        clientId: client.id,
        error: `${sendRes.status}${detail ? ': ' + detail : ''}`,
      })
    }
  }

  return jsonOk({
    week: lastWeekIso,
    checked: clients.length,
    sent,
    skipped,
    failed,
    failures,
  })
})

// =============================================================================
// Email template — short reminder, same chrome as the Reset Password and
// Invite emails. Logo, yellow CTA, signed by the team.
// =============================================================================

function buildReminderHtml({
  contactName,
  weekLabel,
}: {
  contactName: string | null
  weekLabel: string
}): string {
  const greeting = contactName ? `Hi ${escapeHtml(contactName)},` : 'Hi there,'
  const safeLabel = escapeHtml(weekLabel)
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="The Good Plans Co" style="height: 80px; width: auto;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      ${greeting}
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      Your weekly entry for <strong>${safeLabel}</strong> is still open. Take a couple minutes to fill it in so your dashboard stays current.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${PORTAL_URL}/client" style="display: inline-block; background-color: #FFF200; color: #0f0f0f; font-weight: bold; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Open Client Portal</a>
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0;">
      Sincerely,<br>
      The Good Plans Co team
    </p>

  </div>
</div>`
}

function buildReminderText({
  contactName,
  weekLabel,
}: {
  contactName: string | null
  weekLabel: string
}): string {
  const greeting = contactName ? `Hi ${contactName},` : 'Hi there,'
  return `${greeting}

Your weekly entry for ${weekLabel} is still open. Take a couple minutes to fill it in so your dashboard stays current.

Open the portal: ${PORTAL_URL}/client

Sincerely,
The Good Plans Co team
`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function formatMd(d: Date): string {
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
