// Edge Function: resend-coach-welcome
// Admin-only. Generates a fresh Supabase password-recovery link for a
// target coach in the same brand and emails it to them. Used by the
// Resend Welcome button on TeamPage when a coach's first welcome email
// got lost, expired, or never reached them.
//
// Authorization:
//   - Caller must be an Admin (coaches.is_admin = true)
//   - Caller + target must be in the same brand (walking up the
//     manager_coach_id chain reaches the same root)
//   - Caller can resend to themselves too (no real reason to block it)
//
// Returns { ok: true, email_sent: boolean } on success.
//
// Deploy: Edge Functions → New function → name `resend-coach-welcome` →
// paste → Deploy. Toggle Verify JWT OFF.

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

  // Auth
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

  // Parse
  let body: { targetCoachId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const targetCoachId = String(body.targetCoachId ?? '').trim()
  if (!targetCoachId) return jsonError(400, 'targetCoachId is required')

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Caller must be admin
  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, coach_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerProfileErr) return jsonError(500, callerProfileErr.message)
  if (!callerProfile || callerProfile.role !== 'coach' || !callerProfile.coach_id) {
    return jsonError(403, 'Only coaches can resend welcomes')
  }

  const { data: callerCoach, error: callerCoachErr } = await admin
    .from('coaches')
    .select('id, brand_name, is_admin, manager_coach_id')
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')
  if (!callerCoach.is_admin) {
    return jsonError(403, 'Only admins can resend welcomes')
  }

  // Target must exist + be in caller's brand
  const { data: targetCoach, error: targetErr } = await admin
    .from('coaches')
    .select('id')
    .eq('id', targetCoachId)
    .maybeSingle()
  if (targetErr) return jsonError(500, targetErr.message)
  if (!targetCoach) return jsonError(404, 'Coach not found')

  const callerBrandOwner = await resolveBrandOwner(admin, callerCoach.id)
  const targetBrandOwner = await resolveBrandOwner(admin, targetCoach.id)
  if (
    !callerBrandOwner ||
    !targetBrandOwner ||
    callerBrandOwner !== targetBrandOwner
  ) {
    return jsonError(403, 'That coach is not in your brand')
  }

  // Look up the target's auth email (via profiles row → auth.users)
  const { data: targetProfile, error: targetProfileErr } = await admin
    .from('profiles')
    .select('id, display_name')
    .eq('coach_id', targetCoachId)
    .eq('role', 'coach')
    .maybeSingle()
  if (targetProfileErr) return jsonError(500, targetProfileErr.message)
  if (!targetProfile) return jsonError(404, 'Coach profile not found')

  const { data: targetAuth, error: targetAuthErr } =
    await admin.auth.admin.getUserById(targetProfile.id)
  if (targetAuthErr || !targetAuth?.user?.email) {
    return jsonError(500, 'Could not find the coach’s email address')
  }
  const targetEmail = targetAuth.user.email
  const targetName = targetProfile.display_name ?? 'there'

  // Generate fresh recovery link
  const { data: linkData, error: linkErr } =
    await admin.auth.admin.generateLink({
      type: 'recovery',
      email: targetEmail,
    })
  const actionLink = linkData?.properties?.action_link
  if (linkErr || !actionLink) {
    return jsonError(
      500,
      linkErr?.message ?? 'Failed to generate password-set link'
    )
  }

  // Email it
  let emailSent = false
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const fromAddress = `${callerCoach.brand_name} <noreply@thegoodplansco.com>`
    const html = buildWelcomeHtml({
      fullName: targetName,
      brandName: callerCoach.brand_name,
      actionLink,
    })
    const text = buildWelcomeText({
      fullName: targetName,
      brandName: callerCoach.brand_name,
      actionLink,
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
          to: targetEmail,
          subject: `Welcome to ${callerCoach.brand_name}`,
          html,
          text,
        }),
      })
      emailSent = sendRes.ok
    } catch {
      /* swallow */
    }
  }

  return new Response(
    JSON.stringify({ ok: true, email_sent: emailSent }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
  )
})

// =============================================================================
// Welcome email — mirrors the add-coach template so the resent message
// reads exactly like the original.
// =============================================================================

function buildWelcomeHtml({
  fullName,
  brandName,
  actionLink,
}: {
  fullName: string
  brandName: string
  actionLink: string
}): string {
  const safeName = escapeHtml(fullName)
  const safeBrand = escapeHtml(brandName)
  const safeLink = escapeHtml(actionLink)
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="${safeBrand}" width="80" height="80" style="display: block; width: 80px; height: 80px; max-width: 80px;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      Hi ${safeName},
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      You've been added as a coach on the ${safeBrand} portal. Click the button below to set your password and sign in for the first time.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${safeLink}" style="display: inline-block; background-color: #FFF200; color: #0f0f0f; font-weight: bold; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Set your password</a>
    </div>

    <p style="font-size: 12px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      This link is single-use and expires after one hour. If it expires, ask whoever added you to send a new one.
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0;">
      Sincerely,<br>
      The ${safeBrand} team
    </p>

  </div>
</div>`
}

function buildWelcomeText({
  fullName,
  brandName,
  actionLink,
}: {
  fullName: string
  brandName: string
  actionLink: string
}): string {
  return `Hi ${fullName},

You've been added as a coach on the ${brandName} portal. Click the link below to set your password and sign in for the first time.

Set your password: ${actionLink}

This link is single-use and expires after one hour. If it expires, ask whoever added you to send a new one.

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

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Walk up the manager_coach_id chain to find the brand owner.
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
