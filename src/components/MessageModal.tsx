import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'client-to-coach' | 'coach-to-client'

type Props = {
  open: boolean
  mode: Mode
  /** Display name of the recipient — shown in the modal title.
   *  For client→coach: the coach's brand or name. For coach→client:
   *  the client's company / contact name. */
  recipientLabel: string
  /** Required when mode === 'coach-to-client'. The clientId who will
   *  receive the message. Ignored in client-to-coach mode. */
  clientId?: string
  onClose: () => void
}

const MAX_LEN = 4000

/** Compose-and-send a one-way email message between the coach and a
 *  client. No DB persistence in V1 — the message lives only in the
 *  recipient's inbox. Reply happens via the recipient's own mail
 *  client (the email's reply-to is wired so a normal Reply lands in
 *  the right place). */
export function MessageModal({
  open,
  mode,
  recipientLabel,
  clientId,
  onClose,
}: Props) {
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  // Reset state every time the modal opens so a previous send /
  // dismiss doesn't leak into the next open.
  useEffect(() => {
    if (open) {
      setMessage('')
      setSubmitting(false)
      setError(null)
      setSent(false)
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

  if (!open) return null

  const trimmed = message.trim()
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LEN && !submitting

  const onSend = async () => {
    if (!canSend) return
    setSubmitting(true)
    setError(null)

    const fnName =
      mode === 'client-to-coach'
        ? 'send-coach-message'
        : 'send-client-message'
    const body =
      mode === 'client-to-coach'
        ? { message: trimmed }
        : { clientId, message: trimmed }

    const { error: invokeErr } = await supabase.functions.invoke(fnName, {
      body,
    })

    setSubmitting(false)
    if (invokeErr) {
      // Try to surface the actual error body when present.
      let msg = invokeErr.message
      const ctx = (invokeErr as { context?: Response }).context
      if (ctx && typeof ctx.json === 'function') {
        try {
          const json = await ctx.json()
          if (json?.error) msg = json.error
        } catch {
          /* fall through to default message */
        }
      }
      setError(msg)
      return
    }

    setSent(true)
    // Auto-close after a brief confirmation so the modal doesn't
    // linger after success.
    setTimeout(() => {
      onClose()
    }, 1500)
  }

  const title =
    mode === 'client-to-coach' ? 'Message your coach' : `Message ${recipientLabel}`
  const placeholder =
    mode === 'client-to-coach'
      ? "What's on your mind?"
      : `Write a message to ${recipientLabel}...`

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">{title}</h2>
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
          <div className="text-white bg-good/10 border border-good/40 rounded px-3 py-2 text-sm">
            ✓ Message sent.
          </div>
        ) : (
          <>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder={placeholder}
              maxLength={MAX_LEN}
              className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none resize-y"
              autoFocus
            />
            <div className="flex justify-between items-center text-xs text-white mt-1">
              <span>
                {mode === 'client-to-coach'
                  ? 'Replies come back to your email.'
                  : 'Your reply-to is set so the client can write back.'}
              </span>
              <span>
                {trimmed.length} / {MAX_LEN}
              </span>
            </div>
            {error && (
              <div className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2 mt-3">
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="bg-transparent text-white border border-mute px-4 py-2 sm:py-1.5 rounded text-xs font-semibold hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSend}
                disabled={!canSend}
                className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95 disabled:opacity-50"
              >
                {submitting ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
