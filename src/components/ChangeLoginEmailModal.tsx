import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'

type Props = {
  open: boolean
  /** Whose login email is being changed — affects validation,
   *  permissions, and the optional contact-email sync checkbox. */
  targetType: 'coach' | 'client'
  /** The coach.id or client.id of the target. */
  targetId: string
  /** Current login email, shown read-only so the user can compare.
   *  Pass null/empty when we don't have access to it (e.g., admin
   *  editing another coach — auth.users.email isn't client-readable).
   *  The section just hides in that case. */
  currentEmail: string | null
  /** Display name for confirmation copy ("Steve" / "Acme Plumbing"). */
  targetName: string
  onClose: () => void
  onSaved: () => void
}

/** Focused modal for changing a login email (auth.users.email). Used
 *  from EditCoachModal and ClientFormModal as a "Change login email"
 *  sub-action. Server-side enforcement of permissions in the
 *  update-login-email Edge Function. */
export function ChangeLoginEmailModal({
  open,
  targetType,
  targetId,
  currentEmail,
  targetName,
  onClose,
  onSaved,
}: Props) {
  const [newEmail, setNewEmail] = useState('')
  const [syncContactEmail, setSyncContactEmail] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    if (open) {
      setNewEmail('')
      setSyncContactEmail(true)
      setSubmitting(false)
      setError(null)
      setSuccess(false)
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

  const trimmed = newEmail.trim().toLowerCase()
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  // Same-as-current check only fires when we know the current email.
  // When we don't (admin editing another coach), server enforces it.
  const isSame =
    !!currentEmail && trimmed === currentEmail.trim().toLowerCase()
  const ready = validEmail && !isSame

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!validEmail) {
      setError('Please enter a valid email address.')
      return
    }
    if (isSame) {
      setError("That's the same email that's already on file.")
      return
    }
    setSubmitting(true)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      updated?: string
      email_sent?: boolean
      error?: string
    }>('update-login-email', {
      body: {
        targetType,
        targetId,
        newEmail: trimmed,
        syncContactEmail:
          targetType === 'client' ? syncContactEmail : undefined,
      },
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
      setError(data?.error || 'Could not update the login email.')
      return
    }
    setSuccess(true)
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Change login email"
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">
            Change login email
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
          <div className="space-y-4">
            <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-3 text-sm">
              ✓ Login email updated. A notification has been sent to{' '}
              {trimmed}. {targetName} should use this email to sign in
              from now on.
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  onSaved()
                }}
                className="bg-accent text-black font-bold px-4 py-2 sm:py-1.5 rounded text-xs hover:brightness-95"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {currentEmail && (
              <div>
                <div className="text-white text-xs font-semibold mb-1 uppercase tracking-wider">
                  Current login email
                </div>
                <div className="bg-surface-2 border border-line rounded px-3 py-2 text-sm text-white">
                  {currentEmail}
                </div>
              </div>
            )}

            <label className="block">
              <div className="text-white text-xs font-semibold mb-1 uppercase tracking-wider">
                New login email *
              </div>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                autoFocus
                className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none focus:border-accent"
              />
            </label>

            {targetType === 'client' && (
              <label className="flex items-start gap-2 text-white text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={syncContactEmail}
                  onChange={(e) => setSyncContactEmail(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-accent cursor-pointer"
                />
                <span>
                  Also update the contact email on this client's record to
                  match
                </span>
              </label>
            )}

            <div
              className="text-xs text-white bg-accent/10 border border-accent/40 rounded px-3 py-2"
              role="note"
            >
              {targetName} will need to use the new email to sign in
              starting immediately. A notification will be sent to the new
              address.
            </div>

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
                className="bg-transparent text-white border border-mute px-4 py-2 sm:py-1.5 rounded text-xs font-semibold hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !ready}
                className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Updating…' : 'Update email'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
