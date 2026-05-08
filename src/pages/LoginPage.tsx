import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { PasswordField } from '../components/PasswordField'

type TopTab = 'coach' | 'client'
type ClientSubTab = 'existing' | 'firstTime'

export function LoginPage() {
  const [tab, setTab] = useState<TopTab>('coach')

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f5f3ec]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-extrabold tracking-tight text-ink">
            The Good Plans Co
          </div>
          <div className="text-sm text-white mt-1">Client Performance Portal</div>
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
      {error && <ErrorBox>{error}</ErrorBox>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-accent text-black font-bold text-sm py-2 rounded hover:brightness-95 disabled:opacity-50"
      >
        {submitting ? 'Signing in…' : submitLabel}
      </button>
    </form>
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
