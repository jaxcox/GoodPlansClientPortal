// Edge Function: update-coach
// Admin-only update for any coach in the same brand (Phase B of the role
// overhaul). Coaches can also call this to update their OWN row (limited
// fields) — Phase C self-edit from Team card.
//
// Fields editable here:
//   - display_name → profiles.display_name (the target's coach profile)
//   - from_email   → coaches.from_email
//   - support_email → coaches.support_email
//   - phone        → coaches.phone (Phase A column)
//
// Notable fields NOT editable here:
//   - The target's auth email (login address) — separate flow, not in V1
//   - The target's password — they own that
//   - brand_* fields — those belong on the brand owner; Phase E
//   - role / is_admin — handled in Phase C via a dedicated promote
//     endpoint or extended payload (TBD)
//
// Authorization model:
//   - Admin: can update any coach in the same brand
//   - Self: any coach can update their own row, but is limited to
//     display_name + phone (from/support are auto-locked to login email)
//
// Deploy: Edge Functions → re-deploy `update-coach`. Toggle Verify JWT OFF.

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

  // Parse body
  let body: {
    targetCoachId?: string
    displayName?: string
    fromEmail?: string | null
    supportEmail?: string | null
    phone?: string | null
    role?: 'coach' | 'manager'
    isAdmin?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const targetCoachId = String(body.targetCoachId ?? '').trim()
  if (!targetCoachId) return jsonError(400, 'targetCoachId is required')
  // Normalize empty strings to null on the email/phone fields so the
  // coach can clear them by submitting blank values.
  const displayName =
    typeof body.displayName === 'string' ? body.displayName.trim() : undefined
  const fromEmail =
    body.fromEmail === null
      ? null
      : typeof body.fromEmail === 'string'
        ? body.fromEmail.trim() || null
        : undefined
  const supportEmail =
    body.supportEmail === null
      ? null
      : typeof body.supportEmail === 'string'
        ? body.supportEmail.trim() || null
        : undefined
  const phone =
    body.phone === null
      ? null
      : typeof body.phone === 'string'
        ? body.phone.trim() || null
        : undefined
  // role + isAdmin: only admins can change these (gate enforced below).
  // Undefined here means "leave as-is"; supplying invalid values
  // is rejected.
  const newRole =
    body.role === 'coach' || body.role === 'manager' ? body.role : undefined
  const newIsAdmin =
    typeof body.isAdmin === 'boolean' ? body.isAdmin : undefined

  // Service-role admin for DB writes
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
  if (!callerProfile || callerProfile.role !== 'coach' || !callerProfile.coach_id) {
    return jsonError(403, 'Only coaches can update team members')
  }

  const { data: callerCoach, error: callerCoachErr } = await admin
    .from('coaches')
    .select('id, is_admin')
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')

  const isSelf = callerProfile.coach_id === targetCoachId

  // Authorization: admin OR self
  if (!callerCoach.is_admin && !isSelf) {
    return jsonError(403, 'Only admins can edit other coaches')
  }

  const { data: targetCoach, error: targetCoachErr } = await admin
    .from('coaches')
    .select('id, is_admin, manager_coach_id')
    .eq('id', targetCoachId)
    .maybeSingle()
  if (targetCoachErr) return jsonError(500, targetCoachErr.message)
  if (!targetCoach) return jsonError(404, 'Coach not found')

  // Same-brand check for admin-edits (self-edit doesn't need it).
  if (!isSelf) {
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

  // Self-edit field restriction: a non-admin editing themselves can only
  // change display_name + phone. from/support emails are auto-locked to
  // login email (per the role-overhaul spec); admins can still override.
  // Role + admin flag are admin-only and silently dropped for non-admin
  // self-edits (the UI doesn't expose them either, so this is belt +
  // suspenders).
  const allowAdminFields = callerCoach.is_admin
  const finalFromEmail = allowAdminFields ? fromEmail : undefined
  const finalSupportEmail = allowAdminFields ? supportEmail : undefined
  const finalRole = allowAdminFields ? newRole : undefined
  const finalIsAdmin = allowAdminFields ? newIsAdmin : undefined

  // Last-admin lockout: if this update would demote the only admin in
  // the brand, refuse. Same protection as remove-coach. Only relevant
  // when finalIsAdmin === false AND target was previously an admin.
  if (finalIsAdmin === false && targetCoach.is_admin) {
    const brandOwnerId = await resolveBrandOwner(admin, targetCoach.id)
    if (brandOwnerId) {
      const inBrand = await collectBrandCoaches(admin, brandOwnerId)
      const adminCount = inBrand.filter((c) => c.is_admin).length
      if (adminCount <= 1) {
        return jsonError(
          400,
          "Can't remove admin rights — they're the only admin in your brand. Promote another coach to admin first."
        )
      }
    }
  }

  // Apply the coaches-table updates
  const coachUpdates: Record<string, unknown> = {}
  if (finalFromEmail !== undefined) coachUpdates.from_email = finalFromEmail
  if (finalSupportEmail !== undefined)
    coachUpdates.support_email = finalSupportEmail
  if (phone !== undefined) coachUpdates.phone = phone
  if (finalRole !== undefined) coachUpdates.role = finalRole
  if (finalIsAdmin !== undefined) coachUpdates.is_admin = finalIsAdmin
  if (Object.keys(coachUpdates).length > 0) {
    const { error: coachUpdErr } = await admin
      .from('coaches')
      .update(coachUpdates)
      .eq('id', targetCoachId)
    if (coachUpdErr) return jsonError(500, coachUpdErr.message)
  }

  // Apply the display_name update on the target's profile (if supplied)
  if (displayName !== undefined) {
    const { error: profileUpdErr } = await admin
      .from('profiles')
      .update({ display_name: displayName || null })
      .eq('coach_id', targetCoachId)
      .eq('role', 'coach')
    if (profileUpdErr) return jsonError(500, profileUpdErr.message)
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

// Walk up the manager_coach_id chain to find the brand owner. Returns
// null if not resolvable. 10-step cap for sanity.
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

// BFS down from the brand owner to collect every coach in the brand.
// Used by the last-admin lockout check.
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
