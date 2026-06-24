import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateInviteCode } from '../lib/inviteCode'
import { useAuth } from '../lib/auth'
import { useFocusTrap } from '../lib/useFocusTrap'
import {
  emptyKpiDefaults,
  toggleableByCategory,
} from '../lib/kpis'
import { useKpiToggle } from '../lib/useKpiToggle'
import type { Client, Industry } from '../lib/types'
import { formatPhone } from '../lib/phone'
import { getBrandOwnerId } from '../lib/brandOwner'
import { Toggle } from './Toggle'
import { IndustryQuickAddModal } from './IndustryQuickAddModal'
import { ChangeLoginEmailModal } from './ChangeLoginEmailModal'

const CREATE_NEW_INDUSTRY = '__create__'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (client: Client) => void
  /** When provided, the modal is in Edit mode for that client. */
  editing?: Client | null
}

export function ClientFormModal({ open, onClose, onSaved, editing }: Props) {
  const { coach } = useAuth()
  const isEdit = Boolean(editing)
  const emailLocked = Boolean(editing?.activated)

  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [sharedFolderLink, setSharedFolderLink] = useState('')
  const [industryId, setIndustryId] = useState<string>('')
  const [kpis, setKpis] = useState<Record<string, number>>(emptyKpiDefaults())

  const [industries, setIndustries] = useState<Industry[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [industryModalOpen, setIndustryModalOpen] = useState(false)
  const [changeEmailOpen, setChangeEmailOpen] = useState(false)

  // Reset when reopening (or seed from `editing`)
  useEffect(() => {
    if (!open) {
      setError(null)
      setSubmitting(false)
      return
    }
    if (editing) {
      setCompanyName(editing.company_name)
      setContactName(editing.contact_name ?? '')
      setEmail(editing.email ?? '')
      setPhone(formatPhone(editing.phone ?? ''))
      setSharedFolderLink(editing.shared_folder_link ?? '')
      setIndustryId(editing.industry_id ?? '')
      setKpis({ ...emptyKpiDefaults(), ...(editing.kpis ?? {}) })
    } else {
      setCompanyName('')
      setContactName('')
      setEmail('')
      setPhone('')
      setSharedFolderLink('')
      setIndustryId('')
      setKpis(emptyKpiDefaults())
    }
    setError(null)
    setSubmitting(false)
  }, [open, editing])

  // Load industries when opened
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('industries')
        .select('*')
        .order('name')
      if (cancelled) return
      if (error) {
        setError(error.message)
        setIndustries([])
      } else {
        setIndustries((data ?? []) as Industry[])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open])

  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const selectedIndustry = useMemo(
    () => industries?.find((i) => i.id === industryId) ?? null,
    [industries, industryId]
  )

  // When the user actively switches industries, replace KPI toggles with that
  // industry's defaults (matches Doc 04: "Industry change resets KPI defaults").
  // The special CREATE_NEW_INDUSTRY value opens a stacked modal instead of
  // selecting; the dropdown's value stays at the previous selection.
  const onIndustryChange = (id: string) => {
    if (id === CREATE_NEW_INDUSTRY) {
      setIndustryModalOpen(true)
      return
    }
    setIndustryId(id)
    const ind = industries?.find((i) => i.id === id)
    if (ind) {
      setKpis({ ...emptyKpiDefaults(), ...(ind.kpi_defaults ?? {}) })
    } else {
      setKpis(emptyKpiDefaults())
    }
  }

  const onIndustryCreated = (created: Industry) => {
    setIndustries((prev) => {
      const next = [...(prev ?? []), created]
      next.sort((a, b) => a.name.localeCompare(b.name))
      return next
    })
    setIndustryId(created.id)
    setKpis({ ...emptyKpiDefaults(), ...(created.kpi_defaults ?? {}) })
    setIndustryModalOpen(false)
  }

  const { onToggle: onKpiToggle, feedback: kpiFeedback } = useKpiToggle(
    kpis,
    setKpis
  )

  // Keep useFocusTrap above the early return so hook order stays
  // stable when open flips. The hook is a no-op when active=false.
  const trapRef = useFocusTrap(open)

  if (!open) return null

  const noIndustries = industries !== null && industries.length === 0
  const groups = toggleableByCategory()

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
    if (!industryId) {
      setError('Pick an industry.')
      return
    }

    setSubmitting(true)

    if (isEdit && editing) {
      const updates: Partial<Client> = {
        company_name: companyName.trim(),
        contact_name: contactName.trim() || null,
        phone: phone.trim() || null,
        shared_folder_link: sharedFolderLink.trim() || null,
        industry_id: industryId,
        kpis,
      }
      if (!emailLocked) {
        updates.email = email.trim().toLowerCase()
      }
      const { data, error: updateError } = await supabase
        .from('clients')
        .update(updates)
        .eq('id', editing.id)
        .select()
        .single()
      setSubmitting(false)
      if (updateError) {
        setError(updateError.message)
        return
      }
      onSaved(data as Client)
      onClose()
      return
    }

    // Create mode
    const inviteCode = generateInviteCode()
    const expires = new Date()
    expires.setDate(expires.getDate() + 30)

    const { data, error: insertError } = await supabase
      .from('clients')
      .insert({
        coach_id: coach.id,
        industry_id: industryId,
        company_name: companyName.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        shared_folder_link: sharedFolderLink.trim() || null,
        invite_code: inviteCode,
        invite_code_expires_at: expires.toISOString(),
        activated: false,
        archived: false,
        kpis,
      })
      .select()
      .single()

    if (insertError) {
      setSubmitting(false)
      setError(insertError.message)
      return
    }

    // Fire-and-don't-block the invite email. Client creation already
    // succeeded; if Resend rejects (DNS hiccup, rate limit, key issue)
    // the coach can hit "Resend Invite" on the pending card.
    const newClient = data as Client
    const { error: inviteErr } = await supabase.functions.invoke(
      'send-client-invite',
      { body: { clientId: newClient.id } }
    )
    setSubmitting(false)
    if (inviteErr) {
      // Surface as a soft warning — client row still got created, the
      // coach can manually resend from the pending card.
      console.warn('Invite email failed:', inviteErr.message)
    }

    onSaved(newClient)
    onClose()
  }

  const titleText = isEdit
    ? `Edit ${editing?.company_name ?? 'Client'}`
    : 'Create New Client'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={titleText}
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-brand text-white text-base font-bold">{titleText}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company Name *" value={companyName} onChange={setCompanyName} autoFocus />
            <Field label="Contact Name" value={contactName} onChange={setContactName} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Field
                label={emailLocked ? 'Email (login)' : 'Email *'}
                type="email"
                value={email}
                onChange={setEmail}
                disabled={emailLocked}
              />
              {emailLocked && (
                <button
                  type="button"
                  onClick={() => setChangeEmailOpen(true)}
                  className="text-xs text-white italic mt-1 underline underline-offset-2 decoration-accent hover:opacity-80"
                >
                  Change login email →
                </button>
              )}
            </div>
            <Field
              label="Phone"
              type="tel"
              value={phone}
              onChange={(v) => setPhone(formatPhone(v))}
              placeholder="(555)555-1212"
            />
          </div>
          <Field
            label="Shared Folder Link"
            placeholder="https://drive.google.com/..."
            value={sharedFolderLink}
            onChange={setSharedFolderLink}
          />

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
              Industry *
            </label>
            {industries === null ? (
              <div className="text-white text-xs italic">Loading…</div>
            ) : noIndustries ? (
              <div className="space-y-2">
                <div className="text-xs text-black bg-line/40 border border-line rounded px-3 py-2 leading-relaxed">
                  No industries defined yet. Create one to continue.
                </div>
                <button
                  type="button"
                  onClick={() => setIndustryModalOpen(true)}
                  className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95"
                >
                  + Create new industry
                </button>
              </div>
            ) : (
              <select
                value={industryId}
                onChange={(e) => onIndustryChange(e.target.value)}
                className="select-yellow w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
              >
                <option value="">— Pick one —</option>
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
                <option disabled>──────────</option>
                <option value={CREATE_NEW_INDUSTRY}>+ Create new industry…</option>
              </select>
            )}
            {isEdit && (
              <div className="text-xs text-white mt-1">
                Switching industries replaces the indicator toggles below with that industry's defaults.
              </div>
            )}
          </div>

          {selectedIndustry && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-semibold uppercase tracking-wider text-white">
                  KPI Defaults
                </label>
                <span className="text-xs text-white">
                  {isEdit ? 'Override per client' : `Pulled from "${selectedIndustry.name}"`}
                </span>
              </div>
              <div className="bg-surface-2 rounded p-3 space-y-3">
                {groups.map((group) => (
                  <div key={group.category}>
                    <div className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                      {group.category}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                      {group.kpis.map((k) => (
                        <Toggle
                          key={k.id}
                          checked={Number(kpis[k.id]) === 1}
                          onChange={(on) => onKpiToggle(k.id, on)}
                          label={k.label}
                        />
                      ))}
                    </div>
                  </div>
                ))}
                {kpiFeedback && (
                  <div className="text-xs text-white bg-accent/10 border border-accent/40 rounded px-3 py-2">
                    {kpiFeedback}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div role="alert" aria-live="assertive" className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
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
              disabled={submitting || (!isEdit && noIndustries)}
              className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>

      {coach && (
        <IndustryQuickAddModal
          open={industryModalOpen}
          brandOwnerId={getBrandOwnerId(coach)}
          onClose={() => setIndustryModalOpen(false)}
          onCreated={onIndustryCreated}
        />
      )}

      {/* Sub-modal: change a client's auth.users.email (admin-only,
          server-enforced). Only mountable when editing an activated
          client — `editing` is set + emailLocked is true. The current
          email comes from clients.email which is normally in sync with
          the auth email but isn't authoritative; the change-login flow
          updates auth.users and (by checkbox default) clients.email. */}
      {isEdit && editing && emailLocked && (
        <ChangeLoginEmailModal
          open={changeEmailOpen}
          targetType="client"
          targetId={editing.id}
          currentEmail={editing.email}
          targetName={editing.company_name || 'this client'}
          onClose={() => setChangeEmailOpen(false)}
          onSaved={() => {
            setChangeEmailOpen(false)
            // Reflect the new email in this modal's local state so the
            // user sees it immediately without closing/reopening.
            setEmail((prev) => prev) // no-op; parent should refetch on close
            // Most callers refetch the client list after onSaved fires;
            // we don't have a direct way to refresh `editing` from the
            // child, so closing the parent modal next is the cleanest
            // path for the user.
          }}
        />
      )}
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
  disabled,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  autoFocus?: boolean
  disabled?: boolean
  hint?: string
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
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        className={`w-full rounded text-sm px-3 py-2 focus:outline-none ${
          disabled
            ? 'bg-surface-1 border border-line text-white cursor-not-allowed'
            : 'bg-white border-2 border-accent ring-1 ring-inset ring-black text-black focus:border-accent'
        }`}
      />
      {hint && <div className="text-xs text-white mt-1">{hint}</div>}
    </div>
  )
}
