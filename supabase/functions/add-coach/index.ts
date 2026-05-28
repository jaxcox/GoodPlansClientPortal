// Edge Function: add-coach
// Adds a new coach to the SAME brand as the caller. Used by Coach Admin's
// "Team" tab to onboard a coworker.
//
// Phase C flow (the simpler / safer one):
//   1. Validate caller is an authenticated coach + admin.
//   2. Create a Supabase auth user with a random throwaway password
//      (email_confirm=true so they can use the recovery link without
//      a confirmation roundtrip).
//   3. Create a coaches row inheriting the caller's brand fields,
//      manager_coach_id = the brand owner, from_email + support_email
//      = the new coach's login email, role='coach', is_admin=false,
//      plus the new phone column (nullable).
//   4. Create a profiles row mapping the new auth user → new coach,
//      display_name = fullName.
//   5. Generate a Supabase recovery link (admin.generateLink) and email
//      it via Resend. New coach clicks → sets their password → done.
//   6. Rolls back the user + coach + profile on any DB failure. The
//      email is best-effort — if it fails, the admin can use the
//      Resend Welcome button to retry.
//
// Returns { ok, coach_id, auth_user_id, email_sent } on success.
//
// Deploy: Edge Functions → re-deploy `add-coach`. Toggle Verify JWT OFF.
//
// Env vars (Supabase auto-injects): SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY. Plus RESEND_API_KEY (already set for the
// other Resend functions).

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

  // 2. Parse + validate body
  let body: {
    email?: string
    fullName?: string
    phone?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const fullName = String(body.fullName ?? '').trim()
  const phone =
    body.phone === null
      ? null
      : typeof body.phone === 'string'
        ? body.phone.trim() || null
        : null
  if (!email) {
    return jsonError(400, 'Email is required')
  }
  if (!fullName) {
    return jsonError(400, 'Full name is required')
  }

  // 3. Look up caller's coach (admin check + brand inheritance + brand owner)
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, coach_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerProfileErr) return jsonError(500, callerProfileErr.message)
  if (!callerProfile || callerProfile.role !== 'coach' || !callerProfile.coach_id) {
    return jsonError(403, 'Only coaches can add team members')
  }

  const { data: callerCoach, error: callerCoachErr } = await admin
    .from('coaches')
    .select(
      'id, brand_name, brand_logo_url, brand_primary_color, brand_footer_text, is_admin, manager_coach_id'
    )
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')

  // Admin-only authorization (Phase B of the role overhaul)
  if (!callerCoach.is_admin) {
    return jsonError(403, 'Only admins can add coaches')
  }

  // Walk up the manager_coach_id chain to find the brand owner.
  let brandOwnerId = callerCoach.id
  let cursor: string | null = callerCoach.manager_coach_id
  for (let i = 0; i < 10; i++) {
    if (!cursor) break
    const { data: hop } = await admin
      .from('coaches')
      .select('id, manager_coach_id')
      .eq('id', cursor)
      .maybeSingle()
    if (!hop) break
    brandOwnerId = hop.id
    cursor = hop.manager_coach_id
  }

  // 4. Create the auth user with a throwaway password. The new coach
  //    won't see this password — they'll receive a recovery link via
  //    email and pick their own. email_confirm = true so the recovery
  //    link works immediately (no confirmation roundtrip).
  const throwawayPassword = generateThrowawayPassword()
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password: throwawayPassword,
      email_confirm: true,
    })
  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'Failed to create auth user'
    if (msg.toLowerCase().includes('already')) {
      return jsonError(
        400,
        'An account with that email already exists.'
      )
    }
    return jsonError(500, msg)
  }
  const newAuthUserId = created.user.id

  // 5. Create the coaches row. from_email + support_email default to
  //    the new coach's login email (per Jackie's email policy). Role
  //    = coach, is_admin = false (admin promotes later via Edit Coach
  //    if desired). manager_coach_id = brand owner so the new coach
  //    lives in the brand without a sub-team.
  const { data: newCoachRow, error: newCoachErr } = await admin
    .from('coaches')
    .insert({
      brand_name: callerCoach.brand_name,
      brand_logo_url: callerCoach.brand_logo_url,
      brand_primary_color: callerCoach.brand_primary_color,
      brand_footer_text: callerCoach.brand_footer_text,
      manager_coach_id: brandOwnerId,
      from_email: email,
      support_email: email,
      phone,
      role: 'coach',
      is_admin: false,
    })
    .select('id')
    .single()
  if (newCoachErr || !newCoachRow) {
    await admin.auth.admin.deleteUser(newAuthUserId)
    return jsonError(500, newCoachErr?.message ?? 'Failed to create coach row')
  }

  // 6. Create the profile linking auth user → coach.
  const { error: profileErr } = await admin.from('profiles').insert({
    id: newAuthUserId,
    role: 'coach',
    coach_id: newCoachRow.id,
    display_name: fullName,
  })
  if (profileErr) {
    await admin.from('coaches').delete().eq('id', newCoachRow.id)
    await admin.auth.admin.deleteUser(newAuthUserId)
    return jsonError(500, profileErr.message)
  }

  // 7. Generate a Supabase recovery link + email it via Resend. Best-
  //    effort: if the email fails, the coach + auth user still exist
  //    and the admin can hit Resend Welcome to retry.
  let emailSent = false
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
      })
    const actionLink = linkData?.properties?.action_link
    if (!linkErr && actionLink) {
      const fromAddress = `${callerCoach.brand_name} <noreply@thegoodplansco.com>`
      const html = buildWelcomeHtml({
        fullName,
        brandName: callerCoach.brand_name,
        actionLink,
      })
      const text = buildWelcomeText({
        fullName,
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
            to: email,
            subject: `Welcome to ${callerCoach.brand_name}`,
            html,
            text,
          }),
        })
        emailSent = sendRes.ok
      } catch {
        /* swallow — coach still exists, email is best-effort */
      }
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      coach_id: newCoachRow.id,
      auth_user_id: newAuthUserId,
      email_sent: emailSent,
    }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
  )
})

// =============================================================================
// Welcome email — points the new coach at a Supabase recovery link they
// click to pick their own password. Same chrome as the client invite
// emails for visual consistency.
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
      <img src="${PORTAL_URL}/logo.png" alt="${safeBrand}" style="height: 80px; width: auto;" />
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

// Random 24-char password we never show anyone. The new coach replaces
// it via the recovery link, so this just satisfies createUser's password
// requirement.
function generateThrowawayPassword(): string {
  const charset =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*'
  let out = ''
  const arr = new Uint32Array(24)
  crypto.getRandomValues(arr)
  for (let i = 0; i < 24; i++) {
    out += charset[arr[i] % charset.length]
  }
  return out
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
