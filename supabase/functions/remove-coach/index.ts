// Edge Function: remove-coach
// Admin-only removal of any coach in the same brand. Blocked if the
// target still owns any clients (active / pending / archived) — reassign
// them first. Also blocked if removing them would leave the brand with
// no admins (lockout protection).
// On success, deletes:
//   1. The target's profile row
//   2. The target's coaches row
//   3. The target's auth user (they lose the ability to sign in)
//
// Authorization model (Phase B of the role overhaul):
//   - Caller must be an Admin (coaches.is_admin = true)
//   - Caller + target must be in the same brand (share a brand owner
//     after walking up the manager_coach_id chain)
//   - Caller cannot remove themselves
//
// Deploy: Edge Functions → re-deploy `remove-coach`. Toggle Verify JWT OFF.

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

  // Resolve caller's coach record + admin flag
  const { data: callerCoach, error: callerCoachErr } = await admin
    .from('coaches')
    .select('id, is_admin, manager_coach_id')
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')
  if (!callerCoach.is_admin) {
    return jsonError(403, 'Only admins can remove coaches')
  }

  const { data: targetCoach, error: targetCoachErr } = await admin
    .from('coaches')
    .select('id, manager_coach_id, is_admin')
    .eq('id', targetCoachId)
    .maybeSingle()
  if (targetCoachErr) return jsonError(500, targetCoachErr.message)
  if (!targetCoach) return jsonError(404, 'Coach not found')

  // Same-brand check: walk both caller + target up the manager_coach_id
  // chain and verify they share a root. For the current 2-level
  // hierarchy that's "either we share a manager, or one of us is the
  // manager of the other, or we have the same root."
  const callerBrandOwnerId = await resolveBrandOwner(admin, callerCoach.id)
  const targetBrandOwnerId = await resolveBrandOwner(admin, targetCoach.id)
  if (
    !callerBrandOwnerId ||
    !targetBrandOwnerId ||
    callerBrandOwnerId !== targetBrandOwnerId
  ) {
    return jsonError(403, 'That coach is not in your brand')
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

  // Lockout protection: if the target is an admin and removing them
  // would leave the brand with zero admins, refuse. (We already
  // verified they're in the caller's brand, so we just count brand
  // admins.) Without this guard, a sole admin could be removed by
  // another admin and the brand would lose all management ability.
  // Note: the caller is themselves an admin (verified above), so a
  // brand can only enter this state via a race or a deeper hierarchy.
  // Still cheap to check.
  if (targetCoach.is_admin) {
    const inBrand = await collectBrandCoaches(admin, callerBrandOwnerId)
    const adminCount = inBrand.filter((c) => c.is_admin).length
    if (adminCount <= 1) {
      return jsonError(
        400,
        "Can't remove — they're the only admin in your brand. Promote another coach to admin first."
      )
    }
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

// Walk from coachId up the manager_coach_id chain to find the brand
// owner (the row where manager_coach_id is null). Returns the owner id
// or null if not resolvable. 10-step cap as a sanity bound.
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

// Collect every coach in the brand rooted at brandOwnerId. For the
// current 2-level hierarchy this is just owner + direct reports, but
// the BFS form handles deeper trees if we add levels later.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function collectBrandCoaches(adminClient: any, brandOwnerId: string) {
  const { data: all } = await adminClient
    .from('coaches')
    .select('id, manager_coach_id, is_admin')
  const inBrand = new Map<
    string,
    { id: string; manager_coach_id: string | null; is_admin: boolean }
  >()
  const owner = (all ?? []).find(
    (r: { id: string }) => r.id === brandOwnerId
  )
  if (owner) inBrand.set(owner.id, owner)
  let changed = true
  while (changed) {
    changed = false
    for (const c of all ?? []) {
      const row = c as {
        id: string
        manager_coach_id: string | null
        is_admin: boolean
      }
      if (
        !inBrand.has(row.id) &&
        row.manager_coach_id &&
        inBrand.has(row.manager_coach_id)
      ) {
        inBrand.set(row.id, row)
        changed = true
      }
    }
  }
  return Array.from(inBrand.values())
}
