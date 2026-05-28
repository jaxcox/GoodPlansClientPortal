import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { AddCoachModal } from './AddCoachModal'

type Coach = {
  id: string
  display_name: string | null
  created_at: string
  client_count: number
  is_current: boolean
}

type Props = {
  /** Called when a coach card is clicked. The parent (CoachAdmin)
   *  switches the active tab to Clients and pre-filters the list to
   *  this coach's clients. Passing `null` means "All coaches" / no
   *  filter, used by the "All clients" card if we ever add one. */
  onSelectCoach: (coachId: string | null) => void
}

/** Team management page on Coach Admin. Lists the caller (manager) +
 *  their direct reports per migration 0015. Manager-only — reports
 *  signed in see only their own card (no other team members visible
 *  because RLS doesn't expose them). Clicking a card jumps to the
 *  Clients tab filtered to that coach. */
export function TeamPage({ onSelectCoach }: Props) {
  const { coach } = useAuth()
  const [coaches, setCoaches] = useState<Coach[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [isManager, setIsManager] = useState<boolean>(false)

  const refresh = async () => {
    if (!coach) return

    // Determine if the caller is a manager (manager_coach_id IS NULL).
    // Only managers see + edit the team — reports just see their own card.
    const { data: selfRow } = await supabase
      .from('coaches')
      .select('manager_coach_id')
      .eq('id', coach.id)
      .maybeSingle()
    const callerIsManager =
      !!selfRow &&
      (selfRow as { manager_coach_id: string | null }).manager_coach_id ===
        null
    setIsManager(callerIsManager)

    // Fetch self + direct reports (RLS scopes this to what the caller
    // can see; for managers that's all reports, for reports it's just
    // themselves).
    const { data: coachRows, error: coachErr } = await supabase
      .from('coaches')
      .select('id, created_at, manager_coach_id')
      .or(`id.eq.${coach.id},manager_coach_id.eq.${coach.id}`)
      .order('created_at', { ascending: true })
    if (coachErr) {
      setError(coachErr.message)
      setCoaches([])
      return
    }

    const ids = (coachRows ?? []).map((r) => (r as { id: string }).id)

    // Profiles for display_name
    const { data: profiles } = await supabase
      .from('profiles')
      .select('coach_id, display_name, role')
      .in('coach_id', ids)
      .eq('role', 'coach')

    // Count activated, non-archived clients per coach. RLS lets managers
    // see their reports' clients per migration 0015's clients_select_reports.
    const { data: clientCounts } = await supabase
      .from('clients')
      .select('coach_id, archived, activated')
      .in('coach_id', ids)
    const countByCoach: Record<string, number> = {}
    for (const c of clientCounts ?? []) {
      const row = c as {
        coach_id: string
        archived: boolean
        activated: boolean
      }
      if (row.archived || !row.activated) continue
      countByCoach[row.coach_id] =
        (countByCoach[row.coach_id] ?? 0) + 1
    }

    const merged: Coach[] = (coachRows ?? []).map((c) => {
      const row = c as { id: string; created_at: string }
      const profile = (profiles ?? []).find(
        (p) => (p as { coach_id: string | null }).coach_id === row.id
      ) as { display_name: string | null } | undefined
      return {
        id: row.id,
        display_name: profile?.display_name ?? null,
        created_at: row.created_at,
        client_count: countByCoach[row.id] ?? 0,
        is_current: row.id === coach.id,
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
        {isManager && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95"
          >
            + Add Coach
          </button>
        )}
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
        {isManager
          ? "Your team. Click any card to view that coach's clients."
          : "You're listed here as a coach. Click your card to view your clients."}
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
          {isManager && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95 mt-4"
            >
              + Add Coach
            </button>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {coaches.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onSelectCoach(c.id)}
                className="w-full text-left bg-ink border border-line rounded-lg p-4 hover:border-accent transition-colors"
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
              </button>
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
