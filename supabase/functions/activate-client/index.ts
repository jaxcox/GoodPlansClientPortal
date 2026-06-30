// Edge Function: activate-client
// Called from the Login page's "First Time? Use Invite Code" form.
// Validates the invite code+email pair, creates the auth user (confirmed,
// since the invite code IS the verification), and links the client record
// to the new auth user with a profile row. Atomic with rollback.
//
// Deploy:
//   - Dashboard: Edge Functions - New function - paste this file - Deploy.
//   - CLI: `npm run functions:deploy` (after `npx supabase link`).
//
// Env vars (Supabase auto-injects the first two - nothing to set):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional (for auto-enrolling the activated client in the Resend newsletter -
// see enrollInNewsletter below). If unset, enrollment is skipped silently:
//   RESEND_CONTACTS_KEY     full-access Resend key (sending-only keys can't
//                           write contacts). Falls back to RESEND_API_KEY.
//   RESEND_MAIN_SEGMENT_ID  the public Monday Question segment
//   RESEND_CLIENTS_SEGMENT_ID  the Clients-only segment

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

  let body: { code?: string; email?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return jsonError(400, 'Bad JSON')
  }

  const code = String(body.code ?? '').trim().toUpperCase()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  if (!code || !email || !password) {
    return jsonError(400, 'Email, invite code, and password are all required.')
  }
  if (password.length < 8) {
    return jsonError(400, 'Password must be at least 8 characters.')
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  // 1. Find a matching client record
  const { data: client, error: lookupErr } = await admin
    .from('clients')
    .select(
      'id, coach_id, email, contact_name, archived, activated, invite_code_expires_at'
    )
    .eq('invite_code', code)
    .eq('email', email)
    .maybeSingle()

  if (lookupErr) return jsonError(500, lookupErr.message)
  if (!client) {
    return jsonError(400, 'Invite code or email is incorrect.')
  }
  if (client.archived) {
    return jsonError(400, 'This account is no longer accessible.')
  }
  if (client.activated) {
    return jsonError(
      400,
      'This account is already activated - sign in with your password instead.'
    )
  }
  if (
    client.invite_code_expires_at &&
    new Date(client.invite_code_expires_at) < new Date()
  ) {
    return jsonError(
      400,
      'This invite code has expired. Ask your coach for a new one.'
    )
  }

  // 2. Create the auth user (email pre-confirmed)
  const { data: created, error: createErr } = await admin.auth.admin.createUser(
    { email, password, email_confirm: true }
  )
  if (createErr || !created.user) {
    const msg = createErr?.message ?? 'Failed to create account'
    if (msg.toLowerCase().includes('already')) {
      return jsonError(
        400,
        'An account with that email already exists. Try signing in instead.'
      )
    }
    return jsonError(500, msg)
  }

  // 3. Link the client record + create the profile (with rollback)
  const { error: updateErr } = await admin
    .from('clients')
    .update({
      auth_user_id: created.user.id,
      activated: true,
      invite_code: null,
      invite_code_expires_at: null,
    })
    .eq('id', client.id)

  if (updateErr) {
    await admin.auth.admin.deleteUser(created.user.id)
    return jsonError(500, updateErr.message)
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: created.user.id,
    role: 'client',
    coach_id: client.coach_id,
    client_id: client.id,
  })

  if (profileErr) {
    // Best-effort rollback - these may fail too, in which case manual cleanup
    // is needed in the Supabase dashboard.
    await admin
      .from('clients')
      .update({ auth_user_id: null, activated: false })
      .eq('id', client.id)
    await admin.auth.admin.deleteUser(created.user.id)
    return jsonError(500, profileErr.message)
  }

  // 4. Best-effort: enroll the freshly-activated client in the Resend
  //    newsletter (main Monday Question segment + the Clients segment) so they
  //    receive the weekly content automatically. This runs exactly once per
  //    client - the `client.activated` guard above means we never reach here
  //    twice, so there's no risk of re-subscribing someone who later opts out.
  //    Never blocks activation: any failure (or missing config) is swallowed.
  await enrollInNewsletter(email, client.contact_name ?? null)

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})

// Adds the client to Resend contacts and the configured segment(s). Mirrors the
// marketing site's api/subscribe.js call so the two stay consistent. Requires a
// FULL-ACCESS Resend key - sending-only keys can't write contacts - read from
// RESEND_CONTACTS_KEY, falling back to RESEND_API_KEY. All failures are logged
// and swallowed: enrollment is a nice-to-have, account activation is not.
async function enrollInNewsletter(email: string, contactName: string | null) {
  const key =
    Deno.env.get('RESEND_CONTACTS_KEY') ?? Deno.env.get('RESEND_API_KEY')
  if (!key) return

  const segments = [
    Deno.env.get('RESEND_MAIN_SEGMENT_ID'),
    Deno.env.get('RESEND_CLIENTS_SEGMENT_ID'),
  ]
    .filter((id): id is string => !!id)
    .map((id) => ({ id }))

  const [firstName, ...rest] = (contactName ?? '').trim().split(/\s+/)
  const lastName = rest.join(' ')

  try {
    const res = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        unsubscribed: false,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
        ...(segments.length ? { segments } : {}),
      }),
    })
    if (!res.ok) {
      console.error(
        `Newsletter enroll failed for ${email}: ${res.status} ${await res
          .text()
          .catch(() => '')}`
      )
    }
  } catch (err) {
    console.error(`Newsletter enroll error for ${email}:`, err)
  }
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}
