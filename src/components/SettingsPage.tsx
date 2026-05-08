import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emptyKpiDefaults, toggleableByCategory } from '../lib/kpis'
import { useKpiToggle } from '../lib/useKpiToggle'
import type { Client, Industry } from '../lib/types'
import { Toggle } from './Toggle'
import { IndustryQuickAddModal } from './IndustryQuickAddModal'
import { CustomKpisCard } from './CustomKpisCard'

const CREATE_NEW_INDUSTRY = '__create__'

type Props = {
  clientId: string
  /** True when a coach is operating on this client's behalf via View Portal. */
  coachView: boolean
  /** Cancel calls this to leave Settings (returns to Coach Admin in coach view,
   *  switches back to Dashboard in client view). */
  onLeave: () => void
}

export function SettingsPage({ clientId, coachView, onLeave }: Props) {
  // ---- Loaded state -------------------------------------------------------
  const [client, setClient] = useState<Client | null>(null)
  const [industries, setIndustries] = useState<Industry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // ---- Form draft (what the user is editing) -----------------------------
  const [companyName, setCompanyName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [sharedFolderLink, setSharedFolderLink] = useState('')
  const [industryId, setIndustryId] = useState<string>('')
  const [kpis, setKpis] = useState<Record<string, number>>(emptyKpiDefaults())

  // ---- Save state --------------------------------------------------------
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [industryModalOpen, setIndustryModalOpen] = useState(false)

  const seedDraft = (c: Client) => {
    setCompanyName(c.company_name)
    setContactName(c.contact_name ?? '')
    setEmail(c.email ?? '')
    setSharedFolderLink(c.shared_folder_link ?? '')
    setIndustryId(c.industry_id ?? '')
    setKpis({ ...emptyKpiDefaults(), ...(c.kpis ?? {}) })
    setSavedAt(null)
    setSaveError(null)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [clientRes, indRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
        supabase.from('industries').select('*').order('name'),
      ])
      if (cancelled) return
      if (clientRes.error || !clientRes.data) {
        setLoadError(clientRes.error?.message ?? 'Client not found')
        return
      }
      setClient(clientRes.data as Client)
      seedDraft(clientRes.data as Client)
      setIndustries((indRes.data ?? []) as Industry[])
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  // ---- Editability rules per Doc 04 PC #7 --------------------------------
  // Client view: only Company Name + Contact Name are editable.
  // Coach view: everything below the company-info card is editable too.
  const canEditAll = coachView
  const emailEditable = coachView && !client?.activated
  const emailLocked = !coachView || (coachView && Boolean(client?.activated))

  // ---- Dirty tracking ----------------------------------------------------
  const isDirty = useMemo(() => {
    if (!client) return false
    return (
      companyName !== (client.company_name ?? '') ||
      contactName !== (client.contact_name ?? '') ||
      email !== (client.email ?? '') ||
      sharedFolderLink !== (client.shared_folder_link ?? '') ||
      industryId !== (client.industry_id ?? '') ||
      JSON.stringify(kpis) !==
        JSON.stringify({ ...emptyKpiDefaults(), ...(client.kpis ?? {}) })
    )
  }, [
    client,
    companyName,
    contactName,
    email,
    sharedFolderLink,
    industryId,
    kpis,
  ])

  // Saved-banner clears the moment the form is changed again.
  useEffect(() => {
    if (savedAt && isDirty) setSavedAt(null)
  }, [savedAt, isDirty])

  const onIndustryChange = (id: string) => {
    if (id === CREATE_NEW_INDUSTRY) {
      setIndustryModalOpen(true)
      return
    }
    setIndustryId(id)
    const ind = industries?.find((i) => i.id === id)
    if (ind) {
      setKpis({ ...emptyKpiDefaults(), ...(ind.kpi_defaults ?? {}) })
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

  // Cancel = exit Settings. If the form is dirty, confirm before leaving.
  // Always enabled regardless of dirty state.
  const onCancel = () => {
    if (isDirty && !confirm('Discard your unsaved changes and leave Settings?')) {
      return
    }
    if (client) seedDraft(client)
    onLeave()
  }

  const onSave = async () => {
    if (!client) return
    setSaveError(null)
    if (!companyName.trim()) {
      setSaveError('Company name is required.')
      return
    }
    if (canEditAll && !industryId) {
      setSaveError('Pick an industry.')
      return
    }
    setSaving(true)

    const updates: Partial<Client> = {
      company_name: companyName.trim(),
      contact_name: contactName.trim() || null,
    }
    if (canEditAll) {
      updates.shared_folder_link = sharedFolderLink.trim() || null
      updates.industry_id = industryId || null
      updates.kpis = kpis
    }
    if (emailEditable) {
      updates.email = email.trim().toLowerCase()
    }

    const { data, error } = await supabase
      .from('clients')
      .update(updates)
      .eq('id', client.id)
      .select()
      .single()

    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    setClient(data as Client)
    seedDraft(data as Client)
    setSavedAt(Date.now())
  }

  if (loadError) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
        Couldn't load: {loadError}
      </div>
    )
  }
  if (!client) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500">
        Loading…
      </div>
    )
  }

  const groups = toggleableByCategory()

  return (
    <section className="space-y-4">
      {/* ===== Header row + top Save/Cancel ===== */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Company Settings</h1>
          {!coachView && (
            <p className="text-xs text-gray-500 mt-0.5">
              You can update your company details below. Your coach manages the
              rest.
            </p>
          )}
        </div>
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
          {saveError}
        </div>
      )}

      {/* ===== Row 1: Company Info + Active KPIs ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Company Info">
          <DarkField
            label="Company Name *"
            value={companyName}
            onChange={setCompanyName}
            required
          />
          <DarkField
            label="Contact Name"
            value={contactName}
            onChange={setContactName}
          />
          <DarkField
            label={emailLocked ? 'Email (login)' : 'Email *'}
            type="email"
            value={email}
            onChange={setEmail}
            disabled={!emailEditable}
            hint={
              emailLocked
                ? coachView
                  ? "Locked — this client has activated. Email is the login key and can't be changed here."
                  : 'Your coach manages your login email.'
                : undefined
            }
          />
          <DarkField
            label="Shared Folder Link"
            placeholder="https://drive.google.com/..."
            value={sharedFolderLink}
            onChange={setSharedFolderLink}
            disabled={!canEditAll}
            hint={
              !canEditAll
                ? 'Coach manages this link.'
                : undefined
            }
          />
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
              Industry {canEditAll && '*'}
            </label>
            {canEditAll ? (
              <select
                value={industryId}
                onChange={(e) => onIndustryChange(e.target.value)}
                className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
              >
                <option value="">— Pick one —</option>
                {(industries ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
                <option disabled>──────────</option>
                <option value={CREATE_NEW_INDUSTRY}>
                  + Create new industry…
                </option>
              </select>
            ) : (
              <div className="bg-surface-1 border border-line rounded text-mute text-sm px-3 py-2">
                {industries?.find((i) => i.id === industryId)?.name ?? '—'}
              </div>
            )}
            {canEditAll && (
              <div className="text-[10px] text-mute mt-1">
                Switching industry replaces the KPI toggles on the right.
              </div>
            )}
            {!canEditAll && (
              <div className="text-[10px] text-mute mt-1">
                Coach manages your industry assignment.
              </div>
            )}
          </div>
        </Card>

        <Card title="Active KPIs">
          {!canEditAll && (
            <div className="text-xs text-mute -mt-1 mb-2">
              Coach manages which KPIs your portal tracks.
            </div>
          )}
          <div className="text-[11px] text-mute mb-3 leading-relaxed">
            Revenue, COGS, Gross Profit, and GP Margin are always on.
          </div>

          {canEditAll ? (
            <KpiTogglesGrouped
              groups={groups}
              kpis={kpis}
              onToggle={onKpiToggle}
              feedback={kpiFeedback}
            />
          ) : (
            <KpiTogglesReadOnly groups={groups} kpis={kpis} />
          )}
        </Card>
      </div>

      {/* ===== Row 2: Capacity Groups (stub for Phase 3.4) ===== */}
      <Card title="Capacity & Utilization Tracking">
        <ComingSoon
          phase="Phase 3.4"
          summary="Set up departments or teams, choose how their utilization is tracked (manual %, time slots, labor hours, revenue, headcount), and target a goal — all wired into Doc 04 PC #1–#6."
        />
      </Card>

      {/* ===== Row 3: Custom KPIs ===== */}
      <Card title="Custom KPIs">
        <CustomKpisCard
          client={client}
          coachView={coachView}
          onChange={(c) => setClient(c)}
        />
      </Card>

      {/* ===== Bottom Save/Cancel ===== */}
      <div className="flex justify-end pt-2">
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {coachView && (
        <IndustryQuickAddModal
          open={industryModalOpen}
          coachId={client.coach_id}
          onClose={() => setIndustryModalOpen(false)}
          onCreated={onIndustryCreated}
        />
      )}
    </section>
  )
}

