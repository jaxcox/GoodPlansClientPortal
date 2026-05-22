import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { PasswordField } from '../components/PasswordField'

type TopTab = 'coach' | 'client'
type ClientSubTab = 'existing' | 'firstTime'

export function LoginPage() {
  const [tab, setTab] = useState<TopTab>('coach')

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#dad7c5]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="font-brand text-2xl font-bold text-ink">
            The Good Plans Co
          </div>
          <div className="text-base font-bold text-ink mt-1">
            Client Performance Portal
          </div>
        </div>

        <div className="bg-ink rounded-xl p-6 shadow-xl">
          <div className="flex border-b border-line mb-5">
            <TabHead active={tab === 'coach'} onClick={() => setTab('coach')}>
              Coach Login
            </TabHead>
            <TabHead active={tab === 'client'} onClick={() => setTab('client')}>
              Client Login
            </TabHead>
          </div>

          {tab === 'coach' ? <CoachLoginForm /> : <ClientPanel />}
        </div>
      </div>
    </div>
  )
}

function TabHead({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2 text-xs font-bold tracking-wide ${
        active
          ? 'text-white border-b-2 border-accent -mb-px'
          : 'text-white'
      }`}
    >
      {children}
    </button>
  )
}

function CoachLoginForm() {
  const { signInWithPassword } = useAuth()
  return (
    <PasswordSignInForm
      submitLabel="Sign In as Coach"
      onSubmit={async (email, password) => {
        const { error } = await signInWithPassword(email, password)
        return error
      }}
    />
  )
}

function ClientPanel() {
  const [sub, setSub] = useState<ClientSubTab>('existing')
  return (
    <>
      <div className="flex gap-2 mb-4">
        <SubTab active={sub === 'existing'} onClick={() => setSub('existing')}>
          Existing User
        </SubTab>
        <SubTab active={sub === 'firstTime'} onClick={() => setSub('firstTime')}>
          First Time? Use Invite Code
        </SubTab>
      </div>

      {sub === 'existing' ? <ClientExistingForm /> : <ClientFirstTimeForm />}
    </>
  )
}

function SubTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-2 py-1.5 rounded text-xs font-bold border ${
        active
          ? 'border-accent bg-accent/10 text-white'
          : 'border-line bg-transparent text-white'
      }`}
    >
      {children}
    </button>
  )
}

function ClientExistingForm() {
  const { signInWithPassword } = useAuth()
  return (
    <PasswordSignInForm
      submitLabel="Sign In"
      onSubmit={async (email, password) => {
        const { error } = await signInWithPassword(email, password)
        return error
      }}
    />
  )
}

function ClientFirstTimeForm() {
  const { signInWithPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const longEnough = password.length >= 8
  const matches = confirm.length > 0 && password === confirm
  const ready = longEnough && matches

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!ready) {
      setError(
        !longEnough
          ? 'Password must be at least 8 characters.'
          : "Passwords don't match."
      )
      return
    }
    setSubmitting(true)

    const { data, error: invokeError } = await supabase.functions.invoke<{
      ok?: boolean
      error?: string
    }>('activate-client', { body: { code, email, password } })

    if (invokeError) {
      let msg = invokeError.message
      const ctx = (invokeError as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        try {
          const body = await ctx.json()
          if (body?.error) msg = body.error
        } catch {
          /* fall through */
        }
      }
      setError(msg)
      setSubmitting(false)
      return
    }

    if (!data?.ok) {
      setError(data?.error || 'Activation failed.')
      setSubmitting(false)
      return
    }

    const signInResult = await signInWithPassword(email.trim(), password)
    setSubmitting(false)
    if (signInResult.error) {
      setError(
        'Account activated, but sign-in failed. Try the Existing User tab.'
      )
    }
  }

  const visibility = { show, toggle: () => setShow((s) => !s) }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Email" type="email" value={email} onChange={setEmail} required />
      <Field
        label="Invite Code"
        value={code}
        onChange={(v) => setCode(v.toUpperCase())}
        mono
        required
      />
      <PasswordField
        label="Set a Password"
        value={password}
        onChange={setPassword}
        required
        visibility={visibility}
      />
      <PasswordRequirement value={password} />
      <PasswordField
        label="Confirm Password"
        value={confirm}
        onChange={setConfirm}
        required
        visibility={visibility}
      />
      <PasswordMatch value={confirm} matches={matches} hasPassword={password.length > 0} />

      {error && <ErrorBox>{error}</ErrorBox>}

      <button
        type="submit"
        disabled={submitting || !ready}
        className="w-full bg-accent text-black font-bold text-sm py-2 rounded hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Activating…' : 'Activate Account'}
      </button>
    </form>
  )
}

