// Edge Function: update-coach
// Manager-only update for a direct report's profile + coach record.
// Lets the manager fix typos in display_name, or set from_email /
// support_email on the report's behalf (useful if the report isn't
// technical).
//
// Fields editable here:
//   - display_name → profiles.display_name (the report's coach profile)
//   - from_email   → coaches.from_email   (their personal sending address)
//   - support_email → coaches.support_email (their reply-to address)
//
// Notable fields NOT editable here:
//   - The report's auth email (login address) — separate flow, not in V1
//   - The report's password — they own that
//   - brand_name / brand_logo_url — inherited from the manager, shared
//
// Authorization: caller must be the manager of the target coach
// (manager_coach_id on target == caller's coach_id).
//
// Deploy: Edge Functions → New function → name `update-coach` → paste →
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
  }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const targetCoachId = String(body.targetCoachId ?? '').trim()
  if (!targetCoachId) return jsonError(400, 'targetCoachId is required')
  // Normalize empty strings to null on the email fields so the coach
  // can clear them by submitting blank values.
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

  // Service-role admin for DB writes
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // Validate caller is the manager of the target
  const { data: callerProfile, error: callerProfileErr } = await admin
    .from('profiles')
    .select('role, coach_id')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (callerProfileErr) return jsonError(500, callerProfileErr.message)
  if (!callerProfile || callerProfile.role !== 'coach' || !callerProfile.coach_id) {
    return jsonError(403, 'Only coaches can update team members')
  }

  const { data: targetCoach, error: targetCoachErr } = await admin
    .from('coaches')
    .select('id, manager_coach_id')
    .eq('id', targetCoachId)
    .maybeSingle()
  if (targetCoachErr) return jsonError(500, targetCoachErr.message)
  if (!targetCoach) return jsonError(404, 'Coach not found')
  if (targetCoach.manager_coach_id !== callerProfile.coach_id) {
    return jsonError(403, 'You can only edit your own direct reports')
  }

  // Apply the coaches-table updates (only if at least one of from/support
  // was supplied)
  const coachUpdates: Record<string, unknown> = {}
  if (fromEmail !== undefined) coachUpdates.from_email = fromEmail
  if (supportEmail !== undefined) coachUpdates.support_email = supportEmail
  if (Object.keys(coachUpdates).length > 0) {
    const { error: coachUpdErr } = await admin
      .from('coaches')
      .update(coachUpdates)
      .eq('id', targetCoachId)
    if (coachUpdErr) return jsonError(500, coachUpdErr.message)
  }

  // Apply the display_name update on the report's profile (if supplied)
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
