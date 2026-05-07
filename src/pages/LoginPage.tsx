import { useState } from 'react'
import { useAuth } from '../lib/auth'

type Tab = 'coach' | 'client'

export function LoginPage() {
  const { signInWithPassword } = useAuth()
  const [tab, setTab] = useState<Tab>('coach')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const result = await signInWithPassword(email.trim(), password)
    setSubmitting(false)
    if (result.error) setError(result.error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f5f3ec]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-extrabold tracking-tight text-ink">
            The Good Plans Co
          </div>
          <div className="text-sm text-mute mt-1">Client Performance Portal</div>
        </div>

        <div className="bg-ink rounded-xl p-6 shadow-xl">
          <div className="flex border-b border-line mb-5">
            <button
              type="button"
              onClick={() => {
                setTab('coach')
                setError(null)
              }}
              className={`flex-1 py-2 text-xs font-bold tracking-wide ${
                tab === 'coach'
                  ? 'text-accent border-b-2 border-accent -mb-px'
                  : 'text-mute'
              }`}
            >
              Coach Login
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('client')
                setError(null)
              }}
              className={`flex-1 py-2 text-xs font-bold tracking-wide ${
                tab === 'client'
                  ? 'text-accent border-b-2 border-accent -mb-px'
                  : 'text-mute'
              }`}
            >
              Client Login
            </button>
          </div>

          {tab === 'coach' ? (
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
                />
              </div>

              {error && (
                <div className="text-xs text-bad-soft bg-bad/10 border border-bad/40 rounded px-3 py-2">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-accent text-black font-bold text-sm py-2 rounded hover:brightness-95 disabled:opacity-50"
              >
                {submitting ? 'Signing in…' : 'Sign In as Coach'}
              </button>
            </form>
          ) : (
            <div className="text-sm text-mute leading-relaxed">
              <div className="text-white font-semibold mb-2">Client login coming soon</div>
              Client invite codes and password reset are part of Phase 2. For now the
              coach can preview the portal via Coach Admin once it's set up.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
