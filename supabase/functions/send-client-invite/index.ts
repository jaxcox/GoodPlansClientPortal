// Edge Function: send-client-invite
// Sends a branded invite email to a client via the Resend REST API. Called
// from ClientFormModal right after a coach creates a new client (auto-send),
// and from a "Resend Invite" button on the pending-tab client card (for when
// the original email was lost / went to spam).
//
// Authentication: caller's JWT must belong to a coach profile, and the
// coach_id on the requested client row must match the caller's coach_id.
// Service-role admin client used for DB reads (RLS would otherwise need a
// coach context).
//
// Deploy:
//   - CLI: `npx supabase functions deploy send-client-invite`
//   - Dashboard: Edge Functions → New function → paste this file → Deploy.
//
// Env vars (Supabase auto-injects all but RESEND_API_KEY):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   RESEND_API_KEY  ← set via `npx supabase secrets set RESEND_API_KEY=re_...`
//                     (or Project Settings → Edge Functions → Secrets in the
//                     Supabase dashboard)

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const PORTAL_URL = 'https://portal.thegoodplansco.com'
const FROM_ADDRESS = 'The Good Plans Co <noreply@thegoodplansco.com>'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed')
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) {
    return jsonError(
      500,
      'Email service not configured. Ask the system admin to set RESEND_API_KEY.'
    )
  }

  // 1. Validate caller is an authenticated coach
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

  // 2. Parse body
  let body: { clientId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const clientId = String(body.clientId ?? '').trim()
  if (!clientId) {
    return jsonError(400, 'clientId is required')
  }

  // 3. Service-role read to look up the client + verify ownership
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('coach_id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileErr) return jsonError(500, profileErr.message)
  if (!profile || profile.role !== 'coach' || !profile.coach_id) {
    return jsonError(403, 'Only coaches can send client invites')
  }

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select(
      'id, coach_id, email, contact_name, company_name, invite_code, invite_code_expires_at, activated'
    )
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) return jsonError(500, clientErr.message)
  if (!client) return jsonError(404, 'Client not found')
  if (client.coach_id !== profile.coach_id) {
    return jsonError(403, 'Not your client')
  }
  if (client.activated) {
    return jsonError(400, 'Client is already activated')
  }
  if (!client.invite_code) {
    return jsonError(400, 'No active invite code for this client')
  }
  if (
    client.invite_code_expires_at &&
    new Date(client.invite_code_expires_at) < new Date()
  ) {
    return jsonError(
      400,
      'Invite code has expired. Regenerate from the client card first.'
    )
  }
  if (!client.email) {
    return jsonError(400, 'Client has no email on file')
  }

  // 4. Build + send the email via Resend's REST API
  const html = buildInviteHtml({
    contactName: client.contact_name ?? null,
    inviteCode: client.invite_code,
  })

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: client.email,
      subject: 'Welcome to The Good Plans Co Client Portal',
      html,
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
    return jsonError(
      502,
      `Email send failed (${sendRes.status})${detail ? ': ' + detail : ''}`
    )
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})

// =============================================================================
// Email template — same chrome as the Reset Password template (beige outer,
// white card, logo top, yellow CTA, signed by the team) so the brand reads
// consistently across the two auth-adjacent emails the portal sends.
// =============================================================================

function buildInviteHtml({
  contactName,
  inviteCode,
}: {
  contactName: string | null
  inviteCode: string
}): string {
  const greeting = contactName ? `Hi ${escapeHtml(contactName)},` : 'Hi there,'
  const safeCode = escapeHtml(inviteCode)
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="The Good Plans Co" style="height: 80px; width: auto;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      ${greeting}
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      Your Client Portal is ready. Click the button below to get started, then choose <strong>First Time? Use Invite Code</strong> on the sign-in page and enter the code below.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${PORTAL_URL}/client" style="display: inline-block; background-color: #FFF200; color: #0f0f0f; font-weight: bold; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Go to Client Portal</a>
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 12px 0;">
      Your invite code:
    </p>

    <p style="font-family: 'Courier New', monospace; font-size: 22px; font-weight: bold; color: #0f0f0f; background-color: #F5F2E5; padding: 12px 16px; border-radius: 6px; text-align: center; letter-spacing: 4px; margin: 0 0 24px 0;">
      ${safeCode}
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      Choose a password during sign-up. You'll use that password on future visits.
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0;">
      Sincerely,<br>
      The Good Plans Co team
    </p>

  </div>
</div>`
}

/** Minimal HTML escape for the values interpolated into the template
 *  (contact name + invite code). The other strings are static. */
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
