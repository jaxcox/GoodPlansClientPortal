// Edge Function: update-login-email
// Changes the login email (auth.users.email) for a coach or client.
//
// Authorization model:
//   - Coach target, caller IS target: allowed (self-edit, any coach)
//   - Coach target, caller IS NOT target: requires caller is admin AND
//     target is in caller's brand
//   - Client target: requires caller is admin AND target client is in
//     caller's brand
//
// Client-specific behavior:
//   - If the client has an auth_user_id (activated): updates
//     auth.users.email. Optionally also updates clients.email (when
//     syncContactEmail is true — default in the UI).
//   - If the client has no auth_user_id (pending): just updates
//     clients.email. The invite gets re-sent to the new address next
//     time Send Invite is clicked.
//
// Coach-specific behavior:
//   - Always updates auth.users.email. Coaches' from_email and
//     support_email (which auto-default to the login email per the
//     role-overhaul spec) are NOT auto-synced here — admin can update
//     those separately via the Edit Coach modal if needed.
//
// Notification:
//   - Sends an email via Resend to the NEW address letting the
//     recipient know their login email was updated. Best-effort —
//     the operation still succeeds if the email fails to send.
//
// Deploy: Edge Functions → New function → name `update-login-email`
// → paste → Deploy. Toggle Verify JWT OFF.

import { createClient } from 'npm:@supabase/supabase-js@2'

const PORTAL_URL = 'https://portal.thegoodplansco.com'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: cors })
  }
  if (req.method !== 'POST') {
    return jsonError(405, 'Method not allowed')
  }

  // Auth the caller
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

  // Parse body
  let body: {
    targetType?: 'coach' | 'client'
    targetId?: string
    newEmail?: string
    syncContactEmail?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }

  const targetType = body.targetType
  const targetId = String(body.targetId ?? '').trim()
  const newEmail = String(body.newEmail ?? '').trim().toLowerCase()
  const syncContactEmail = body.syncContactEmail !== false // default true

  if (targetType !== 'coach' && targetType !== 'client') {
    return jsonError(400, "targetType must be 'coach' or 'client'")
  }
  if (!targetId) return jsonError(400, 'targetId is required')
  if (!newEmail) return jsonError(400, 'newEmail is required')
  if (!isValidEmail(newEmail)) {
    return jsonError(400, 'newEmail format is invalid')
  }

  // Service-role admin client
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Resolve caller
  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, coach_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerProfileErr) return jsonError(500, callerProfileErr.message)
  if (
    !callerProfile ||
    callerProfile.role !== 'coach' ||
    !callerProfile.coach_id
  ) {
    return jsonError(403, 'Only coaches can change login emails')
  }

  const { data: callerCoach, error: callerCoachErr } = await admin
    .from('coaches')
    .select('id, is_admin')
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')

  // Branch by target type
  let targetAuthUserId: string | null = null
  let displayName = 'there'
  let brandName = 'The Good Plans Co'

  if (targetType === 'coach') {
    // Look up target coach
    const { data: targetCoach, error: targetCoachErr } = await admin
      .from('coaches')
      .select('id, brand_name')
      .eq('id', targetId)
      .maybeSingle()
    if (targetCoachErr) return jsonError(500, targetCoachErr.message)
    if (!targetCoach) return jsonError(404, 'Coach not found')
    brandName = targetCoach.brand_name ?? brandName

    const isSelf = callerCoach.id === targetCoach.id
    if (!isSelf) {
      // Admin editing another coach — must be admin + same brand
      if (!callerCoach.is_admin) {
        return jsonError(
          403,
          'Only admins can change another coach’s login email'
        )
      }
      const callerBrandOwner = await resolveBrandOwner(admin, callerCoach.id)
      const targetBrandOwner = await resolveBrandOwner(admin, targetCoach.id)
      if (
        !callerBrandOwner ||
        !targetBrandOwner ||
        callerBrandOwner !== targetBrandOwner
      ) {
        return jsonError(403, 'That coach is not in your brand')
      }
    }

    // Resolve auth user id via profiles table
    const { data: targetProfile, error: targetProfileErr } = await admin
      .from('profiles')
      .select('id, display_name')
      .eq('coach_id', targetCoach.id)
      .eq('role', 'coach')
      .maybeSingle()
    if (targetProfileErr) return jsonError(500, targetProfileErr.message)
    if (!targetProfile) {
      return jsonError(404, 'Coach profile not found')
    }
    targetAuthUserId = targetProfile.id
    displayName = targetProfile.display_name ?? displayName
  } else {
    // targetType === 'client' — admin-only
    if (!callerCoach.is_admin) {
      return jsonError(403, 'Only admins can change a client login email')
    }

    const { data: targetClient, error: targetClientErr } = await admin
      .from('clients')
      .select('id, coach_id, auth_user_id, company_name, email')
      .eq('id', targetId)
      .maybeSingle()
    if (targetClientErr) return jsonError(500, targetClientErr.message)
    if (!targetClient) return jsonError(404, 'Client not found')

    // Same-brand check via the client's coach
    const callerBrandOwner = await resolveBrandOwner(admin, callerCoach.id)
    const targetBrandOwner = await resolveBrandOwner(admin, targetClient.coach_id)
    if (
      !callerBrandOwner ||
      !targetBrandOwner ||
      callerBrandOwner !== targetBrandOwner
    ) {
      return jsonError(403, 'That client is not in your brand')
    }

    displayName = targetClient.company_name ?? displayName
    targetAuthUserId = targetClient.auth_user_id

    // Pending client (no auth user yet): just update clients.email and exit
    if (!targetAuthUserId) {
      const { error: pendingUpdateErr } = await admin
        .from('clients')
        .update({ email: newEmail })
        .eq('id', targetClient.id)
      if (pendingUpdateErr) {
        return jsonError(500, pendingUpdateErr.message)
      }
      return new Response(
        JSON.stringify({
          ok: true,
          updated: 'contact_only',
          email_sent: false,
        }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }
  }

  // At this point we have a real auth user to update.
  if (!targetAuthUserId) {
    return jsonError(500, 'Target has no auth user record')
  }

  // Update auth user email
  const { error: authUpdateErr } = await admin.auth.admin.updateUserById(
    targetAuthUserId,
    { email: newEmail, email_confirm: true }
  )
  if (authUpdateErr) {
    const msg = authUpdateErr.message.toLowerCase()
    if (msg.includes('already') || msg.includes('exists') || msg.includes('duplicate')) {
      return jsonError(
        400,
        'That email is already in use by another account.'
      )
    }
    return jsonError(500, authUpdateErr.message)
  }

  // For coach targets: optionally also update profiles entry. Profiles
  // doesn't store email (only display_name + coach_id), so nothing to
  // do there. For coaches the from_email/support_email on the coaches
  // table stay as they were (admin can update separately via Edit Coach).

  // For client targets with syncContactEmail: update clients.email too
  if (targetType === 'client' && syncContactEmail) {
    const { error: clientUpdateErr } = await admin
      .from('clients')
      .update({ email: newEmail })
      .eq('id', targetId)
    if (clientUpdateErr) {
      // Auth update succeeded, contact-email sync failed. Surface but
      // don't tear down — the login change took effect.
      return jsonError(
        500,
        `Login email updated, but contact email sync failed: ${clientUpdateErr.message}`
      )
    }
  }

  // Send notification email to the new address (best-effort)
  let emailSent = false
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const fromAddress = `${brandName} <noreply@thegoodplansco.com>`
    const html = buildNotificationHtml({
      displayName,
      brandName,
      newEmail,
    })
    const text = buildNotificationText({
      displayName,
      brandName,
      newEmail,
    })
    try {
      const sendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: newEmail,
          subject: 'Your login email has been updated',
          html,
          text,
        }),
      })
      emailSent = sendRes.ok
    } catch {
      /* best-effort — login change still took effect */
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      updated: targetType === 'client' && syncContactEmail
        ? 'auth_and_contact'
        : 'auth_only',
      email_sent: emailSent,
    }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
  )
})

