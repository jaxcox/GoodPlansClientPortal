import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { generateInviteCode } from '../lib/inviteCode'
import { useAuth } from '../lib/auth'
import {
  emptyKpiDefaults,
  toggleableByCategory,
} from '../lib/kpis'
import type { Client, Industry } from '../lib/types'
import { Toggle } from './Toggle'

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
  const [industryId, setIndustryId] = useState<string>('')
  const [kpis, setKpis] = useState<Record<string, number>>(emptyKpiDefaults())

  const [industries, setIndustries] = useState<Industry[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on close
  useEffect(() => {
    if (!open) {
      setCompanyName('')
      setContactName('')
      setEmail('')
      setSharedFolderLink('')
      setIndustryId('')
      setKpis(emptyKpiDefaults())
      setError(null)
      setSubmitting(false)
    }
  }, [open])

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

  // When industry changes, replace the KPI toggle state with that industry's defaults
  const onIndustryChange = (id: string) => {
    setIndustryId(id)
    const ind = industries?.find((i) => i.id === id)
    if (ind) {
      setKpis({ ...emptyKpiDefaults(), ...(ind.kpi_defaults ?? {}) })
    } else {
      setKpis(emptyKpiDefaults())
    }
  }

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
        shared_folder_link: sharedFolderLink.trim() || null,
        invite_code: inviteCode,
        invite_code_expires_at: expires.toISOString(),
        activated: false,
        archived: false,
        kpis,
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
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-lg my-8"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Company Name *" value={companyName} onChange={setCompanyName} autoFocus />
            <Field label="Contact Name" value={contactName} onChange={setContactName} />
          </div>
          <Field label="Email *" type="email" value={email} onChange={setEmail} />
          <Field
            label="Shared Folder Link"
            placeholder="https://drive.google.com/..."
            value={sharedFolderLink}
            onChange={setSharedFolderLink}
          />

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
              Industry *
            </label>
            {industries === null ? (
              <div className="text-mute text-xs italic">Loading…</div>
            ) : noIndustries ? (
              <div className="text-xs text-gray-300 bg-line/40 border border-line rounded px-3 py-2 leading-relaxed">
                No industries defined yet. Open the{' '}
                <strong className="text-accent">Industries</strong> tab in Coach
                Admin and create one first — that's where you set default KPIs
                that get applied to new clients.
              </div>
            ) : (
              <select
                value={industryId}
                onChange={(e) => onIndustryChange(e.target.value)}
                className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
              >
                <option value="">— Pick one —</option>
                {industries.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {selectedIndustry && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-white">
                  KPI Defaults
                </label>
                <span className="text-[10px] text-mute">
                  Pulled from “{selectedIndustry.name}” — you can override
                </span>
              </div>
              <div className="bg-surface-2 rounded p-3 space-y-3">
                {groups.map((group) => (
                  <div key={group.category}>
                    <div className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1.5">
                      {group.category}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
                      {group.kpis.map((k) => (
                        <Toggle
                          key={k.id}
                          checked={Number(kpis[k.id]) === 1}
                          onChange={(on) =>
                            setKpis((prev) => ({ ...prev, [k.id]: on ? 1 : 0 }))
                          }
                          label={k.label}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
              disabled={submitting || noIndustries}
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
