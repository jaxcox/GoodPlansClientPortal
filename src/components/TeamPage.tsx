import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { AddCoachModal } from './AddCoachModal'
import { EditCoachModal } from './EditCoachModal'
import { RemoveCoachConfirm } from './RemoveCoachConfirm'

type Coach = {
  id: string
  display_name: string | null
  phone: string | null
  role: 'coach' | 'manager'
  is_admin: boolean
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
  const { coach, refreshProfile } = useAuth()
  const [coaches, setCoaches] = useState<Coach[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [isAdmin, setIsAdmin] = useState<boolean>(false)
  const [editTarget, setEditTarget] = useState<Coach | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Coach | null>(null)
  /** Set of coach ids currently in the middle of a resend-welcome call,
   *  so the button can show a spinner + lock against double-clicks. */
  const [resendingIds, setResendingIds] = useState<Set<string>>(new Set())
  /** Most recent resend outcome message — shown briefly under the
   *  button. Cleared when another resend kicks off or after a delay. */
  const [resendNote, setResendNote] = useState<{
    coachId: string
    text: string
    ok: boolean
  } | null>(null)

  const refresh = async () => {
    if (!coach) return

    // Admin sees + edits the team (add / edit / remove). Non-admins
    // just see their own card (plus reports' cards if they're a
    // Manager, but no edit/remove buttons). Phase B of the role
    // overhaul: admin status comes off coaches.is_admin directly.
    setIsAdmin(coach.is_admin === true)

    // Fetch self + direct reports (RLS scopes this to what the caller
    // can see; for managers that's all reports, for reports it's just
    // themselves).
    const { data: coachRows, error: coachErr } = await supabase
      .from('coaches')
      .select(
        'id, created_at, manager_coach_id, phone, role, is_admin'
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
        phone: string | null
        role: 'coach' | 'manager'
        is_admin: boolean
      }
      const profile = (profiles ?? []).find(
        (p) => (p as { coach_id: string | null }).coach_id === row.id
      ) as { display_name: string | null } | undefined
      return {
        id: row.id,
        display_name: profile?.display_name ?? null,
        phone: row.phone,
        role: row.role,
        is_admin: row.is_admin,
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

  /** Send a fresh password-setup link to a teammate. Admin-only on the
   *  server (resend-coach-welcome enforces). Shows a one-shot status
   *  line under the card buttons; clears after 4 s. */
  const resendWelcome = async (target: Coach) => {
    if (resendingIds.has(target.id)) return
    setResendingIds((prev) => new Set(prev).add(target.id))
    setResendNote(null)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      email_sent?: boolean
      error?: string
    }>('resend-coach-welcome', {
      body: { targetCoachId: target.id },
    })
    setResendingIds((prev) => {
      const next = new Set(prev)
      next.delete(target.id)
      return next
    })
    let text: string
    let ok = false
    if (invokeErr) {
      let msg = invokeErr.message
      const ctx = (invokeErr as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json()
          if (body?.error) msg = body.error
        } catch {
          /* fall through */
        }
      }
      text = msg
    } else if (!data?.ok) {
      text = data?.error ?? 'Resend failed.'
    } else if (!data.email_sent) {
      text = 'Link generated but the email did not send. Try again.'
    } else {
      text = '✓ Welcome email sent.'
      ok = true
    }
    setResendNote({ coachId: target.id, text, ok })
    setTimeout(() => {
      setResendNote((prev) => (prev?.coachId === target.id ? null : prev))
    }, 4000)
  }

  if (!coach) return null

  return (
    <section>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-ink text-lg font-bold">Team</h1>
        {isAdmin && (
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
        {isAdmin
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
          {isAdmin && (
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
            // Phase C self-edit: everyone gets Edit on their own card
            // (Full Name + Phone). Admins also get Edit on other
            // coaches' cards plus Remove. Remove is never on the own
            // card (self-removal is blocked server-side too).
            const canEdit = c.is_current || isAdmin
            const canRemove = isAdmin && !c.is_current
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
                      {c.display_name || '— no full name set —'}
                    </div>
                    {c.is_current && (
                      <span className="bg-accent text-black text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                        You
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.is_admin && (
                      <span className="bg-accent text-black text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                        Admin
                      </span>
                    )}
                    {c.role === 'manager' && (
                      <span className="bg-ink text-white border border-mute text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                        Manager
                      </span>
                    )}
                    {!c.is_admin && c.role === 'coach' && (
                      <span className="bg-ink text-white border border-mute text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
                        Coach
                      </span>
                    )}
                  </div>
                  <div className="text-white text-xs mt-2 space-y-0.5">
                    {c.phone && <div>{c.phone}</div>}
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
                {(canEdit || canRemove) && (
                  <div className="px-4 pb-3 -mt-1">
                    <div className="flex flex-wrap gap-2">
                      {canEdit && (
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
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            resendWelcome(c)
                          }}
                          disabled={resendingIds.has(c.id)}
                          className="bg-transparent text-white border border-mute px-3 py-1 rounded text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
                          title="Resend the welcome email with a fresh password-set link"
                        >
                          {resendingIds.has(c.id)
                            ? 'Sending…'
                            : 'Resend Welcome'}
                        </button>
                      )}
                      {canRemove && (
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
                      )}
                    </div>
                    {resendNote?.coachId === c.id && (
                      <div
                        className={`text-xs text-white mt-2 ${
                          resendNote.ok ? '' : 'italic'
                        }`}
                        role="status"
                        aria-live="polite"
                      >
                        {resendNote.text}
                      </div>
                    )}
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
          initialFullName={editTarget.display_name ?? ''}
          initialPhone={editTarget.phone}
          initialRole={editTarget.role}
          initialIsAdmin={editTarget.is_admin}
          viewerIsAdmin={isAdmin}
          isSelf={editTarget.is_current}
          brandAdminCount={
            // Count of admins in the visible team. For a 2-level
            // hierarchy this is the full brand admin count; deeper
            // trees would need a separate query. The server enforces
            // last-admin lockout anyway, so this is just for the
            // friendlier disabled-checkbox state.
            (coaches ?? []).filter((x) => x.is_admin).length
          }
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            const wasSelf = editTarget.is_current
            setEditTarget(null)
            refresh()
            // Self-edit: also refresh the AuthContext so the header
            // chrome (which shows the signed-in coach's display_name)
            // updates without a page reload. Important when changing
            // own role/admin too — the chrome reflects whether you
            // see Industries + Account tabs.
            if (wasSelf) refreshProfile()
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
