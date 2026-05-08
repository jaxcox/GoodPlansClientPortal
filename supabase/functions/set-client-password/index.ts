// Edge Function: set-client-password
// Coach-only. Lets the coach set a new password for one of their clients
// directly (e.g. when the client forgot theirs and a self-service reset code
// flow is overkill). The full forgot-password reset-code flow per Doc 04 PC #8
// is a separate Phase 8 feature.
//
// Auth: caller must have a coach (or super_admin) profile, AND must own the
// target client (clients.coach_id = caller's coach_id).

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

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return jsonError(401, 'Missing authorization')

  let body: { clientId?: string; newPassword?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const clientId = String(body.clientId ?? '').trim()
  const newPassword = String(body.newPassword ?? '')
  if (!clientId || !newPassword) {
    return jsonError(400, 'clientId and newPassword are required.')
  }
  if (newPassword.length < 8) {
    return jsonError(400, 'Password must be at least 8 characters.')
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Identify the caller via their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) {
    return jsonError(401, 'Not authenticated')
  }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role, coach_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (profileErr) return jsonError(500, profileErr.message)
  if (!profile) return jsonError(403, 'No profile')
  if (profile.role !== 'coach' && profile.role !== 'super_admin') {
    return jsonError(403, 'Coach access required')
  }

  // 2. Look up the target client and verify ownership.
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, coach_id, auth_user_id, activated, archived')
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) return jsonError(500, clientErr.message)
  if (!client) return jsonError(404, 'Client not found')
  if (
    profile.role !== 'super_admin' &&
    client.coach_id !== profile.coach_id
  ) {
    return jsonError(403, "You can't update this client.")
  }
  if (!client.auth_user_id) {
    return jsonError(
      400,
      "This client hasn't activated yet — there's no password to reset. Use the invite code on their card instead."
    )
  }

  // 3. Update the password via the Auth admin API.
  const { error: updateErr } = await admin.auth.admin.updateUserById(
    client.auth_user_id,
    { password: newPassword }
  )
  if (updateErr) return jsonError(500, updateErr.message)

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
