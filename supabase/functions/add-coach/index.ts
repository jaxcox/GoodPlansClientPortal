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
//   5. Rolls back on any failure (delete auth user, delete coach row).
//
// Returns { ok, coach_id, auth_user_id } on success.
//
// Deploy: Edge Functions → New function → name `add-coach` → paste this →
// Deploy. Toggle Verify JWT OFF on the function (we do our own auth
// verification via the user-context client).
//
// Env vars (Supabase auto-injects): SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

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
  //    via Coach Account once they're in.
  const { data: newCoachRow, error: newCoachErr } = await admin
    .from('coaches')
    .insert({
      brand_name: callerCoach.brand_name,
      brand_logo_url: callerCoach.brand_logo_url,
      brand_primary_color: callerCoach.brand_primary_color,
      brand_footer_text: callerCoach.brand_footer_text,
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

  return new Response(
    JSON.stringify({
      ok: true,
      coach_id: newCoachRow.id,
      auth_user_id: newAuthUserId,
    }),
    { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
  )
})

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
