import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'

type Props = {
  open: boolean
  onClose: () => void
  /** Called after the new coach is created. Receives their full name so
   *  the parent (TeamPage) can show a confirmation. */
  onAdded: (fullName: string) => void
}

/** Modal for admins to add another coach to the brand. Phase C redesign:
 *  Full Name + Phone fields; no temp password (Supabase emails the new
 *  coach a password-setup link); no credentials panel after creation —
 *  just a "welcome email sent to X" confirmation.
 */
export function AddCoachModal({ open, onClose, onAdded }: Props) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdInfo, setCreatedInfo] = useState<{
    fullName: string
    email: string
  } | null>(null)

  useEffect(() => {
    if (open) {
      setEmail('')
      setFullName('')
      setPhone('')
      setSubmitting(false)
      setError(null)
      setCreatedInfo(null)
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedEmail = email.trim().toLowerCase()
    const trimmedName = fullName.trim()
    const trimmedPhone = phone.trim()
    if (!trimmedEmail) return setError('Email is required.')
    if (!trimmedName) return setError('Full name is required.')
    setSubmitting(true)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
      email_sent?: boolean
    }>('add-coach', {
      body: {
        email: trimmedEmail,
        fullName: trimmedName,
        phone: trimmedPhone || null,
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
      setError(data?.error || 'Failed to add coach.')
      return
    }
    setCreatedInfo({ fullName: trimmedName, email: trimmedEmail })
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
        aria-label="Add coach"
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">Add coach</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {createdInfo ? (
          <div className="space-y-4">
            <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-3 text-sm">
              ✓ {createdInfo.fullName} added. A welcome email with a
              password-setup link was sent to {createdInfo.email}.
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => onAdded(createdInfo.fullName)}
                className="bg-accent text-black font-bold px-4 py-2 sm:py-1.5 rounded text-xs hover:brightness-95"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              label="Full Name"
              value={fullName}
              onChange={setFullName}
              required
            />
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              label="Phone"
              type="tel"
              value={phone}
              onChange={setPhone}
            />
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
                disabled={submitting}
                className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95 disabled:opacity-50"
              >
                {submitting ? 'Creating…' : 'Create coach'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <div className="text-white text-xs font-semibold mb-1 uppercase tracking-wider">
        {label}
        {required && ' *'}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none focus:border-accent"
      />
    </label>
  )
}
