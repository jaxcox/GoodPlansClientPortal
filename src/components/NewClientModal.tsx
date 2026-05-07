import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateInviteCode } from '../lib/inviteCode'
import { useAuth } from '../lib/auth'
import type { Client } from '../lib/types'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (client: Client) => void
}

export function NewClientModal({ open, onClose, onCreated }: Props) {
  const { coach } = useAuth()
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [sharedFolderLink, setSharedFolderLink] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setCompanyName('')
      setContactName('')
      setEmail('')
      setSharedFolderLink('')
      setError(null)
      setSubmitting(false)
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

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!coach) {
      setError('No coach record loaded — try refreshing the page.')
      return
    }
    if (!companyName.trim()) {
      setError('Company name is required.')
      return
    }
    if (!email.trim()) {
      setError('Email is required.')
      return
    }

    setSubmitting(true)
    const inviteCode = generateInviteCode()
    const expires = new Date()
    expires.setDate(expires.getDate() + 30)

    const { data, error: insertError } = await supabase
      .from('clients')
      .insert({
        coach_id: coach.id,
        company_name: companyName.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim().toLowerCase(),
        shared_folder_link: sharedFolderLink.trim() || null,
        invite_code: inviteCode,
        invite_code_expires_at: expires.toISOString(),
        activated: false,
        archived: false,
      })
      .select()
      .single()

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onCreated(data as Client)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">Create New Client</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2 hover:text-mute"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <Field
            label="Company Name *"
            value={companyName}
            onChange={setCompanyName}
            autoFocus
          />
          <Field
            label="Contact Name"
            value={contactName}
            onChange={setContactName}
          />
          <Field
            label="Email *"
            type="email"
            value={email}
            onChange={setEmail}
          />
          <Field
            label="Shared Folder Link"
            placeholder="https://drive.google.com/..."
            value={sharedFolderLink}
            onChange={setSharedFolderLink}
          />

          <div className="text-[11px] text-mute leading-relaxed pt-1">
            Industry &amp; KPI defaults are configured later in Settings (Phase 3).
            An invite code will be generated on save.
          </div>

          {error && (
            <div className="text-xs text-bad-soft bg-bad/10 border border-bad/40 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-transparent text-mute border border-line px-4 py-1.5 rounded text-xs hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Client'}
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
  placeholder,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
      />
    </div>
  )
}
