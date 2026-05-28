import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { AddCoachModal } from './AddCoachModal'
import { EditCoachModal } from './EditCoachModal'
import { RemoveCoachConfirm } from './RemoveCoachConfirm'

type Coach = {
  id: string
  display_name: string | null
  from_email: string | null
  support_email: string | null
  created_at: string
  client_count: number
  /** All clients owned by this coach, including pending + archived.
   *  Used by the Remove flow's "blocked when clients exist" guard. */
  total_client_count: number
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
  const [editTarget, setEditTarget] = useState<Coach | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Coach | null>(null)

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
      .select(
        'id, created_at, manager_coach_id, from_email, support_email'
      )
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
    const totalByCoach: Record<string, number> = {}
    for (const c of clientCounts ?? []) {
      const row = c as {
        coach_id: string
        archived: boolean
        activated: boolean
      }
      totalByCoach[row.coach_id] = (totalByCoach[row.coach_id] ?? 0) + 1
      if (row.archived || !row.activated) continue
      countByCoach[row.coach_id] =
        (countByCoach[row.coach_id] ?? 0) + 1
    }

    const merged: Coach[] = (coachRows ?? []).map((c) => {
      const row = c as {
        id: string
        created_at: string
        from_email: string | null
        support_email: string | null
      }
      const profile = (profiles ?? []).find(
        (p) => (p as { coach_id: string | null }).coach_id === row.id
      ) as { display_name: string | null } | undefined
      return {
        id: row.id,
        display_name: profile?.display_name ?? null,
        from_email: row.from_email,
        support_email: row.support_email,
        created_at: row.created_at,
        client_count: countByCoach[row.id] ?? 0,
        total_client_count: totalByCoach[row.id] ?? 0,
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
          {coaches.map((c) => {
            // Manager-only Edit/Remove on report cards. The caller's own
            // card never shows them — they edit themselves on Account and
            // can't remove themselves.
            const showManagerActions = isManager && !c.is_current
            return (
              <li
                key={c.id}
                className="bg-ink border border-line rounded-lg hover:border-accent transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onSelectCoach(c.id)}
                  className="w-full text-left p-4"
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
                {showManagerActions && (
                  <div className="flex gap-2 px-4 pb-3 -mt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setEditTarget(c)
                      }}
                      className="bg-transparent text-white border border-mute px-3 py-1 rounded text-xs font-semibold hover:bg-white/10"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRemoveTarget(c)
                      }}
                      className="bg-transparent text-white border border-bad/60 px-3 py-1 rounded text-xs font-semibold hover:bg-bad/20"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            )
          })}
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

      {editTarget && (
        <EditCoachModal
          open={true}
          coachId={editTarget.id}
          initialDisplayName={editTarget.display_name ?? ''}
          initialFromEmail={editTarget.from_email}
          initialSupportEmail={editTarget.support_email}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null)
            refresh()
          }}
        />
      )}

      {removeTarget && (
        <RemoveCoachConfirm
          open={true}
          coachId={removeTarget.id}
          coachName={removeTarget.display_name || 'this coach'}
          clientCount={removeTarget.total_client_count}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            setRemoveTarget(null)
            refresh()
          }}
        />
      )}
    </section>
  )
}
