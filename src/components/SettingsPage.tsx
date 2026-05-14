import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { KPIS, emptyKpiDefaults, toggleableByCategory } from '../lib/kpis'
import { InfoIcon } from './InfoIcon'
import { useKpiToggle } from '../lib/useKpiToggle'
import type {
  CapacityGroup,
  Client,
  CustomKpi,
  Industry,
} from '../lib/types'
import { Toggle } from './Toggle'
import { useDirtyGuard } from '../lib/dirtyGuard'
import { formatPhone } from '../lib/phone'
import { IndustryQuickAddModal } from './IndustryQuickAddModal'
import {
  CustomKpisListSection,
  CustomKpiManageCard,
  newCustomKpi,
} from './CustomKpisCard'
import { SaveBar } from './SaveBar'
import { Card } from './Card'
import { CapacityGroupsCard } from './CapacityGroupsCard'
import { ChangePasswordForm } from './ChangePasswordForm'
import { DarkField } from './DarkField'

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
  const [phone, setPhone] = useState('')
  const [sharedFolderLink, setSharedFolderLink] = useState('')
  const [industryId, setIndustryId] = useState<string>('')
  const [kpis, setKpis] = useState<Record<string, number>>(emptyKpiDefaults())
  const [tracksYtd, setTracksYtd] = useState(true)
  const [weeklyReminder, setWeeklyReminder] = useState(true)
  // Capacity groups (Body Team, Estimator Team, etc.) — definition lives
  // on the client record. Gated on the `capacityUtilization` toggle in the
  // Active KPIs list; when off, the section is hidden but the data stays.
  const [capacityGroups, setCapacityGroups] = useState<CapacityGroup[]>([])
  // Custom KPIs — edited inline (each panel patches local state) and
  // committed via the page-level Save bar. Mirrors capacityGroups.
  const [customKpis, setCustomKpis] = useState<CustomKpi[]>([])

  // ---- Save state --------------------------------------------------------
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [industryModalOpen, setIndustryModalOpen] = useState(false)

  const seedDraft = (c: Client) => {
    setCompanyName(c.company_name)
    setContactName(c.contact_name ?? '')
    setEmail(c.email ?? '')
    setPhone(formatPhone(c.phone ?? ''))
    setSharedFolderLink(c.shared_folder_link ?? '')
    setIndustryId(c.industry_id ?? '')
    setKpis({ ...emptyKpiDefaults(), ...(c.kpis ?? {}) })
    setTracksYtd(c.tracks_ytd_actuals ?? true)
    setWeeklyReminder(c.weekly_reminder_enabled ?? true)
    setCapacityGroups(c.capacity_groups ?? [])
    setCustomKpis(c.custom_kpis ?? [])
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
      setSavedAt(null)
      setSaveError(null)
      setIndustries((indRes.data ?? []) as Industry[])
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  // ---- Editability rules per Doc 04 PC #7 --------------------------------
  // Client view: only Company Name + Contact Name are editable. Everything
  // else (email, phone, shared folder, industry, KPI toggles, custom KPIs,
  // YTD-actuals toggle) is read-only.
  // Coach view: everything is editable.
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
      phone !== (client.phone ?? '') ||
      sharedFolderLink !== (client.shared_folder_link ?? '') ||
      industryId !== (client.industry_id ?? '') ||
      JSON.stringify(kpis) !==
        JSON.stringify({ ...emptyKpiDefaults(), ...(client.kpis ?? {}) }) ||
      tracksYtd !== (client.tracks_ytd_actuals ?? true) ||
      weeklyReminder !== (client.weekly_reminder_enabled ?? true) ||
      JSON.stringify(capacityGroups) !==
        JSON.stringify(client.capacity_groups ?? []) ||
      JSON.stringify(customKpis) !==
        JSON.stringify(client.custom_kpis ?? []) ||
      false
    )
  }, [
    client,
    companyName,
    contactName,
    email,
    phone,
    sharedFolderLink,
    industryId,
    kpis,
    tracksYtd,
    weeklyReminder,
    capacityGroups,
    customKpis,
  ])

  // Register dirty state with the app-wide leave guard so top-bar tab
  // clicks / Back / Logout prompt the user before discarding changes.
  const setGuardDirty = useDirtyGuard(isDirty)

  // Saved-banner clears only when the form becomes dirty again. Green
  // "Saved ✓" persists between edits so the user has lasting feedback
  // that their changes committed.
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

  // ---- Custom KPI local-state mutations (saved with the rest via Save bar)
  const addCustomKpi = () => {
    setCustomKpis((prev) => [...prev, newCustomKpi()])
  }

  const updateCustomKpi = (id: string, patch: Partial<CustomKpi>) => {
    setCustomKpis((prev) =>
      prev.map((k) => (k.id === id ? { ...k, ...patch } : k))
    )
  }

  const removeCustomKpi = (id: string) => {
    const k = customKpis.find((x) => x.id === id)
    if (!k) return
    // Only confirm when the KPI has saved data. New unsaved entries (no
    // name yet) drop silently.
    if (k.name.trim().length > 0) {
      if (
        !confirm(
          `Delete "${k.name}"? Save Settings to commit. This custom indicator has no historical data yet, but if you re-add it later, it'll be a new indicator — old values won't return.`
        )
      ) {
        return
      }
    }
    setCustomKpis((prev) => prev.filter((x) => x.id !== id))
  }

  const toggleCustomKpiActive = (id: string, active: boolean) => {
    setCustomKpis((prev) =>
      prev.map((k) => (k.id === id ? { ...k, active } : k))
    )
  }

  // Cancel = exit Settings. If the form is dirty, confirm before leaving.
  // Always enabled regardless of dirty state.
  const onCancel = () => {
    if (isDirty && !confirm('You have unsaved changes. Leave without saving? Click OK to continue or Cancel to stay.')) {
      return
    }
    if (client) {
      seedDraft(client)
      setSavedAt(null)
      setSaveError(null)
    }
    // Cancel already confirmed the discard via its own prompt; clear the
    // central guard synchronously so onLeave doesn't double-prompt.
    setGuardDirty(false)
    onLeave()
  }

  const onSave = async () => {
    if (!client || saving) return
    if (!isDirty) {
      // Nothing to save — flash the green confirmation anyway so the
      // click feels acknowledged.
      setSavedAt(Date.now())
      return
    }
    setSaveError(null)
    if (!companyName.trim()) {
      setSaveError('Company name is required.')
      return
    }
    if (canEditAll && !industryId) {
      setSaveError('Pick an industry.')
      return
    }
    if (canEditAll) {
      const invalid = customKpis.find(
        (k) => !k.name.trim() || !k.category || !k.format
      )
      if (invalid) {
        setSaveError(
          `Custom KPI "${invalid.name.trim() || '(unnamed)'}" is missing name, category, or format.`
        )
        return
      }
    }
    setSaving(true)

    const updates: Partial<Client> = {
      company_name: companyName.trim(),
      contact_name: contactName.trim() || null,
      phone: phone.trim() || null,
      weekly_reminder_enabled: weeklyReminder,
    }
    if (canEditAll) {
      updates.shared_folder_link = sharedFolderLink.trim() || null
      updates.industry_id = industryId || null
      updates.kpis = kpis
      updates.tracks_ytd_actuals = tracksYtd
      updates.capacity_groups = capacityGroups
      updates.custom_kpis = customKpis.map((k) => ({
        ...k,
        name: k.name.trim(),
      }))
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
    setSaveError(null)
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
      {/* ===== Header row + sticky Save/Cancel ===== */}
      <div className="sticky top-[48px] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-6 sm:-mt-8 flex flex-wrap justify-between items-center gap-3">
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

      {/* ===== Two-column layout. Each column stacks its cards
          independently (space-y-4) so when a top card collapses, the
          lower card moves up — no shared row-height with the other
          column. Left col: Company Info + Utilization. Right col:
          Active KPIs + Custom KPIs (coach) / Change Password (client). ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
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
          />
          <DarkField
            label="Phone"
            type="tel"
            value={phone}
            onChange={(v) => setPhone(formatPhone(v))}
            placeholder="(555)555-1212"
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
                className="select-yellow w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
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
          </div>

          <div className="pt-4 space-y-2">
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 border-b border-line">
              Notifications
            </div>
            <Toggle
              label="Weekly entry reminder email"
              checked={weeklyReminder}
              onChange={setWeeklyReminder}
            />
          </div>
        </Card>

          {Number(kpis.capacityUtilization) === 1 && (
            <CapacityGroupsCard
              groups={capacityGroups}
              onChange={setCapacityGroups}
              coachView={canEditAll}
            />
          )}
        </div>

        <div className="space-y-4">
        <Card title="Active KPIs">
          {canEditAll ? (
            <div className="space-y-3">
              <FinancialsSection
                tracksYtd={tracksYtd}
                onTracksYtdChange={setTracksYtd}
                kpis={kpis}
                onToggle={onKpiToggle}
              />
              <KpiTogglesGrouped
                groups={groups}
                kpis={kpis}
                onToggle={onKpiToggle}
                feedback={kpiFeedback}
              />
              <CustomKpisListSection
                customKpis={customKpis}
                onToggleActive={toggleCustomKpiActive}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <FinancialsReadOnly kpis={kpis} />
              <KpiTogglesReadOnly groups={groups} kpis={kpis} />
              <CustomKpisListSection
                customKpis={customKpis.filter((k) => k.active !== false)}
                readOnly
              />
            </div>
          )}
        </Card>
        {canEditAll && (
          <Card title="Custom KPIs">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={addCustomKpi}
                className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95 whitespace-nowrap"
              >
                + Add Custom KPI
              </button>
            </div>
            {customKpis.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
                {customKpis.map((k) => (
                  <CustomKpiManageCard
                    key={k.id}
                    customKpi={k}
                    onChange={(patch) => updateCustomKpi(k.id, patch)}
                    onRemove={() => removeCustomKpi(k.id)}
                  />
                ))}
              </div>
            )}
          </Card>
        )}
        {!coachView && (
          <Card title="Change Password">
            <ChangePasswordForm email={client.email ?? ''} />
          </Card>
        )}
        </div>
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
              className="bg-accent text-black font-bold px-3 py-2 rounded text-xs hover:brightness-95 whitespace-nowrap"
              title="Open the link in a new tab to verify it"
            >
              Open ↗
            </a>
          )}
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

/** Financials section in Settings → Active KPIs. Mixes always-on items
 *  (Income / COGS / Gross Profit / GP Margin) with the per-client YTD
 *  Actuals toggle and any toggleable Financials KPIs (Accounts
 *  Receivable). Rendered in the same two-column grid as the toggleable
 *  categories below it. */
function FinancialsSection({
  tracksYtd,
  onTracksYtdChange,
  kpis,
  onToggle,
}: {
  tracksYtd: boolean
  onTracksYtdChange: (v: boolean) => void
  kpis: Record<string, number>
  onToggle: (id: string, on: boolean) => void
}) {
  const toggleableFinancials = KPIS.filter(
    (k) => k.category === 'Financials' && !k.always && !k.hideTile
  )
  return (
    <div>
      <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
        Financials
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        <AlwaysOnItem label="Income" tooltip={kpiDesc('revenue')} />
        <AlwaysOnItem label="COGS" tooltip={kpiDesc('cogs')} />
        <AlwaysOnItem label="Gross Profit" tooltip={kpiDesc('grossProfit')} />
        <AlwaysOnItem label="Gross Profit Margin" tooltip={kpiDesc('grossMargin')} />
        <Toggle
          checked={tracksYtd}
          onChange={onTracksYtdChange}
          label="YTD Actuals (year 1 only)"
        />
        {toggleableFinancials.map((k) => (
          <div key={k.id} className="flex items-center gap-1.5">
            <Toggle
              checked={Number(kpis[k.id]) === 1}
              onChange={(on) => onToggle(k.id, on)}
              label={k.label}
            />
            {k.desc && <InfoIcon text={k.desc} />}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Visual sibling of the Toggle component for items that can't be turned off.
 *  The 28px-wide checkmark slot mirrors the Toggle pill so labels align in
 *  the same column. */
function AlwaysOnItem({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex justify-center w-7 text-accent text-xs font-bold">
        ✓
      </span>
      <span className="text-white text-xs">{label}</span>
      {tooltip && <InfoIcon text={tooltip} />}
    </div>
  )
}

/** Look up a KPI description by id from the registry. */
function kpiDesc(id: string): string | undefined {
  return KPIS.find((k) => k.id === id)?.desc
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
              <div key={k.id} className="flex items-center gap-1.5">
                <Toggle
                  checked={Number(kpis[k.id]) === 1}
                  onChange={(on) => onToggle(k.id, on)}
                  label={k.label}
                />
                {k.desc && <InfoIcon text={k.desc} />}
              </div>
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

/** Read-only Financials section for the client view. Lists the always-on
 *  items (Income / COGS / Gross Profit / GP Margin) and any toggleable
 *  Financials KPIs (Accounts Receivable) the coach has enabled. */
function FinancialsReadOnly({ kpis }: { kpis: Record<string, number> }) {
  const enabledToggleable = KPIS.filter(
    (k) =>
      k.category === 'Financials' &&
      !k.always &&
      !k.hideTile &&
      Number(kpis[k.id]) === 1
  )
  return (
    <div>
      <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
        Financials
      </div>
      <ul className="text-xs text-white space-y-1">
        <ReadOnlyItem label="Income" tooltip={kpiDesc('revenue')} />
        <ReadOnlyItem label="COGS" tooltip={kpiDesc('cogs')} />
        <ReadOnlyItem label="Gross Profit" tooltip={kpiDesc('grossProfit')} />
        <ReadOnlyItem
          label="Gross Profit Margin"
          tooltip={kpiDesc('grossMargin')}
        />
        {enabledToggleable.map((k) => (
          <ReadOnlyItem key={k.id} label={k.label} tooltip={k.desc} />
        ))}
      </ul>
    </div>
  )
}

function ReadOnlyItem({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-accent font-bold">✓</span>
      <span>{label}</span>
      {tooltip && <InfoIcon text={tooltip} />}
    </li>
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
                  <span className="text-accent font-bold">✓</span>
                  <span>{k.label}</span>
                  {k.desc && <InfoIcon text={k.desc} />}
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