function PasswordMatch({
  value,
  matches,
  hasPassword,
}: {
  value: string
  matches: boolean
  hasPassword: boolean
}) {
  if (!hasPassword || value.length === 0) return null
  return (
    <div
      className={`text-xs -mt-2 ${
        matches ? 'text-white' : 'text-white'
      }`}
    >
      {matches ? '✓ Passwords match' : "Passwords don't match"}
    </div>
  )
}

function PasswordSignInForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string
  onSubmit: (email: string, password: string) => Promise<string | null>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  const handle = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const err = await onSubmit(email.trim(), password)
    setSubmitting(false)
    if (err) setError(err)
  }

  return (
    <form onSubmit={handle} className="space-y-3">
      <Field label="Email" type="email" value={email} onChange={setEmail} required />
      <PasswordField
        label="Password"
        value={password}
        onChange={setPassword}
        required
        autoComplete="current-password"
      />
      <div className="-mt-1 flex justify-end">
        <button
          type="button"
          onClick={() => setForgotOpen(true)}
          className="text-white text-xs underline hover:opacity-80"
        >
          Forgot password?
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-accent text-black font-bold text-sm py-2 rounded hover:brightness-95 disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : submitLabel}
      </button>
      <ForgotPasswordModal
        open={forgotOpen}
        defaultEmail={email}
        onClose={() => setForgotOpen(false)}
      />
    </form>
  )
}

/** Forgot Password modal — asks for an email, calls Supabase's built-in
 *  resetPasswordForEmail which sends the user a magic link. The link
 *  brings them back to the portal with a recovery session; AuthProvider
 *  detects PASSWORD_RECOVERY and App renders ResetPasswordRecoveryPage. */
function ForgotPasswordModal({
  open,
  defaultEmail,
  onClose,
}: {
  open: boolean
  defaultEmail: string
  onClose: () => void
}) {
  const [email, setEmail] = useState(defaultEmail)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Seed with whatever the user already typed in the sign-in form.
  useEffect(() => {
    if (open) {
      setEmail(defaultEmail)
      setError(null)
      setSent(false)
      setSubmitting(false)
    }
  }, [open, defaultEmail])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter your email.')
      return
    }
    setSubmitting(true)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      trimmed,
      { redirectTo: window.location.origin }
    )
    setSubmitting(false)
    if (resetErr) {
      setError(resetErr.message)
      return
    }
    setSent(true)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-sm my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">Forgot password</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-2 text-sm">
              ✓ Reset email sent. Check your inbox for{' '}
              <strong className="text-white">{email}</strong> and follow
              the link to set a new password.
            </div>
            <p className="text-white text-xs">
              Didn't get it? Wait a minute, check your spam folder, then
              try again. Make sure the email matches the one your coach
              has on file.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <p className="text-white text-xs leading-relaxed">
              Enter your account email. We'll send you a link to set a
              new password.
            </p>
            <Field
              label="Email"
              type="email"
              value={email}
              onChange={setEmail}
              required
            />
            {error && <ErrorBox>{error}</ErrorBox>}
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
                disabled={submitting}
                className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send reset email'}
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
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  hint?: string
  mono?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={`w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent ${
          mono ? 'font-mono tracking-wider' : ''
        }`}
        autoComplete={
          type === 'password'
            ? 'new-password'
            : type === 'email'
              ? 'email'
              : 'off'
        }
      />
      {hint && <div className="text-xs text-white mt-1">{hint}</div>}
    </div>
  )
}

function PasswordRequirement({ value }: { value: string }) {
  const ok = value.length >= 8
  const tooShort = value.length > 0 && !ok
  return (
    <div
      className={`text-xs -mt-2 ${
        tooShort ? 'text-white' : ok ? 'text-white' : 'text-white'
      }`}
    >
      {ok ? '✓ ' : ''}Password must be at least 8 characters
      {value.length > 0 && !ok && ` (${value.length}/8)`}
    </div>
  )
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
      {children}
    </div>
  )
}