// =============================================================================
// Helpers
// =============================================================================

function SaveBar({
  isDirty,
  saving,
  savedAt,
  onCancel,
  onSave,
}: {
  isDirty: boolean
  saving: boolean
  savedAt: number | null
  onCancel: () => void
  onSave: () => void
}) {
  const showSaved = !isDirty && savedAt !== null
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-xs font-semibold hover:bg-gray-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!isDirty || saving}
        className={`px-4 py-1.5 rounded text-xs font-bold ${
          showSaved
            ? 'bg-good text-black'
            : 'bg-accent text-black hover:brightness-95'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {saving ? 'Saving…' : showSaved ? 'Saved ✓' : 'Save Settings'}
      </button>
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-ink border border-line rounded-lg p-5">
      <h2 className="text-white text-sm font-bold mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function DarkField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  required,
  hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  hint?: string
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
        required={required}
        disabled={disabled}
        className={`w-full border border-line rounded text-sm px-3 py-2 focus:outline-none focus:border-accent ${
          disabled ? 'bg-surface-1 text-mute cursor-not-allowed' : 'bg-surface-2 text-white'
        }`}
      />
      {hint && <div className="text-[10px] text-mute mt-1">{hint}</div>}
    </div>
  )
}

function KpiTogglesGrouped({
  groups,
  kpis,
  onToggle,
  feedback,
}: {
  groups: ReturnType<typeof toggleableByCategory>
  kpis: Record<string, number>
  onToggle: (id: string, on: boolean) => void
  feedback: string | null
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.category}>
          <div className="text-[10px] font-bold text-accent uppercase tracking-wider pb-1 mb-2 border-b border-line">
            {g.category}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {g.kpis.map((k) => (
              <Toggle
                key={k.id}
                checked={Number(kpis[k.id]) === 1}
                onChange={(on) => onToggle(k.id, on)}
                label={k.label}
              />
            ))}
          </div>
        </div>
      ))}
      {feedback && (
        <div className="text-[11px] text-accent bg-accent/10 border border-accent/40 rounded px-3 py-2">
          {feedback}
        </div>
      )}
    </div>
  )
}

function KpiTogglesReadOnly({
  groups,
  kpis,
}: {
  groups: ReturnType<typeof toggleableByCategory>
  kpis: Record<string, number>
}) {
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const active = g.kpis.filter((k) => Number(kpis[k.id]) === 1)
        if (active.length === 0) return null
        return (
          <div key={g.category}>
            <div className="text-[10px] font-bold text-accent uppercase tracking-wider pb-1 mb-2 border-b border-line">
              {g.category}
            </div>
            <ul className="text-xs text-white space-y-1">
              {active.map((k) => (
                <li key={k.id} className="flex items-center gap-2">
                  <span className="text-good">✓</span> {k.label}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function ComingSoon({
  phase,
  summary,
}: {
  phase: string
  summary: string
}) {
  return (
    <div className="bg-surface-2 border border-line rounded p-4 text-mute text-xs leading-relaxed">
      <div className="text-accent font-bold uppercase tracking-wider text-[10px] mb-1">
        {phase}
      </div>
      {summary}
    </div>
  )
}
