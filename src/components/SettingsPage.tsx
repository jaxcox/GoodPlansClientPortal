import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emptyKpiDefaults, toggleableByCategory } from '../lib/kpis'
import { useKpiToggle } from '../lib/useKpiToggle'
import type { Client, Industry } from '../lib/types'
import { Toggle } from './Toggle'
import { IndustryQuickAddModal } from './IndustryQuickAddModal'
import { CustomKpisCard } from './CustomKpisCard'
import { CapacityGroupsCard } from './CapacityGroupsCard'
import type { CapacityGroup } from '../lib/types'

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
  const [capacityGroups, setCapacityGroups] = useState<CapacityGroup[]>([])

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
    setCapacityGroups(c.capacity_groups ?? [])
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
        JSON.stringify({ ...emptyKpiDefaults(), ...(client.kpis ?? {}) }) ||
      JSON.stringify(capacityGroups) !==
        JSON.stringify(client.capacity_groups ?? [])
    )
  }, [
    client,
    companyName,
    contactName,
    email,
    sharedFolderLink,
    industryId,
    kpis,
    capacityGroups,
  ])

  // Saved-banner clears the moment the form is changed again, and also
  // auto-expires after a few seconds so the default state on screen is
  // always the yellow "Save Settings" button — the green confirmation is
  // a transient post-save flash, not the resting state.
  useEffect(() => {
    if (savedAt && isDirty) setSavedAt(null)
  }, [savedAt, isDirty])
  useEffect(() => {
    if (savedAt === null) return
    const t = setTimeout(() => setSavedAt(null), 3000)
    return () => clearTimeout(t)
  }, [savedAt])

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
    if (!isDirty) return // No-op when there's nothing to save
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
      updates.capacity_groups = capacityGroups
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
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-black">
        Couldn't load: {loadError}
      </div>
    )
  }
  if (!client) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-black">
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
              emailLocked && coachView
                ? "Locked — this client has activated. Email is the login key and can't be changed here."
                : undefined
            }
          />
          <SharedFolderRow
            value={sharedFolderLink}
            onChange={setSharedFolderLink}
            canEdit={canEditAll}
          />
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
              Industry {canEditAll && '*'}
            </label>
            {canEditAll ? (
              <select
                value={industryId}
                onChange={(e) => onIndustryChange(e.target.value)}
                className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
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
              <div className="bg-surface-1 border border-line rounded text-white text-sm px-3 py-2">
                {industries?.find((i) => i.id === industryId)?.name ?? '—'}
              </div>
            )}
            {canEditAll && (
              <div className="text-xs text-white mt-1">
                Switching industry replaces the indicator toggles on the right.
              </div>
            )}
          </div>
        </Card>

        <Card title="Active Key Performance Indicators">
          <div className="text-xs text-white mb-3 leading-relaxed">
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

      {/* ===== Row 2: Capacity Groups ===== */}
      <Card title="Capacity & Utilization Tracking">
        <CapacityGroupsCard
          groups={capacityGroups}
          onChange={setCapacityGroups}
          coachView={canEditAll}
        />
      </Card>

      {/* ===== Row 3: Custom KPIs ===== */}
      <Card title="Custom Key Performance Indicators">
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
  // Default state is yellow "Save Settings" — even when the form is clean —
  // so the screen never looks "done" the moment you arrive. Green "Saved ✓"
  // is a transient confirmation that fades back to yellow after a few seconds.
  const showSaved = !isDirty && savedAt !== null
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="bg-white text-black border border-gray-300 px-4 py-1.5 rounded text-xs font-semibold hover:bg-gray-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={`px-4 py-1.5 rounded text-xs font-bold ${
          showSaved
            ? 'bg-good text-black hover:brightness-95'
            : 'bg-accent text-black hover:brightness-95'
        } disabled:opacity-60 disabled:cursor-wait`}
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

function SharedFolderRow({
  value,
  onChange,
  canEdit,
}: {
  value: string
  onChange: (v: string) => void
  canEdit: boolean
}) {
  const trimmed = value.trim()
  const isLikelyUrl = /^https?:\/\//i.test(trimmed)
  if (canEdit) {
    return (
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
          Shared Folder Link
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="flex-1 bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
          {isLikelyUrl && (
            <a
              href={trimmed}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-transparent text-white border border-mute px-3 py-2 rounded text-xs font-semibold hover:bg-white/10 whitespace-nowrap"
              title="Open the link in a new tab to verify it"
            >
              Open ↗
            </a>
          )}
        </div>
        <div className="text-xs text-white mt-1">
          Clients see this as a "Shared Folder" button — they don't see the URL.
        </div>
      </div>
    )
  }
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        Shared Folder
      </label>
      {isLikelyUrl ? (
        <a
          href={trimmed}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-accent text-black font-bold px-4 py-2 rounded text-sm hover:brightness-95"
        >
          Open Shared Folder ↗
        </a>
      ) : (
        <div className="bg-surface-1 border border-line rounded text-white text-sm px-3 py-2">
          No shared folder added yet.
        </div>
      )}
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
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
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
          <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
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
        <div className="text-xs text-white bg-accent/10 border border-accent/40 rounded px-3 py-2">
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
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
              {g.category}
            </div>
            <ul className="text-xs text-white space-y-1">
              {active.map((k) => (
                <li key={k.id} className="flex items-center gap-2">
                  <span className="text-white">✓</span> {k.label}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

