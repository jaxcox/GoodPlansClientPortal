// Edge Function: send-coach-message
// Client-to-coach messaging. A client signed into the portal opens the
// "Message Coach" modal, types a message, hits Send. This function:
//
//   - Validates the caller is an authenticated client
//   - Looks up the client's coach via profiles → clients
//   - Sends a branded email to the coach's inbox via Resend
//   - Sets reply-to to the client's email so the coach can reply
//     directly from their normal email client and the response lands
//     in the client's inbox
//
// The message is NOT persisted (email-only V1 — no messages table).
// Coach reads + replies entirely in their email client.
//
// Deploy: Edge Functions → New function → name `send-coach-message`
//   → paste this file → Deploy. Toggle Verify JWT OFF on the function
//   (the function does its own JWT verification via the user-context
//   Supabase client, but the gateway check would otherwise reject calls
//   from authenticated clients whose role is 'client').
//
// Env vars (auto-injected by Supabase except RESEND_API_KEY):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY (already set for the other Resend functions)

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PORTAL_URL = 'https://portal.thegoodplansco.com'
const FROM_ADDRESS = 'The Good Plans Co <noreply@thegoodplansco.com>'
/** Max characters in a single message. Above this we 400 the request so
 *  the client knows to trim — keeps emails sane and rules out accidental
 *  paste-bomb scenarios. */
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
  let body: { message?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const message = String(body.message ?? '').trim()
  if (!message) return jsonError(400, 'Message is required')
  if (message.length > MAX_LEN) {
    return jsonError(400, `Message too long (max ${MAX_LEN} characters)`)
  }

  // 3. Look up caller's profile → confirm client role → find their
  // client row and coach
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role, client_id, coach_id, display_name')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileErr) return jsonError(500, profileErr.message)
  if (!profile || profile.role !== 'client' || !profile.client_id) {
    return jsonError(403, 'Only clients can send coach messages from this endpoint')
  }

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, coach_id, email, contact_name, company_name')
    .eq('id', profile.client_id)
    .maybeSingle()
  if (clientErr) return jsonError(500, clientErr.message)
  if (!client) return jsonError(404, 'Client record not found')

  const { data: coach, error: coachErr } = await admin
    .from('coaches')
    .select('id, brand_name, support_email')
    .eq('id', client.coach_id)
    .maybeSingle()
  if (coachErr) return jsonError(500, coachErr.message)
  if (!coach) return jsonError(404, 'Coach record not found')

  // Resolve where the coach reads their messages. Prefer the explicit
  // support_email field if set; otherwise fall back to the coach's auth
  // login email (which we look up via the admin auth API).
  let coachInboxEmail = coach.support_email
  if (!coachInboxEmail) {
    const { data: coachAuth } = await admin
      .from('profiles')
      .select('id')
      .eq('coach_id', coach.id)
      .eq('role', 'coach')
      .maybeSingle()
    if (coachAuth?.id) {
      const { data: authUser } = await admin.auth.admin.getUserById(coachAuth.id)
      coachInboxEmail = authUser.user?.email ?? null
    }
  }
  if (!coachInboxEmail) {
    return jsonError(500, 'Coach has no email on file')
  }

  // 4. Compose + send via Resend
  const senderLabel = client.contact_name
    ? `${client.contact_name} (${client.company_name})`
    : client.company_name
  const subject = `Message from ${senderLabel}`
  const html = buildClientToCoachHtml({
    senderLabel,
    clientEmail: client.email,
    message,
  })
  const text = buildClientToCoachText({
    senderLabel,
    clientEmail: client.email,
    message,
  })

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      reply_to: client.email,
      to: coachInboxEmail,
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

function buildClientToCoachHtml({
  senderLabel,
  clientEmail,
  message,
}: {
  senderLabel: string
  clientEmail: string | null
  message: string
}): string {
  const safeSender = escapeHtml(senderLabel)
  const safeMsg = escapeHtml(message).replace(/\n/g, '<br>')
  const replyLine = clientEmail
    ? `<p style="font-size: 12px; color: #555; margin: 0 0 24px 0; font-style: italic;">Reply directly to this email and your response will land in ${escapeHtml(clientEmail)}'s inbox.</p>`
    : ''
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="The Good Plans Co" style="height: 80px; width: auto;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      <strong>${safeSender}</strong> sent you a message via the Client Portal:
    </p>

    <div style="background-color: #F5F2E5; border-left: 3px solid #FFF200; padding: 12px 16px; border-radius: 4px; margin: 0 0 24px 0;">
      <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0; white-space: pre-wrap;">${safeMsg}</p>
    </div>

    ${replyLine}

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0;">
      Sincerely,<br>
      The Good Plans Co Portal
    </p>

  </div>
</div>`
}

function buildClientToCoachText({
  senderLabel,
  clientEmail,
  message,
}: {
  senderLabel: string
  clientEmail: string | null
  message: string
}): string {
  return `${senderLabel} sent you a message via the Client Portal:

${message}

${clientEmail ? `Reply directly to this email and your response will land in ${clientEmail}'s inbox.\n` : ''}
Sincerely,
The Good Plans Co Portal
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
