import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'

type Props = {
  open: boolean
  coachId: string
  coachName: string
  /** Number of clients currently owned by this coach (any status).
   *  When > 0 the remove button is disabled and the body explains
   *  the user has to reassign first. */
  clientCount: number
  onClose: () => void
  onRemoved: () => void
}

/** Confirmation panel for removing a direct report. The server-side
 *  remove-coach Edge Function does its own blocking-when-clients-exist
 *  check; this UI just surfaces the same rule up-front so the manager
 *  doesn't have to click through to learn it. */
export function RemoveCoachConfirm({
  open,
  coachId,
  coachName,
  clientCount,
  onClose,
  onRemoved,
}: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSubmitting(false)
      setError(null)
    }
  }, [open])

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

  const blocked = clientCount > 0

  const onConfirm = async () => {
    setError(null)
    setSubmitting(true)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
    }>('remove-coach', {
      body: { targetCoachId: coachId },
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
      setError(data?.error || 'Remove failed.')
      return
    }
    onRemoved()
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
        aria-label="Remove coach"
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-brand text-white text-base font-bold">Remove coach</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="text-white text-sm mb-3">
          Remove <span className="font-bold">{coachName}</span> from your team?
        </p>

        {blocked ? (
          <div className="bg-bad/10 border border-bad/40 rounded p-3 text-xs text-white mb-4">
            <div className="font-bold mb-1">
              Can't remove yet: {clientCount}{' '}
              {clientCount === 1 ? 'client is' : 'clients are'} still assigned
              to {coachName}.
            </div>
            <div>
              Reassign their clients to yourself or another coach first. Open
              the Clients tab, filter to {coachName}, and use Reassign on each
              client (or the bulk Reassign action when multiple are selected).
            </div>
          </div>
        ) : (
          <ul className="bg-ink/40 border border-line rounded p-3 text-xs text-white mb-4 space-y-1">
            <li>• Their login is permanently disabled.</li>
            <li>• Their profile and coach record are deleted.</li>
            <li>
              • Brand settings (name, logo) stay with you — those aren't
              theirs.
            </li>
            <li>• This can't be undone.</li>
          </ul>
        )}

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2 mb-3"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="bg-transparent text-white border border-mute px-4 py-2 sm:py-1.5 rounded text-xs font-semibold hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={blocked || submitting}
            className="bg-bad text-white px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Removing…' : 'Remove coach'}
          </button>
        </div>
      </div>
    </div>
  )
}
