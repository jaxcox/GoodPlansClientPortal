// Edge Function: reassign-client
// Moves a client between coaches in the same hierarchy. Handles industries
// gracefully: if the target coach doesn't have the client's industry yet
// (industries are coach-scoped), the function auto-copies the industry's
// name + KPI defaults to the target coach and rewires the client's
// industry_id to the new copy. The client's other data (budgets,
// weekly_entries, custom_kpis, capacity_groups) all stay keyed by
// client_id, so they follow the client implicitly with no extra work.
//
// Authorization (manager-only control model):
//   - Caller must be a "manager" (their own manager_coach_id IS NULL —
//     i.e., they're at the top of the hierarchy)
//   - Source: caller can reassign from herself OR from any of her direct
//     reports
//   - Target: caller can reassign to herself OR to any of her direct
//     reports
//   - Reports CANNOT reassign anything (the UI hides the button; this
//     check is the server-side enforcement)
//
// Returns { ok, new_coach_id, industry_copied? } on success.
//
// Deploy: Edge Functions → New function → name `reassign-client` →
// paste → Deploy. Toggle Verify JWT OFF.

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

  // 1. Auth the caller
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

  // 2. Parse body
  let body: { clientId?: string; targetCoachId?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }
  const clientId = String(body.clientId ?? '').trim()
  const targetCoachId = String(body.targetCoachId ?? '').trim()
  if (!clientId || !targetCoachId) {
    return jsonError(400, 'clientId and targetCoachId are required')
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 3. Look up caller's profile + coach
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
    return jsonError(403, 'Only coaches can reassign clients')
  }

  const { data: callerCoach, error: callerCoachErr } = await admin
    .from('coaches')
    .select('id, brand_name, manager_coach_id, role, is_admin')
    .eq('id', callerProfile.coach_id)
    .maybeSingle()
  if (callerCoachErr) return jsonError(500, callerCoachErr.message)
  if (!callerCoach) return jsonError(500, 'Caller coach record not found')

  // Reassign is Admin OR Manager. Plain coaches can't reassign.
  // (Admin's scope = whole brand; Manager's scope = own team.)
  if (!callerCoach.is_admin && callerCoach.role !== 'manager') {
    return jsonError(
      403,
      'Only admins or managers can reassign clients.'
    )
  }

  // 4. Resolve the caller's hierarchy: source + target must be inside
  //    it. Admins can reassign anywhere in the brand (every coach in
  //    the brand). Managers can reassign within their own team only
  //    (self + direct reports).
  let hierarchyIds: Set<string>
  if (callerCoach.is_admin) {
    // Walk to brand owner, then collect every coach rooted there.
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
    const { data: allCoaches, error: allErr } = await admin
      .from('coaches')
      .select('id, manager_coach_id')
    if (allErr) return jsonError(500, allErr.message)
    hierarchyIds = new Set<string>([brandOwnerId])
    let changed = true
    while (changed) {
      changed = false
      for (const c of allCoaches ?? []) {
        const row = c as { id: string; manager_coach_id: string | null }
        if (
          !hierarchyIds.has(row.id) &&
          row.manager_coach_id &&
          hierarchyIds.has(row.manager_coach_id)
        ) {
          hierarchyIds.add(row.id)
          changed = true
        }
      }
    }
  } else {
    // Manager: self + direct reports.
    const { data: reports, error: reportsErr } = await admin
      .from('coaches')
      .select('id')
      .eq('manager_coach_id', callerCoach.id)
    if (reportsErr) return jsonError(500, reportsErr.message)
    hierarchyIds = new Set<string>([
      callerCoach.id,
      ...(reports ?? []).map((r) => (r as { id: string }).id),
    ])
  }

  // 5. Look up the client + verify ownership within the hierarchy
  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, coach_id, industry_id, company_name')
    .eq('id', clientId)
    .maybeSingle()
  if (clientErr) return jsonError(500, clientErr.message)
  if (!client) return jsonError(404, 'Client not found')
  if (!hierarchyIds.has(client.coach_id)) {
    return jsonError(403, 'Client is not in your team.')
  }
  if (client.coach_id === targetCoachId) {
    return jsonError(400, 'Client is already assigned to that coach')
  }

  // 6. Look up the target coach + verify it's in the hierarchy
  const { data: targetCoach, error: targetCoachErr } = await admin
    .from('coaches')
    .select('id, brand_name')
    .eq('id', targetCoachId)
    .maybeSingle()
  if (targetCoachErr) return jsonError(500, targetCoachErr.message)
  if (!targetCoach) return jsonError(404, 'Target coach not found')
  if (!hierarchyIds.has(targetCoach.id)) {
    return jsonError(
      403,
      'Target coach is not on your team.'
    )
  }

  // 6. Industry continuity. If the client has an industry assigned, check
  //    whether the target coach has a matching one by name. If not, copy.
  let industryCopied = false
  let newIndustryId: string | null = client.industry_id
  if (client.industry_id) {
    const { data: sourceIndustry, error: sourceIndErr } = await admin
      .from('industries')
      .select('id, coach_id, name, kpi_defaults')
      .eq('id', client.industry_id)
      .maybeSingle()
    if (sourceIndErr) return jsonError(500, sourceIndErr.message)
    if (sourceIndustry && sourceIndustry.coach_id !== targetCoachId) {
      // Look for a matching industry name on the target coach
      const { data: existing, error: existingErr } = await admin
        .from('industries')
        .select('id')
        .eq('coach_id', targetCoachId)
        .eq('name', sourceIndustry.name)
        .maybeSingle()
      if (existingErr) return jsonError(500, existingErr.message)
      if (existing) {
        newIndustryId = existing.id
      } else {
        // Copy the industry to the target coach
        const { data: copied, error: copyErr } = await admin
          .from('industries')
          .insert({
            coach_id: targetCoachId,
            name: sourceIndustry.name,
            kpi_defaults: sourceIndustry.kpi_defaults,
          })
          .select('id')
          .single()
        if (copyErr || !copied) {
          return jsonError(
            500,
            copyErr?.message ?? 'Failed to copy industry to target coach'
          )
        }
        newIndustryId = copied.id
        industryCopied = true
      }
    }
  }

  // 7. Reassign. Service role bypasses the clients-immutability trigger
  //    (migration 0013 bypasses on auth.uid() = null).
  const { error: reassignErr } = await admin
    .from('clients')
    .update({
      coach_id: targetCoachId,
      industry_id: newIndustryId,
    })
    .eq('id', clientId)
  if (reassignErr) return jsonError(500, reassignErr.message)

  return new Response(
    JSON.stringify({
      ok: true,
      new_coach_id: targetCoachId,
      industry_copied: industryCopied,
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
