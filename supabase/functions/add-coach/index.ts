// Edge Function: add-coach
// Adds a new coach to the SAME brand as the caller. Used by Coach Admin's
// "Team" tab to onboard a coworker without inviting them as a separate
// tenant.
//
// Flow:
//   1. Validate caller is an authenticated coach.
//   2. Create a Supabase auth user with the provided email + password
//      (email_confirm=true so they can sign in immediately).
//   3. Create a coaches row inheriting brand_name / brand_logo_url /
//      brand_primary_color / brand_footer_text from the caller's coach,
//      so they're visually + functionally part of the same brand.
//   4. Create a profiles row mapping the new auth user → new coach,
//      role='coach'.
//   5. Send a welcome email to the new coach via Resend with their
//      sign-in URL + temp password so they can self-onboard.
//   6. Rolls back the user + coach + profile on any DB failure (the
//      email is best-effort — if it fails, the coach still exists and
//      the caller can re-send credentials manually).
//
// Returns { ok, coach_id, auth_user_id, email_sent } on success.
//
// Deploy: Edge Functions → New function → name `add-coach` → paste this →
// Deploy. Toggle Verify JWT OFF on the function (we do our own auth
// verification via the user-context client).
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
  let body: { email?: string; password?: string; displayName?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  const displayName = String(body.displayName ?? '').trim()
  if (!email || !password) {
    return jsonError(400, 'Email and password are required')
  }
  if (password.length < 8) {
    return jsonError(400, 'Password must be at least 8 characters')
  }
  if (!displayName) {
    return jsonError(400, 'Display name is required')
  }

  // 3. Look up caller's coach (for brand inheritance + same-brand check)
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
      'id, brand_name, brand_logo_url, brand_primary_color, brand_footer_text, support_email, from_email'
    )
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')

  // 4. Create the auth user
  const { data: created, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password,
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

  // 5. Create the coaches row inheriting brand fields. support_email and
  //    from_email start null — each coach manages their own personal reply-to
  //    via Coach Account once they're in. manager_coach_id is set to the
  //    CALLER's coach id so the new coach automatically reports to whoever
  //    added them (per migration 0015's hierarchy model — Jackie adds Steve,
  //    Steve becomes her report).
  const { data: newCoachRow, error: newCoachErr } = await admin
    .from('coaches')
    .insert({
      brand_name: callerCoach.brand_name,
      brand_logo_url: callerCoach.brand_logo_url,
      brand_primary_color: callerCoach.brand_primary_color,
      brand_footer_text: callerCoach.brand_footer_text,
      manager_coach_id: callerCoach.id,
      // support_email + from_email stay null — new coach sets via Coach Account
    })
    .select('id')
    .single()
  if (newCoachErr || !newCoachRow) {
    // Rollback: delete the auth user we just created
    await admin.auth.admin.deleteUser(newAuthUserId)
    return jsonError(500, newCoachErr?.message ?? 'Failed to create coach row')
  }

  // 6. Create the profile linking auth user → coach
  const { error: profileErr } = await admin.from('profiles').insert({
    id: newAuthUserId,
    role: 'coach',
    coach_id: newCoachRow.id,
    display_name: displayName,
  })
  if (profileErr) {
    // Rollback: delete the new coach row + auth user
    await admin.from('coaches').delete().eq('id', newCoachRow.id)
    await admin.auth.admin.deleteUser(newAuthUserId)
    return jsonError(500, profileErr.message)
  }

  // 7. Send the welcome email via Resend. Best-effort — the coach + auth
  //    user already exist; an email send failure isn't worth tearing it
  //    all down for. Caller is told via the response so they can re-send
  //    credentials manually if needed.
  const resendKey = Deno.env.get('RESEND_API_KEY')
  let emailSent = false
  if (resendKey) {
    const fromAddress = `${callerCoach.brand_name} <noreply@thegoodplansco.com>`
    const html = buildWelcomeHtml({
      displayName,
      email,
      password,
      brandName: callerCoach.brand_name,
    })
    const text = buildWelcomeText({
      displayName,
      email,
      password,
      brandName: callerCoach.brand_name,
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
// Welcome email — same chrome as the client invite + reset emails for
// consistency. Embeds the sign-in URL, the new coach's login email, and
// the temp password so they can self-onboard. They change the password
// from Coach Account on first sign-in.
// =============================================================================

function buildWelcomeHtml({
  displayName,
  email,
  password,
  brandName,
}: {
  displayName: string
  email: string
  password: string
  brandName: string
}): string {
  const safeName = escapeHtml(displayName)
  const safeEmail = escapeHtml(email)
  const safePassword = escapeHtml(password)
  const safeBrand = escapeHtml(brandName)
  return `<div style="font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background-color: #DAD7C5; padding: 32px 16px;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; padding: 32px 24px; border-radius: 8px;">

    <div style="text-align: center; margin-bottom: 24px;">
      <img src="${PORTAL_URL}/logo.png" alt="${safeBrand}" style="height: 80px; width: auto;" />
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 16px 0;">
      Hi ${safeName},
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      You've been added as a coach on the ${safeBrand} portal. Use the button below to sign in. We've set you up with a temporary password — change it after your first sign-in from Coach Account.
    </p>

    <div style="text-align: center; margin: 24px 0;">
      <a href="${PORTAL_URL}/coach" style="display: inline-block; background-color: #FFF200; color: #0f0f0f; font-weight: bold; font-size: 14px; text-decoration: none; padding: 12px 24px; border-radius: 6px;">Sign in</a>
    </div>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 4px 0;">
      <strong>Email:</strong> ${safeEmail}
    </p>
    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      <strong>Temporary password:</strong> <span style="font-family: 'Courier New', monospace;">${safePassword}</span>
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0 0 24px 0;">
      Once signed in, head to <strong>Coach Account → Change Password</strong> and pick something you'll remember.
    </p>

    <p style="font-size: 14px; line-height: 1.5; color: #0f0f0f; margin: 0;">
      Sincerely,<br>
      The ${safeBrand} team
    </p>

  </div>
</div>`
}

function buildWelcomeText({
  displayName,
  email,
  password,
  brandName,
}: {
  displayName: string
  email: string
  password: string
  brandName: string
}): string {
  return `Hi ${displayName},

You've been added as a coach on the ${brandName} portal. Use the link below to sign in. We've set you up with a temporary password — change it after your first sign-in from Coach Account.

Sign in: ${PORTAL_URL}/coach

Email: ${email}
Temporary password: ${password}

Once signed in, head to Coach Account → Change Password and pick something you'll remember.

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
