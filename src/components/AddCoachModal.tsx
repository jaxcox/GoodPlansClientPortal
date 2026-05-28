import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/useFocusTrap'
import { PasswordField } from './PasswordField'

type Props = {
  open: boolean
  onClose: () => void
  /** Called after the new coach is created successfully so the parent
   *  list can refresh. Receives the new coach's display name in case
   *  the parent wants to highlight or message about them. */
  onAdded: (displayName: string) => void
}

/** Modal to invite a coworker as another coach in the same brand. Calls
 *  the add-coach Edge Function. On success, shows a "created — share
 *  these credentials" panel so the inviter can pass the temp password
 *  to the new coach (the portal can't email them directly without
 *  another Resend round-trip + a welcome template; sharing in person /
 *  via channel of their choice is good enough for V1).
 */
export function AddCoachModal({ open, onClose, onAdded }: Props) {
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState(() => generatePassword())
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdName, setCreatedName] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setEmail('')
      setDisplayName('')
      setPassword(generatePassword())
      setShowPassword(false)
      setSubmitting(false)
      setError(null)
      setCreatedName(null)
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
    const trimmedName = displayName.trim()
    if (!trimmedEmail) return setError('Email is required.')
    if (!trimmedName) return setError('Display name is required.')
    if (password.length < 8)
      return setError('Password must be at least 8 characters.')
    setSubmitting(true)
    const { data, error: invokeErr } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
    }>('add-coach', {
      body: {
        email: trimmedEmail,
        password,
        displayName: trimmedName,
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
    setCreatedName(trimmedName)
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

        {createdName ? (
          <div className="space-y-4">
            <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-3 text-sm">
              ✓ {createdName} added. Share the credentials below so they
              can sign in.
            </div>
            <CredentialRow label="Sign-in URL" value="https://portal.thegoodplansco.com/coach" />
            <CredentialRow label="Email" value={email.trim().toLowerCase()} />
            <CredentialRow label="Temporary password" value={password} mono />
            <p className="text-xs text-white">
              Ask them to sign in once and change their password from
              Coach Account → Change Password.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => onAdded(createdName)}
                className="bg-accent text-black font-bold px-4 py-2 sm:py-1.5 rounded text-xs hover:brightness-95"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              required
              hint="Use a @thegoodplansco.com address so their coach-to-client emails come from your domain."
            />
            <Field
              label="Display Name"
              value={displayName}
              onChange={setDisplayName}
              required
              hint="How clients will see them in email signatures (e.g. 'Steve Cox')."
            />
            <PasswordField
              label="Temporary Password"
              value={password}
              onChange={setPassword}
              required
              autoComplete="new-password"
              visibility={{ show: showPassword, toggle: () => setShowPassword((s) => !s) }}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-white">
              <button
                type="button"
                onClick={() => {
                  setPassword(generatePassword())
                  setShowPassword(true)
                }}
                className="underline hover:opacity-80"
              >
                Generate a new one
              </button>
              <span>—</span>
              <span>
                You'll share this with them after creating; they change it
                on first sign-in.
              </span>
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
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  hint?: string
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
      {hint && <div className="text-white text-xs italic mt-1">{hint}</div>}
    </label>
  )
}

function CredentialRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div>
      <div className="text-white text-xs font-semibold uppercase tracking-wider mb-1">
        {label}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={`w-full text-left bg-white border border-line rounded px-3 py-2 text-sm text-black ${
          mono ? 'font-mono' : ''
        } hover:border-accent`}
        title={copied ? 'Copied to clipboard' : 'Click to copy'}
      >
        {copied ? `${value} ✓ Copied` : value}
      </button>
    </div>
  )
}

/** Generate a memorable but secure-enough starter password. Twelve chars
 *  random alphanumeric. The new coach changes it on first sign-in. */
function generatePassword(): string {
  const charset =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let out = ''
  const arr = new Uint32Array(12)
  crypto.getRandomValues(arr)
  for (let i = 0; i < 12; i++) {
    out += charset[arr[i] % charset.length]
  }
  return out
}
