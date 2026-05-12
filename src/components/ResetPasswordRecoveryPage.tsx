import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PasswordField } from './PasswordField'

// =============================================================================
// Reset-Password recovery page — rendered by App when isRecoverySession is
// true. The user landed here by clicking the password-reset email link;
// Supabase auto-created a recovery session. This page lets them pick a new
// password, calls supabase.auth.updateUser({ password }) to set it, then
// clears the recovery flag so the app continues to the normal logged-in view.
// =============================================================================

export function ResetPasswordRecoveryPage() {
  const { completePasswordRecovery, signOut } = useAuth()
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
    const { error: updateErr } = await supabase.auth.updateUser({
      password,
    })
    setSubmitting(false)
    if (updateErr) {
      setError(updateErr.message)
      return
    }
    completePasswordRecovery()
    // The app will now render the normal logged-in portal automatically
    // because isRecoverySession is false and the session is a regular one.
  }

  const visibility = { show, toggle: () => setShow((s) => !s) }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[#f5f3ec]">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-extrabold tracking-tight text-ink">
            The Good Plans Co
          </div>
          <div className="text-sm text-white mt-1">
            Choose your new password
          </div>
        </div>

        <div className="bg-ink rounded-xl p-6 shadow-xl">
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
              <div className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
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
            <button
              type="button"
              onClick={async () => {
                completePasswordRecovery()
                await signOut()
              }}
              className="w-full bg-transparent text-white text-xs underline hover:opacity-80 mt-2"
            >
              Cancel and return to sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
