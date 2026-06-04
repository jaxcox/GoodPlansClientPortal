// Edge Function: send-client-message
// Coach-to-client messaging. Coach (in coach-view of a client's portal)
// opens the "Message Client" modal, types a message, hits Send. This
// function:
//
//   - Validates the caller is the coach who owns the target client
//   - Looks up coach.from_email (multi-coach-ready) and profile.display_name
//   - Sends the email FROM the coach's address (so it reads as a personal
//     message, not a system notification) with the coach's name in the
//     display
//   - Signs the email with the coach's display_name + brand_name so future
//     multi-coach setups Just Work
//
// The message is NOT persisted (email-only V1 — no messages table).
//
// Deploy: Edge Functions → New function → name `send-client-message`
//   → paste this file → Deploy. Toggle Verify JWT OFF on the function
//   (this function does its own JWT verification).
//
// Env vars (auto-injected by Supabase except RESEND_API_KEY):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY (already set)

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PORTAL_URL = 'https://portal.thegoodplansco.com'
/** Fallback FROM address when the coach hasn't set coach.from_email
 *  yet. Should be at the verified Resend domain so deliverability
 *  isn't penalized. */
const FALLBACK_FROM = 'noreply@thegoodplansco.com'
const MAX_LEN = 4000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed')
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return jsonError(500, 'Email service not configured')
  }

  // 1. Authenticate the caller
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return jsonError(401, 'Missing Authorization header')
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) {
    return jsonError(401, 'Not signed in')
  }

  // 2. Parse + validate the body
  let body: { clientId?: string; message?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const clientId = String(body.clientId ?? '').trim()
  const message = String(body.message ?? '').trim()
  if (!clientId) return jsonError(400, 'clientId is required')
  if (!message) return jsonError(400, 'Message is required')
  if (message.length > MAX_LEN) {
    return jsonError(400, `Message too long (max ${MAX_LEN} characters)`)
  }

  // 3. Confirm caller is a coach + verify they own the target client
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role, coach_id, display_name')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileErr) return jsonError(500, profileErr.message)
  if (!profile || profile.role !== 'coach' || !profile.coach_id) {
    return jsonError(403, 'Only coaches can send client messages')
  }

  const { data: coach, error: coachErr } = await admin
    .from('coaches')
    .select('id, brand_name, from_email, support_email')
    .eq('id', profile.coach_id)
    .maybeSingle()
  if (coachErr) return jsonError(500, coachErr.message)
  if (!coach) return jsonError(404, 'Coach record not found')

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, coach_id, email, contact_name, company_name')
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) return jsonError(500, clientErr.message)
  if (!client) return jsonError(404, 'Client not found')
  if (client.coach_id !== coach.id) {
    return jsonError(403, 'Not your client')
  }
  if (!client.email) return jsonError(400, 'Client has no email on file')

  // 4. Compose the from address. Format: `Jackie Cox <jackie@thegoodplansco.com>`
  // when both display_name and from_email are set. Falls back gracefully if
  // either's missing (multi-coach onboarding might land here mid-setup).
  const displayName = profile.display_name?.trim() || coach.brand_name
  const fromEmail = coach.from_email?.trim() || FALLBACK_FROM
  const from = `${displayName} <${fromEmail}>`

  // Reply-to: prefer support_email when set, else the from address itself.
  // Either way, replies land somewhere a real human reads.
  const replyTo = coach.support_email?.trim() || fromEmail

  const recipientLabel = client.contact_name || client.company_name
  const subject = `Message from ${displayName}`
  const html = buildCoachToClientHtml({
    recipientLabel,
    message,
    coachDisplayName: displayName,
    brandName: coach.brand_name,
  })
  const text = buildCoachToClientText({
    recipientLabel,
    message,
    coachDisplayName: displayName,
    brandName: coach.brand_name,
  })

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      reply_to: replyTo,
      to: client.email,
      subject,
      html,
      text,
    }),
  })

  if (!sendRes.ok) {
    let detail = ''
    try {
      const errBody = await sendRes.json()
      detail = typeof errBody?.message === 'string' ? errBody.message : ''
    } catch {
      /* response wasn't JSON */
    }
    return jsonError(502, `Email send failed (${sendRes.status})${detail ? ': ' + detail : ''}`)
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})

function buildCoachToClientHtml({
  recipientLabel,
  message,
  coachDisplayName,
  brandName,
}: {
  recipientLabel: string
  message: string
  coachDisplayName: string
  brandName: string
}): string {
  const safeMsg = escapeHtml(message).replace(/\n/g, '<br>')
  const safeRecipient = escapeHtml(recipientLabel)
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="${escapeHtml(brandName)}" width="80" height="80" style="display: block; width: 80px; height: 80px; max-width: 80px;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      Hi ${safeRecipient},
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0; white-space: pre-wrap;">${safeMsg}</p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0;">
      Sincerely,<br>
      ${escapeHtml(coachDisplayName)}<br>
      ${escapeHtml(brandName)}
    </p>

  </div>
</div>`
}

function buildCoachToClientText({
  recipientLabel,
  message,
  coachDisplayName,
  brandName,
}: {
  recipientLabel: string
  message: string
  coachDisplayName: string
  brandName: string
}): string {
  return `Hi ${recipientLabel},

${message}

Sincerely,
${coachDisplayName}
${brandName}
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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
