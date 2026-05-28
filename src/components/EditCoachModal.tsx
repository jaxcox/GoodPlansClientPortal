import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'

type Props = {
  open: boolean
  coachId: string
  initialFullName: string
  initialPhone: string | null
  onClose: () => void
  onSaved: () => void
}

/** Edit modal for a coach record (used for both report edits — admin
 *  edits a teammate — and self edits — anyone edits their own card).
 *  Phase C scope: Full Name + Phone only. From/support emails are
 *  auto-locked to the coach's login email; admins can override via DB
 *  if ever needed but not from the UI. */
export function EditCoachModal({
  open,
  coachId,
  initialFullName,
  initialPhone,
  onClose,
  onSaved,
}: Props) {
  const [fullName, setFullName] = useState(initialFullName)
  const [phone, setPhone] = useState(initialPhone ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setFullName(initialFullName)
      setPhone(initialPhone ?? '')
      setSubmitting(false)
      setError(null)
    }
  }, [open, initialFullName, initialPhone])

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
    setSubmitting(true)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
    }>('update-coach', {
      body: {
        targetCoachId: coachId,
        displayName: fullName.trim(),
        phone: phone.trim() || null,
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
      setError(data?.error || 'Update failed.')
      return
    }
    onSaved()
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
        aria-label="Edit coach"
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">Edit coach</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field
            label="Full Name"
            value={fullName}
            onChange={setFullName}
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
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
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