// =============================================================================
// Notification email — sent to the new address. Confirms the login
// email change so the recipient knows the change is real and what to
// use next time they sign in.
// =============================================================================

function buildNotificationHtml({
  displayName,
  brandName,
  newEmail,
}: {
  displayName: string
  brandName: string
  newEmail: string
}): string {
  const safeName = escapeHtml(displayName)
  const safeBrand = escapeHtml(brandName)
  const safeEmail = escapeHtml(newEmail)
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="${safeBrand}" style="height: 80px; width: auto;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      Hi ${safeName},
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      Your login email for the ${safeBrand} portal has been updated. Going forward, use this email to sign in:
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0; font-weight: bold;">
      ${safeEmail}
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${PORTAL_URL}" style="display: inline-block; background-color: #FFF200; color: #0f0f0f; font-weight: bold; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Sign in</a>
    </div>

    <p style="font-size: 12px; line-height: 1.5; color: #0f0f0f; margin: 24px 0 0 0;">
      If you didn't expect this change, please contact your coach.
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 24px 0 0 0;">
      Sincerely,<br>
      The ${safeBrand} team
    </p>

  </div>
</div>`
}

function buildNotificationText({
  displayName,
  brandName,
  newEmail,
}: {
  displayName: string
  brandName: string
  newEmail: string
}): string {
  return `Hi ${displayName},

Your login email for the ${brandName} portal has been updated. Going forward, use this email to sign in:

${newEmail}

Sign in: ${PORTAL_URL}

If you didn't expect this change, please contact your coach.

Sincerely,
The ${brandName} team
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

function isValidEmail(s: string): boolean {
  // Pragmatic email check. Not RFC-perfect but catches typos and
  // obviously-bad inputs without false-positives on weird-but-valid
  // addresses.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

// Walk up manager_coach_id chain to find the brand owner. 10-step cap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveBrandOwner(adminClient: any, coachId: string) {
  let cursor: string | null = coachId
  for (let i = 0; i < 10; i++) {
    if (!cursor) return null
    const { data, error } = await adminClient
      .from('coaches')
      .select('id, manager_coach_id')
      .eq('id', cursor)
      .maybeSingle()
    if (error || !data) return null
    if (!data.manager_coach_id) return data.id as string
    cursor = data.manager_coach_id as string
  }
  return null
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
