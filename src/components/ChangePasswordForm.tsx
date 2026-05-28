import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { PasswordField } from './PasswordField'

type Props = {
  /** The user's email — used to re-verify the current password by re-signing in. */
  email: string
}

// Self-contained Change Password form: current + new + confirm fields, with
// visibility toggle and inline match/length feedback. Verifies the current
// password via signInWithPassword, then sets the new one via updateUser.
export function ChangePasswordForm({ email }: Props) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const longEnough = newPw.length >= 8
  const matches = confirmPw.length > 0 && newPw === confirmPw
  const sameAsOld = newPw.length > 0 && oldPw.length > 0 && newPw === oldPw
  const ready =
    oldPw.length > 0 && longEnough && matches && !sameAsOld

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDone(false)
    if (!ready) {
      setError(
        !oldPw
          ? 'Enter your current password.'
          : !longEnough
            ? 'New password must be at least 8 characters.'
            : !matches
              ? "Passwords don't match."
              : sameAsOld
                ? 'New password must differ from the current one.'
                : 'Form not ready.'
      )
      return
    }
    setSubmitting(true)

    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email,
      password: oldPw,
    })
    if (verifyErr) {
      setError('Current password is incorrect.')
      setSubmitting(false)
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({
      password: newPw,
    })
    setSubmitting(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    setOldPw('')
    setNewPw('')
    setConfirmPw('')
    setDone(true)
  }

  const visibility = { show, toggle: () => setShow((s) => !s) }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <PasswordField
        label="Current Password"
        value={oldPw}
        onChange={setOldPw}
        required
        autoComplete="current-password"
        visibility={visibility}
      />
      <PasswordField
        label="New Password"
        value={newPw}
        onChange={setNewPw}
        required
        visibility={visibility}
      />
      <div className="text-xs text-white -mt-2">
        {longEnough ? '✓ ' : ''}New password must be at least 8 characters
        {newPw.length > 0 && !longEnough && ` (${newPw.length}/8)`}
      </div>
      <PasswordField
        label="Confirm New Password"
        value={confirmPw}
        onChange={setConfirmPw}
        required
        visibility={visibility}
      />
      {confirmPw.length > 0 && newPw.length > 0 && (
        <div className="text-xs text-white -mt-2">
          {matches ? '✓ Passwords match' : "Passwords don't match"}
        </div>
      )}
      {error && (
        <div role="alert" aria-live="assertive" className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
          {error}
        </div>
      )}
      {done && (
        <div className="text-xs text-white bg-good/10 border border-good/40 rounded px-3 py-2">
          ✓ Password updated.
        </div>
      )}
      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={submitting || !ready}
          className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
