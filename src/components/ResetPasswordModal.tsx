import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Client } from '../lib/types'
import { PasswordField } from './PasswordField'

type Props = {
  open: boolean
  client: Client | null
  onClose: () => void
  onReset: () => void
}

export function ResetPasswordModal({ open, client, onClose, onReset }: Props) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!open) {
      setPassword('')
      setConfirm('')
      setShow(false)
      setSubmitting(false)
      setError(null)
      setDone(false)
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

  if (!open || !client) return null

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
    }>('set-client-password', {
      body: { clientId: client.id, newPassword: password },
    })
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
      setError(data?.error ?? 'Reset failed.')
      setSubmitting(false)
      return
    }
    setSubmitting(false)
    setDone(true)
    onReset()
  }

  const visibility = { show, toggle: () => setShow((s) => !s) }

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
          <h2 className="text-white text-base font-bold">
            Set temporary password — {client.company_name}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {done ? (
          <div className="space-y-4">
            <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-2 text-sm">
              ✓ Temporary password set. Share it with the client however
              you usually do (text, email, in-call). They'll be required
              to choose their own password on their next sign-in.
            </div>
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
              Set a temporary password for{' '}
              <strong className="text-white">{client.email}</strong>. The
              old password stops working immediately. The client will be
              required to choose their own password the next time they
              sign in.
            </p>
            <PasswordField
              label="Temporary Password"
              value={password}
              onChange={setPassword}
              required
              visibility={visibility}
            />
            <div
              className={`text-xs -mt-2 ${
                password.length === 0
                  ? 'text-white'
                  : longEnough
                    ? 'text-white'
                    : 'text-white'
              }`}
            >
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
              <div
                className={`text-xs -mt-2 ${
                  matches ? 'text-white' : 'text-white'
                }`}
              >
                {matches ? '✓ Passwords match' : "Passwords don't match"}
              </div>
            )}

            {error && (
              <div className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
                {error}
              </div>
            )}

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
                disabled={submitting || !ready}
                className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
              >
                {submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
