import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  KPIS,
  emptyKpiDefaults,
  isPrimaryKpi,
  toggleableByCategory,
} from '../lib/kpis'
import { InfoIcon } from './InfoIcon'
import { useKpiToggle } from '../lib/useKpiToggle'
import type {
  Budget,
  CapacityGroup,
  Client,
  CustomKpi,
  Industry,
} from '../lib/types'
import {
  computeBudgetView,
  emptyMonthArray,
  type BudgetView,
} from '../lib/budget'
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
import { YtdActualsCard } from './YtdActualsCard'

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

  // ---- YTD Actuals state -------------------------------------------------
  // YTD actuals live on the budgets row, not the clients row. Settings is
  // where the coach enters them (was on Budget & Goals; moved here on
  // 2026-05-22 so B&G stays focused on targets + monthly goals). The
  // client view is read-only.
  const [budget, setBudget] = useState<Budget | null>(null)
  const [ytdThruMonth, setYtdThruMonth] = useState<number | null>(null)
  const [ytdRevenueByMonth, setYtdRevenueByMonth] = useState<
    (number | null)[]
  >(emptyMonthArray())
  const [ytdCogsByMonth, setYtdCogsByMonth] = useState<(number | null)[]>(
    emptyMonthArray()
  )
  const [ytdExpensesByMonth, setYtdExpensesByMonth] = useState<
    (number | null)[]
  >(emptyMonthArray())

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

  const seedYtdFromBudget = (b: Budget | null) => {
    setYtdThruMonth(b?.ytd_thru_month ?? null)
    setYtdRevenueByMonth(
      (b?.ytd_revenue_by_month as (number | null)[] | null) ??
        emptyMonthArray()
    )
    setYtdCogsByMonth(
      (b?.ytd_cogs_by_month as (number | null)[] | null) ??
        emptyMonthArray()
    )
    setYtdExpensesByMonth(
      (b?.ytd_expenses_by_month as (number | null)[] | null) ??
        emptyMonthArray()
    )
  }

  const ytdYear = useMemo(() => new Date().getFullYear(), [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [clientRes, indRes, budgetRes] = await Promise.all([
        supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
        supabase.from('industries').select('*').order('name'),
        supabase
          .from('budgets')
          .select('*')
          .eq('client_id', clientId)
          .eq('year', ytdYear)
          .maybeSingle(),
      ])
      if (cancelled) return
      if (clientRes.error || !clientRes.data) {
        setLoadError(clientRes.error?.message ?? 'Client not found')
        return
      }
      setClient(clientRes.data as Client)
      seedDraft(clientRes.data as Client)
      const b = (budgetRes.data as Budget | null) ?? null
      setBudget(b)
      seedYtdFromBudget(b)
      setSavedAt(null)
      setSaveError(null)
      setIndustries((indRes.data ?? []) as Industry[])
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, ytdYear])

  // ---- Editability rules per Doc 04 PC #7 --------------------------------
  // Client view: only Company Name + Contact Name are editable. Everything
  // else (email, phone, shared folder, industry, KPI toggles, custom KPIs,
  // YTD-actuals toggle) is read-only.
  // Coach view: everything is editable.
  const canEditAll = coachView
  const emailEditable = coachView && !client?.activated
  const emailLocked = !coachView || (coachView && Boolean(client?.activated))

  // ---- Budget engine view ------------------------------------------------
  // Recomputes live as the coach types YTD numbers so the "Behind Budget /
  // On Track" status lines under Income / GP stay current. null when no
  // budget exists yet (first-time setup).
  const budgetView: BudgetView | null = useMemo(() => {
    if (!budget) return null
    const cogsPct =
      budget.cogs_target_pct != null ? Number(budget.cogs_target_pct) : null
    const gpPct = cogsPct != null ? 100 - cogsPct : null
    return computeBudgetView({
      annualRevenue:
        budget.annual_revenue != null ? Number(budget.annual_revenue) : null,
      grossProfitPct: gpPct,
      annualExpenses:
        budget.annual_expenses != null ? Number(budget.annual_expenses) : null,
      seasonType: budget.season_type,
      seasonPct: budget.season_pct ?? [],
      ytdThruMonth,
      ytdRevenueByMonth,
      ytdCogsByMonth,
      ytdExpensesByMonth,
    })
  }, [
    budget,
    ytdThruMonth,
    ytdRevenueByMonth,
    ytdCogsByMonth,
    ytdExpensesByMonth,
  ])

  const hasYtdActuals =
    ytdThruMonth !== null &&
    (ytdRevenueByMonth.some((v) => Number(v) > 0) ||
      ytdCogsByMonth.some((v) => Number(v) > 0) ||
      ytdExpensesByMonth.some((v) => Number(v) > 0))

  // ---- Dirty tracking ----------------------------------------------------
  const ytdDirty = useMemo(() => {
    const savedRev =
      (budget?.ytd_revenue_by_month as (number | null)[] | null) ??
      emptyMonthArray()
    const savedCogs =
      (budget?.ytd_cogs_by_month as (number | null)[] | null) ??
      emptyMonthArray()
    const savedExp =
      (budget?.ytd_expenses_by_month as (number | null)[] | null) ??
      emptyMonthArray()
    return (
      ytdThruMonth !== (budget?.ytd_thru_month ?? null) ||
      JSON.stringify(ytdRevenueByMonth) !== JSON.stringify(savedRev) ||
      JSON.stringify(ytdCogsByMonth) !== JSON.stringify(savedCogs) ||
      JSON.stringify(ytdExpensesByMonth) !== JSON.stringify(savedExp)
    )
  }, [
    budget,
    ytdThruMonth,
    ytdRevenueByMonth,
    ytdCogsByMonth,
    ytdExpensesByMonth,
  ])

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
      ytdDirty
    )
  }, [
    client,
    ytdDirty,
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
      seedYtdFromBudget(budget)
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
      // Clients can edit their own Utilization groups now, so include
      // capacity_groups on both code paths — otherwise their edits get
      // silently dropped.
      capacity_groups: capacityGroups,
    }
    if (canEditAll) {
      updates.shared_folder_link = sharedFolderLink.trim() || null
      updates.industry_id = industryId || null
      updates.kpis = kpis
      updates.tracks_ytd_actuals = tracksYtd
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

    if (error) {
      setSaving(false)
      setSaveError(error.message)
      return
    }

    // YTD actuals write to the budgets row — coach-only, and only when
    // the YTD section is dirty. Upserts so a coach setting up YTD before
    // creating a real budget gets the row created with just YTD fields
    // (B&G fills in annual targets later).
    if (canEditAll && ytdDirty) {
      // YTD overlap notification — if this save sets or extends
      // ytd_thru_month to cover weeks that already have weekly_entries
      // rows, cumulative dashboards may double-count. Surface before
      // committing so the coach can bail.
      if (ytdThruMonth != null) {
        const monthEndIso = (() => {
          const d = new Date(ytdYear, ytdThruMonth + 1, 0)
          const m = String(d.getMonth() + 1).padStart(2, '0')
          const day = String(d.getDate()).padStart(2, '0')
          return `${d.getFullYear()}-${m}-${day}`
        })()
        const yearStartIso = `${ytdYear}-01-01`
        const { data: overlapping } = await supabase
          .from('weekly_entries')
          .select('week_start_date')
          .eq('client_id', client.id)
          .gte('week_start_date', yearStartIso)
          .lte('week_start_date', monthEndIso)
        const overlapCount = overlapping?.length ?? 0
        if (overlapCount > 0) {
          const monthName = new Date(
            ytdYear,
            ytdThruMonth,
            1
          ).toLocaleDateString('en-US', { month: 'long' })
          if (
            !confirm(
              `Heads up — ${overlapCount} weekly entr${overlapCount === 1 ? 'y' : 'ies'} fall within the YTD Actuals window (Jan–${monthName}). The cumulative dashboard may double-count income. Save anyway?`
            )
          ) {
            setSaving(false)
            return
          }
        }
      }

      const ytdPayload = {
        client_id: client.id,
        coach_id: client.coach_id,
        year: ytdYear,
        ytd_thru_month: ytdThruMonth,
        ytd_revenue_by_month:
          ytdThruMonth === null ? null : ytdRevenueByMonth,
        ytd_cogs_by_month: ytdThruMonth === null ? null : ytdCogsByMonth,
        ytd_expenses_by_month:
          ytdThruMonth === null ? null : ytdExpensesByMonth,
      }
      const ytdOp = budget
        ? supabase.from('budgets').update(ytdPayload).eq('id', budget.id)
        : supabase.from('budgets').insert(ytdPayload)
      const { data: bRow, error: bErr } = await ytdOp.select().single()
      if (bErr) {
        setSaving(false)
        setSaveError(bErr.message)
        return
      }
      setBudget(bRow as Budget)
      seedYtdFromBudget(bRow as Budget)
    }

    setSaving(false)
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

          {coachView && Number(kpis.capacityUtilization) === 1 && (
            <CapacityGroupsCard
              groups={capacityGroups}
              onChange={setCapacityGroups}
            />
          )}
          {!coachView && (
            <Card title="Change Password">
              <ChangePasswordForm email={client.email ?? ''} />
            </Card>
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
          <div className="text-xs text-white italic mt-4 pt-3 border-t border-line">
            <PrimaryStar /> marks primary Key Performance Indicators.
          </div>
        </Card>
        {canEditAll && (
          <Card title="Custom KPIs" fit>
            <div className="flex justify-start">
              <button
                type="button"
                onClick={addCustomKpi}
                className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95 whitespace-nowrap"
              >
                + Add Custom KPI
              </button>
            </div>
            {customKpis.length > 0 && (
              <div
                className={`grid gap-3 items-start ${
                  customKpis.length === 1
                    ? 'grid-cols-1'
                    : 'grid-cols-1 md:grid-cols-2'
                }`}
              >
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
        {!coachView && Number(kpis.capacityUtilization) === 1 && (
          <CapacityGroupsCard
            groups={capacityGroups}
            onChange={setCapacityGroups}
            coachView
          />
        )}
        {tracksYtd && (
          <YtdActualsCard
            ytdThruMonth={ytdThruMonth}
            setYtdThruMonth={setYtdThruMonth}
            revenueByMonth={ytdRevenueByMonth}
            setRevenueByMonth={setYtdRevenueByMonth}
            cogsByMonth={ytdCogsByMonth}
            setCogsByMonth={setYtdCogsByMonth}
            expensesByMonth={ytdExpensesByMonth}
            setExpensesByMonth={setYtdExpensesByMonth}
            seasonType={budget?.season_type ?? 'even'}
            seasonPct={budget?.season_pct ?? []}
            view={budgetView}
            hasYtdActuals={hasYtdActuals}
            readOnly={!coachView}
          />
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
        <AlwaysOnItem
          label="Income"
          tooltip={kpiDesc('revenue')}
          primary={isPrimaryKpi('revenue')}
        />
        <AlwaysOnItem label="COGS" tooltip={kpiDesc('cogs')} />
        <AlwaysOnItem
          label="Gross Profit"
          tooltip={kpiDesc('grossProfit')}
          primary={isPrimaryKpi('grossProfit')}
        />
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
            {isPrimaryKpi(k.id) && <PrimaryStar />}
            {k.desc && <InfoIcon text={k.desc} />}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Visual sibling of the Toggle component for items that can't be turned off.
 *  The 28px-wide checkmark slot mirrors the Toggle pill so labels align in
 *  the same column. Optional primary flag adds a star so the coach can
 *  see which always-on KPIs the dashboard features (Income, GP). */
function AlwaysOnItem({
  label,
  tooltip,
  primary = false,
}: {
  label: string
  tooltip?: string
  primary?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex justify-center w-7 text-accent text-sm font-bold">
        ✓
      </span>
      <span className="text-white text-sm">{label}</span>
      {primary && <PrimaryStar />}
      {tooltip && <InfoIcon text={tooltip} />}
    </div>
  )
}

/** Small yellow ★ used to flag KPIs that render as primary tiles on the
 *  Performance Dashboard. Set tracking lives in lib/kpis.ts so both this
 *  surface and the dashboard pull from the same list. */
function PrimaryStar() {
  return (
    <span
      aria-label="Primary Key Performance Indicator"
      title="Primary Key Performance Indicator"
      className="text-accent text-sm leading-none"
    >
      ★
    </span>
  )
}

/** Look up a KPI description by id from the registry. */
function kpiDesc(id: string): string | undefined {
  return KPIS.find((k) => k.id === id)?.desc
}

/** Sales left column: estimating workflow on top, then transactions
 *  family beneath it with a small gap. The right column gets
 *  everything else (Contracts workflow, Close Rate, Pipeline family).
 *  IDs match the registry; registry order drives the vertical sequence
 *  inside each group. */
const SALES_ESTIMATING_IDS = new Set<string>([
  'proposalsDollars',
  'estimatesWritten',
  'avgEstimateValue',
  'estimatesWonDollars',
  'estimatesWonCount',
  'avgEstimateWon',
])
const SALES_LEFT_BOTTOM_IDS = new Set<string>([
  'transactions',
  'avgTransactionValue',
])

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
  const renderToggle = (k: {
    id: string
    label: string
    desc?: string
  }) => (
    <div key={k.id} className="flex items-center gap-1.5">
      <Toggle
        checked={Number(kpis[k.id]) === 1}
        onChange={(on) => onToggle(k.id, on)}
        label={k.label}
      />
      {isPrimaryKpi(k.id) && <PrimaryStar />}
      {k.desc && <InfoIcon text={k.desc} />}
    </div>
  )

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        if (g.category === 'Sales') {
          const estimating = g.kpis.filter((k) =>
            SALES_ESTIMATING_IDS.has(k.id)
          )
          const leftBottom = g.kpis.filter((k) =>
            SALES_LEFT_BOTTOM_IDS.has(k.id)
          )
          // Right column = everything not in the left column
          // (Contracts workflow, Close Rate, Pipeline family).
          const rightCol = g.kpis.filter(
            (k) =>
              !SALES_ESTIMATING_IDS.has(k.id) &&
              !SALES_LEFT_BOTTOM_IDS.has(k.id)
          )
          return (
            <div key={g.category}>
              <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
                {g.category}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                <div className="space-y-1.5">
                  {estimating.map(renderToggle)}
                  {/* Small breathing room between estimating workflow
                      and the transactions family below it. */}
                  {estimating.length > 0 && leftBottom.length > 0 && (
                    <div className="h-3" />
                  )}
                  {leftBottom.map(renderToggle)}
                </div>
                <div className="space-y-1.5">{rightCol.map(renderToggle)}</div>
              </div>
            </div>
          )
        }
        return (
          <div key={g.category}>
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
              {g.category}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {g.kpis.map(renderToggle)}
            </div>
          </div>
        )
      })}
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
      <ul className="text-sm text-white space-y-1">
        <ReadOnlyItem
          label="Income"
          tooltip={kpiDesc('revenue')}
          primary={isPrimaryKpi('revenue')}
        />
        <ReadOnlyItem label="COGS" tooltip={kpiDesc('cogs')} />
        <ReadOnlyItem
          label="Gross Profit"
          tooltip={kpiDesc('grossProfit')}
          primary={isPrimaryKpi('grossProfit')}
        />
        <ReadOnlyItem
          label="Gross Profit Margin"
          tooltip={kpiDesc('grossMargin')}
        />
        {enabledToggleable.map((k) => (
          <ReadOnlyItem
            key={k.id}
            label={k.label}
            tooltip={k.desc}
            primary={isPrimaryKpi(k.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function ReadOnlyItem({
  label,
  tooltip,
  primary = false,
}: {
  label: string
  tooltip?: string
  primary?: boolean
}) {
  return (
    <li className="flex items-center gap-2">
      <span className="text-accent font-bold">✓</span>
      <span>{label}</span>
      {primary && <PrimaryStar />}
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
            <ul className="text-sm text-white space-y-1">
              {active.map((k) => (
                <li key={k.id} className="flex items-center gap-2">
                  <span className="text-accent font-bold">✓</span>
                  <span>{k.label}</span>
                  {isPrimaryKpi(k.id) && <PrimaryStar />}
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

