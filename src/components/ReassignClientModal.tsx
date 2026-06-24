import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'

type TeamCoach = {
  id: string
  display_name: string | null
}

type Props = {
  open: boolean
  clientId: string
  clientName: string
  /** Brand_name shared by the team so we can fetch sibling coaches. */
  brandName: string
  /** Current coach (caller). Excluded from the target dropdown. */
  currentCoachId: string
  onClose: () => void
  onReassigned: () => void
}

/** Modal to move a client from the caller to another coach in the same
 *  brand. Reads the team list, presents a dropdown, calls the
 *  reassign-client Edge Function. */
export function ReassignClientModal({
  open,
  clientId,
  clientName,
  brandName,
  currentCoachId,
  onClose,
  onReassigned,
}: Props) {
  const [teamCoaches, setTeamCoaches] = useState<TeamCoach[] | null>(null)
  const [targetId, setTargetId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (!open) return
    setTargetId('')
    setError(null)
    setSubmitting(false)
    setSuccess(false)
    ;(async () => {
      const { data: coaches, error: cErr } = await supabase
        .from('coaches')
        .select('id, brand_name')
        .eq('brand_name', brandName)
      if (cErr) {
        setError(cErr.message)
        setTeamCoaches([])
        return
      }
      const otherIds = (coaches ?? [])
        .map((c) => (c as { id: string }).id)
        .filter((id) => id !== currentCoachId)
      if (otherIds.length === 0) {
        setTeamCoaches([])
        return
      }
      const { data: profiles } = await supabase
        .from('profiles')
        .select('coach_id, display_name, role')
        .in('coach_id', otherIds)
        .eq('role', 'coach')
      setTeamCoaches(
        otherIds.map((id) => {
          const profile = (profiles ?? []).find(
            (p) => (p as { coach_id: string | null }).coach_id === id
          ) as { display_name: string | null } | undefined
          return { id, display_name: profile?.display_name ?? null }
        })
      )
    })()
  }, [open, brandName, currentCoachId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const trapRef = useFocusTrap(open)

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!targetId) return setError('Pick a coach to reassign to.')
    setSubmitting(true)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
    }>('reassign-client', {
      body: { clientId, targetCoachId: targetId },
    })
    setSubmitting(false)
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
      setError(msg)
      return
    }
    if (!data?.ok) {
      setError(data?.error || 'Reassignment failed.')
      return
    }
    setSuccess(true)
    setTimeout(() => onReassigned(), 1200)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Reassign client"
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-brand text-white text-base font-bold">
            Reassign {clientName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {success ? (
          <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-2 text-sm">
            ✓ {clientName} reassigned.
          </div>
        ) : teamCoaches === null ? (
          <div className="text-white text-sm">Loading team…</div>
        ) : teamCoaches.length === 0 ? (
          <div className="space-y-3">
            <div className="text-white text-sm">
              No other coaches in your team yet. Add a coach from the Team
              tab first.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="bg-transparent text-white border border-mute px-4 py-1.5 rounded text-xs font-semibold hover:bg-white/10"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-white text-xs leading-relaxed">
              {clientName}'s data (entries, budgets, settings) moves with
              them. If their industry isn't on the new coach yet, it'll
              be copied automatically.
            </p>
            <label className="block">
              <div className="text-white text-xs font-semibold mb-1 uppercase tracking-wider">
                Reassign to *
              </div>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="select-yellow w-full bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none"
              >
                <option value="">— Pick a coach —</option>
                {teamCoaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.display_name ?? '— no name —'}
                  </option>
                ))}
              </select>
            </label>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2"
              >
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="bg-transparent text-white border border-mute px-4 py-1.5 rounded text-xs font-semibold hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !targetId}
                className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95 disabled:opacity-50"
              >
                {submitting ? 'Reassigning…' : 'Reassign'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
