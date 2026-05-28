import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'
import { formatPhone } from '../lib/phone'

type Props = {
  open: boolean
  coachId: string
  initialFullName: string
  initialPhone: string | null
  /** Current role of the coach being edited. Admin viewers can change
   *  it; non-admin viewers don't see the field. */
  initialRole: 'coach' | 'manager'
  initialIsAdmin: boolean
  /** True when the SIGNED-IN viewer is an admin. Drives whether the
   *  Role + Admin controls render. Non-admins can only edit Full Name
   *  + Phone (their own row). */
  viewerIsAdmin: boolean
  /** True when the coach being edited is the viewer themselves. Used
   *  to soft-warn about demoting the last admin in the brand (server
   *  enforces the actual lockout, but a hint is friendlier). */
  isSelf: boolean
  /** Count of admins in the brand. Used to warn / disable the Admin
   *  checkbox when the target is the only admin and demoting them
   *  would lock the brand out of management. */
  brandAdminCount: number
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
  initialRole,
  initialIsAdmin,
  viewerIsAdmin,
  isSelf,
  brandAdminCount,
  onClose,
  onSaved,
}: Props) {
  const [fullName, setFullName] = useState(initialFullName)
  const [phone, setPhone] = useState(formatPhone(initialPhone ?? ''))
  const [role, setRole] = useState<'coach' | 'manager'>(initialRole)
  const [isAdmin, setIsAdmin] = useState(initialIsAdmin)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setFullName(initialFullName)
      setPhone(formatPhone(initialPhone ?? ''))
      setRole(initialRole)
      setIsAdmin(initialIsAdmin)
      setSubmitting(false)
      setError(null)
    }
  }, [open, initialFullName, initialPhone, initialRole, initialIsAdmin])

  // Last-admin guard: if this coach is currently the only admin in the
  // brand AND they're an admin, prevent unchecking. Server enforces too;
  // this is just the friendly version so the click doesn't get swallowed
  // with a generic error.
  const isLastAdmin = initialIsAdmin && brandAdminCount <= 1
  const adminCheckboxDisabled = !viewerIsAdmin || isLastAdmin

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
        // Only send role + isAdmin when the viewer is an admin — these
        // fields are server-rejected for non-admins anyway, but skipping
        // them keeps the body clean and avoids spurious "permission
        // denied" errors when a coach edits their own name.
        ...(viewerIsAdmin
          ? { role, isAdmin: isAdmin }
          : {}),
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
            onChange={(v) => setPhone(formatPhone(v))}
          />
          {viewerIsAdmin && (
            <>
              <label className="block">
                <div className="text-white text-xs font-semibold mb-1 uppercase tracking-wider">
                  Role
                </div>
                <select
                  value={role}
                  onChange={(e) =>
                    setRole(e.target.value as 'coach' | 'manager')
                  }
                  className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none"
                >
                  <option value="coach">Coach</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
              <label className="flex items-start gap-2 text-white text-sm">
                <input
                  type="checkbox"
                  checked={isAdmin}
                  disabled={adminCheckboxDisabled}
                  onChange={(e) => setIsAdmin(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-accent disabled:opacity-50"
                />
                <span>
                  Admin
                  {isLastAdmin && (
                    <span className="block text-xs italic mt-0.5">
                      {isSelf
                        ? "You're the only admin in this brand. Promote another coach to admin before removing your own admin rights."
                        : "They're the only admin in this brand. Promote another coach to admin first."}
                    </span>
                  )}
                </span>
              </label>
            </>
          )}
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
