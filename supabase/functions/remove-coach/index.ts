// Edge Function: remove-coach
// Manager-only removal of a direct report. Blocked if the report still
// owns any clients (active / pending / archived) — reassign them first.
// On success, deletes:
//   1. The report's profile row
//   2. The report's coaches row
//   3. The report's auth user (they lose the ability to sign in)
//
// Authorization: caller must be the manager of the target coach
// (manager_coach_id on target == caller's coach_id).
//
// Deploy: Edge Functions → New function → name `remove-coach` → paste →
// Deploy. Toggle Verify JWT OFF.

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

  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, coach_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerProfileErr) return jsonError(500, callerProfileErr.message)
  if (!callerProfile || callerProfile.role !== 'coach' || !callerProfile.coach_id) {
    return jsonError(403, 'Only coaches can remove team members')
  }

  if (callerProfile.coach_id === targetCoachId) {
    return jsonError(400, "You can't remove yourself")
  }

  const { data: targetCoach, error: targetCoachErr } = await admin
    .from('coaches')
    .select('id, manager_coach_id')
    .eq('id', targetCoachId)
    .maybeSingle()
  if (targetCoachErr) return jsonError(500, targetCoachErr.message)
  if (!targetCoach) return jsonError(404, 'Coach not found')
  if (targetCoach.manager_coach_id !== callerProfile.coach_id) {
    return jsonError(403, 'You can only remove your own direct reports')
  }

  // Block if any clients are still owned by them (active, pending, OR
  // archived). The whole point of blocking is to keep historic records
  // attached to a real coach, so we count everything.
  const { count: clientCount, error: countErr } = await admin
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('coach_id', targetCoachId)
  if (countErr) return jsonError(500, countErr.message)
  if ((clientCount ?? 0) > 0) {
    return jsonError(
      400,
      `Can't remove — this coach still owns ${clientCount} ${
        clientCount === 1 ? 'client' : 'clients'
      }. Reassign them first.`
    )
  }

  // Find the auth user id for this coach. We need it to call
  // admin.auth.admin.deleteUser. The profile row is the link.
  const { data: targetProfile, error: targetProfileErr } = await admin
    .from('profiles')
    .select('id')
    .eq('coach_id', targetCoachId)
    .eq('role', 'coach')
    .maybeSingle()
  if (targetProfileErr) return jsonError(500, targetProfileErr.message)
  const targetAuthUserId = targetProfile?.id ?? null

  // Delete in order: profile → coach → auth user. The clients
  // foreign-key on coach_id is "on delete cascade" by schema, but we
  // already verified clientCount is 0 so cascade is a no-op.
  if (targetAuthUserId) {
    const { error: profDelErr } = await admin
      .from('profiles')
      .delete()
      .eq('id', targetAuthUserId)
    if (profDelErr) return jsonError(500, profDelErr.message)
  }
  const { error: coachDelErr } = await admin
    .from('coaches')
    .delete()
    .eq('id', targetCoachId)
  if (coachDelErr) return jsonError(500, coachDelErr.message)
  if (targetAuthUserId) {
    const { error: authDelErr } =
      await admin.auth.admin.deleteUser(targetAuthUserId)
    if (authDelErr) {
      // Auth user deletion failed but the coach is gone from the app.
      // Surface but don't tear down (the rest of the data is already
      // detached). The orphaned auth user can be cleaned up manually
      // from the Supabase dashboard if needed.
      return jsonError(
        500,
        `Coach removed, but auth user deletion failed: ${authDelErr.message}`
      )
    }
  }

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
