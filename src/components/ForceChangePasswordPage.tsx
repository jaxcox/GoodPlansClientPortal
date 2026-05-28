import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { PasswordField } from './PasswordField'

// =============================================================================
// Force-change-password interstitial
// -----------------------------------------------------------------------------
// Rendered in place of the normal portal content when client.must_change_password
// is true (i.e. the coach just set a temporary password via Reset Password).
// The client cannot reach any other page until they pick their own password.
// On success: updates the auth password, flips must_change_password back to
// false, and calls onChanged so the portal re-fetches the client and continues.
// =============================================================================

type Props = {
  clientId: string
  email: string | null
  onChanged: () => void
}

export function ForceChangePasswordPage({ clientId, email, onChanged }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

    // 1. Update the auth password — does the actual sign-in-credential change.
    const { error: authErr } = await supabase.auth.updateUser({ password })
    if (authErr) {
      setError(authErr.message)
      setSubmitting(false)
      return
    }

    // 2. Clear the must_change_password flag so the interstitial doesn't
    //    keep firing. RLS allows the client to update their own client
    //    record per the existing self-update policy.
    const { error: flagErr } = await supabase
      .from('clients')
      .update({ must_change_password: false })
      .eq('id', clientId)
    setSubmitting(false)
    if (flagErr) {
      setError(flagErr.message)
      return
    }

    onChanged()
  }

  const visibility = { show, toggle: () => setShow((s) => !s) }

  return (
    <section className="max-w-md mx-auto">
      <div className="bg-ink border border-line rounded-lg p-6 space-y-4">
        <div>
          <h1 className="text-white text-base font-bold mb-1">
            Choose your password
          </h1>
          <p className="text-white text-xs leading-relaxed">
            Your coach set you a temporary password. Pick your own
            password below to continue
            {email ? (
              <>
                {' '}as <strong className="text-white">{email}</strong>
              </>
            ) : null}
            .
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <PasswordField
            label="New Password"
            value={password}
            onChange={setPassword}
            required
            visibility={visibility}
          />
          <div className="text-xs text-white -mt-2">
            {longEnough ? '✓ ' : ''}Password must be at least 8 characters
            {password.length > 0 && !longEnough && ` (${password.length}/8)`}
          </div>
          <PasswordField
            label="Confirm Password"
            value={confirm}
            onChange={setConfirm}
            required
            visibility={visibility}
          />
          {confirm.length > 0 && password.length > 0 && (
            <div className="text-xs text-white -mt-2">
              {matches ? '✓ Passwords match' : "Passwords don't match"}
            </div>
          )}

          {error && (
            <div role="alert" aria-live="assertive" className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !ready}
            className="w-full bg-accent text-black font-bold text-sm py-2 rounded hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </form>
      </div>
    </section>
  )
}
