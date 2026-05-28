import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { AddCoachModal } from './AddCoachModal'

type Coach = {
  id: string
  brand_name: string
  display_name: string | null
  email: string | null
  created_at: string
  client_count: number
  is_current: boolean
}

/** Team management page on Coach Admin. Lists every coach in the same
 *  brand as the caller. Provides + Add Coach to onboard a coworker; the
 *  reassign-clients flow lives on each client card (the existing Clients
 *  list), not here, so the Team page stays focused on roster management. */
export function TeamPage() {
  const { coach } = useAuth()
  const [coaches, setCoaches] = useState<Coach[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const refresh = async () => {
    if (!coach) return
    // Find every coach in this brand. We do this in two steps because
    // we also need profile.display_name + auth user email for each, and
    // those live on profiles + auth.users respectively.
    const { data: coachRows, error: coachErr } = await supabase
      .from('coaches')
      .select('id, brand_name, created_at')
      .eq('brand_name', coach.brand_name)
      .order('created_at', { ascending: true })
    if (coachErr) {
      setError(coachErr.message)
      setCoaches([])
      return
    }

    // Profiles map auth user → coach. Find profile rows for these coaches.
    const ids = (coachRows ?? []).map((r) => r.id)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, coach_id, display_name, role')
      .in('coach_id', ids)
      .eq('role', 'coach')

    // Count clients per coach (active only; archived not counted)
    const { data: clientCounts } = await supabase
      .from('clients')
      .select('coach_id, archived')
      .in('coach_id', ids)
    const countByCoach: Record<string, number> = {}
    for (const c of clientCounts ?? []) {
      if ((c as { archived: boolean }).archived) continue
      const id = (c as { coach_id: string }).coach_id
      countByCoach[id] = (countByCoach[id] ?? 0) + 1
    }

    // We can't pull auth.users.email directly from the client SDK (it's
    // a server-side admin call). Email gets shown as "—" for now; the
    // important data (name + client count) is here. Future: surface
    // email via an Edge Function if needed.
    const merged: Coach[] = (coachRows ?? []).map((c) => {
      const profile = (profiles ?? []).find(
        (p) => (p as { coach_id: string | null }).coach_id === c.id
      ) as { id: string; display_name: string | null } | undefined
      return {
        id: c.id,
        brand_name: c.brand_name,
        display_name: profile?.display_name ?? null,
        email: null,
        created_at: c.created_at,
        client_count: countByCoach[c.id] ?? 0,
        is_current: c.id === coach.id,
      }
    })
    setError(null)
    setCoaches(merged)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coach?.id])

  if (!coach) return null

  return (
    <section>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-ink text-lg font-bold">Team</h1>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95"
        >
          + Add Coach
        </button>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3 mb-3"
        >
          {error}
        </div>
      )}

      <p className="text-sm text-black mb-4">
        Coaches listed below share the <strong>{coach.brand_name}</strong>{' '}
        brand. Each coach sees only their own clients. To move a client to
        another coach, use the <strong>Reassign</strong> button on that
        client's card in the Clients tab.
      </p>

      {coaches === null ? (
        <div className="bg-white border border-gray-200 rounded p-6 text-sm text-black">
          Loading…
        </div>
      ) : coaches.length === 0 ? (
        <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
          <div className="text-white font-bold text-sm mb-1">
            No coaches yet
          </div>
          <div className="text-white text-xs">
            Add your first team member to get started.
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {coaches.map((c) => (
            <li
              key={c.id}
              className="bg-ink border border-line rounded-lg p-4"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="text-white font-bold text-base">
                  {c.display_name || '— no display name set —'}
                </div>
                {c.is_current && (
                  <span className="bg-accent text-black text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                    You
                  </span>
                )}
              </div>
              <div className="text-white text-xs mt-2 space-y-0.5">
                <div>
                  {c.client_count} active{' '}
                  {c.client_count === 1 ? 'client' : 'clients'}
                </div>
                <div>
                  Joined{' '}
                  {new Date(c.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <AddCoachModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          setAddOpen(false)
          refresh()
        }}
      />
    </section>
  )
}
