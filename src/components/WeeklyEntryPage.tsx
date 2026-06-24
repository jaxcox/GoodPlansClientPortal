import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  CATEGORIES,
  KPIS,
  type KpiCategory,
  type KpiFormat,
} from '../lib/kpis'
import { groupMaxCapacity } from '../lib/capacity'
import type {
  CapacityGroup,
  Client,
  WeeklyCapacityActual,
  WeeklyEntry,
} from '../lib/types'
import {
  dateFromIso,
  formatWeekShort,
  isoDate,
  missedWeeksBetween,
  monthBoundaryInWeek,
  latestEnterableWeekStart,
  weekStartSunday,
} from '../lib/week'
import type { PartialSlot } from '../lib/week'
import { useDirtyGuard } from '../lib/dirtyGuard'
import { NumberField } from './NumberField'
import { SaveBar } from './SaveBar'
import { Card } from './Card'
import { InfoIcon } from './InfoIcon'
import { MissedWeeksPill, WeekOfCalendarPill } from './HeaderPills'

// =============================================================================
// Phase 5 — Weekly Entry
// One row per (client, week_start_date). Coach + client can both edit.
// Loads the entry for the currently-selected Sunday-start week, or shows a
// blank form if none exists yet (insert on first save).
// =============================================================================

type Props = {
  clientId: string
  onLeave: () => void
  /** When set, the entry form opens to this week instead of the default
   *  (most recent completed week). Used by the dashboard's missed-weeks
   *  dropdown to deep-link a specific gap week. ClientPortal clears this
   *  back to null when the tab changes away from Weekly Entry, so a
   *  subsequent natural visit lands on the default. */
  initialWeekStart?: Date | null
}

type EntryRow = {
  id: string
  label: string
  format: KpiFormat
  /** True when the value is auto-derived from raw inputs (Gross Profit,
   *  Conversion Rate, etc.). Renders as a read-only DerivedKpiBox; value
   *  recomputes live as inputs change. */
  derived: boolean
  /** Optional inline hint shown below the input — e.g. for snapshot KPIs
   *  that are end-of-week values rather than weekly totals. */
  hint?: string
  /** Optional tooltip text for the label's info icon. Standard KPIs only;
   *  custom KPIs don't have descriptions. */
  desc?: string
}

const numberFieldFormat: Record<KpiFormat, 'dollars' | 'percent' | 'count'> = {
  $: 'dollars',
  '%': 'percent',
  '#': 'count',
}

/** KPI ids whose weekly value is auto-derived from raw inputs (or, for
 *  efficiency, from capacity group state). Doc 06 calls for these to
 *  display inline on the entry form as read-only boxes that update live.
 *  All other auto KPIs in the registry fall through to a NumberField
 *  (currently none, but future-proof). */
const DERIVABLE_WEEKLY_IDS = new Set<string>([
  'grossProfit',
  'grossMargin',
  'netProfit',
  'netProfitMargin',
  'conversionRate',
  'avgEstimateValue',
  'avgEstimateWon',
  'avgContractWon',
  'avgPipelineDeal',
  'closeRate',
  'avgTransactionValue',
  'avgRepairOrder',
])

function safeDivide(
  num: number | undefined,
  den: number | undefined
): number | null {
  if (!num || !den) return null
  return num / den
}

/** Pick whichever of contracts/estimates Won $ is the currently-active
 *  won-dollars KPI for this client (mutex pair on the KPI registry).
 *  Ignores the inactive sibling's stored value so stale data doesn't
 *  leak into derived calcs. */
function wonDollarsActual(
  kpiValues: Record<string, number>,
  visible: Set<string>
): number | undefined {
  if (visible.has('contractsWonDollars'))
    return kpiValues['contractsWonDollars']
  if (visible.has('estimatesWonDollars'))
    return kpiValues['estimatesWonDollars']
  return undefined
}

function deriveWeeklyValue(
  kpiId: string,
  kpiValues: Record<string, number>,
  visible: Set<string>
): number | null {
  const v = (id: string) => kpiValues[id]
  switch (kpiId) {
    case 'grossProfit': {
      const rev = v('revenue')
      const cogs = v('cogs')
      if (rev === undefined && cogs === undefined) return null
      return (rev ?? 0) - (cogs ?? 0)
    }
    case 'grossMargin': {
      const rev = v('revenue')
      if (!rev) return null
      return ((rev - (v('cogs') ?? 0)) / rev) * 100
    }
    case 'netProfit': {
      const rev = v('revenue')
      const cogs = v('cogs')
      const exp = v('expenses')
      if (rev === undefined && cogs === undefined && exp === undefined)
        return null
      return (rev ?? 0) - (cogs ?? 0) - (exp ?? 0)
    }
    case 'netProfitMargin': {
      const rev = v('revenue')
      if (!rev) return null
      return ((rev - (v('cogs') ?? 0) - (v('expenses') ?? 0)) / rev) * 100
    }
    case 'conversionRate': {
      const r = safeDivide(v('newClients'), v('leads'))
      return r === null ? null : r * 100
    }
    case 'avgEstimateValue':
      return safeDivide(v('proposalsDollars'), v('estimatesWritten'))
    case 'avgEstimateWon':
      return safeDivide(v('estimatesWonDollars'), v('estimatesWonCount'))
    case 'avgContractWon':
      return safeDivide(v('contractsWonDollars'), v('contractsWonCount'))
    case 'avgPipelineDeal':
      return safeDivide(v('pipelineValue'), v('pipelineDeals'))
    case 'closeRate': {
      const r = safeDivide(
        wonDollarsActual(kpiValues, visible),
        v('proposalsDollars')
      )
      return r === null ? null : r * 100
    }
    case 'avgTransactionValue':
      return safeDivide(v('revenue'), v('transactions'))
    case 'avgRepairOrder':
      return safeDivide(v('revenue'), v('jobsCompleted'))
    default:
      return null
  }
}

function formatDerivedWeekly(
  value: number | null,
  format: KpiFormat
): string {
  if (value === null) return '—'
  if (format === '$')
    return `$${Math.round(value).toLocaleString('en-US')}`
  if (format === '%') return `${value.toFixed(1)}%`
  return Math.round(value).toLocaleString('en-US')
}

export function WeeklyEntryPage({ clientId, onLeave, initialWeekStart }: Props) {
  const [client, setClient] = useState<Client | null>(null)
  const [capacityValues, setCapacityValues] = useState<
    Record<string, WeeklyCapacityActual>
  >({})
  /** Saved entries keyed by side. For non-boundary weeks only `a` is
   *  populated (or both null if nothing's saved yet). For boundary
   *  weeks (Sun-Sat spanning two months), both slots load — A is the
   *  Sunday→end-of-month partial, B is the 1st-of-next-month→Saturday
   *  partial. The form's local state mirrors whichever side is
   *  `selectedSide`. */
  const [entries, setEntries] = useState<{
    a: WeeklyEntry | null
    b: WeeklyEntry | null
  }>({ a: null, b: null })
  const [selectedSide, setSelectedSide] = useState<'a' | 'b'>('a')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)
  /** True when this week is marked as "closed for business" — the row
   *  saves with kpi_values / capacity_values cleared to {} and the UI
   *  hides the KPI input cards. The week stays out of the Missed Weeks
   *  dropdown but counts as a zero-revenue week in cumulative math
   *  (per product direction: honest dip vs. unchanged goal). In boundary
   *  mode the flag is per-partial — each side saves its own closed
   *  state since they're independent rows. */
  const [closed, setClosed] = useState(false)
  /** Every saved entry's covered date range — used by the range-aware
   *  missedWeeksBetween so a boundary week with only one partial saved
   *  still shows as missed (the other partial's days aren't covered). */
  const [savedEntryRanges, setSavedEntryRanges] = useState<
    { startIso: string; days: number }[]
  >([])

  // Default to the latest enterable week. On Saturday that's the current
  // week (it just reached its last day, so clients can close it out that
  // day); on Sunday–Friday it's last week. When the caller passed
  // initialWeekStart (deep-link from the dashboard's missed-weeks pill),
  // honor that instead.
  const [weekStart, setWeekStart] = useState<Date>(
    () => initialWeekStart ?? latestEnterableWeekStart()
  )

  // If a deep-link week arrives while this component is already mounted
  // (rare but possible if dashboard → entry happens without an unmount),
  // sync to it. The mount-time initial value above handles the common case.
  useEffect(() => {
    if (initialWeekStart) setWeekStart(initialWeekStart)
  }, [initialWeekStart])
  const [kpiValues, setKpiValues] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')

  /** Boundary detection — null for a normal week, two partial slots
   *  (A = Sunday→end-of-month, B = 1st-of-next-month→Saturday) when
   *  the Sun-Sat week crosses a month. */
  const boundary = useMemo(() => monthBoundaryInWeek(weekStart), [weekStart])
  /** The slot the form is currently editing — start date, day count,
   *  partial flag. Drives load filter, save payload, and the "Saved /
   *  Not entered" status on the side cards. */
  const activeSlot = useMemo(() => {
    if (!boundary) {
      return { startIso: isoDate(weekStart), days: 7, isPartial: false }
    }
    const side = boundary[selectedSide]
    return { startIso: side.startIso, days: side.days, isPartial: true }
  }, [boundary, selectedSide, weekStart])
  /** True when the picked week is the client's STARTING week AND it
   *  straddles a month boundary. Partial A is then the prior (most-
   *  recent-closed) month, which the client never enters — so the
   *  boundary picker hides the A card and the form defaults to Partial B.
   *  Mirrors the starting-week rule in missedWeeksBetween. */
  const startBoundaryHidesA = useMemo(() => {
    if (!boundary || !client) return false
    const startWeek = weekStartSunday(new Date(client.created_at))
    return weekStart.getTime() === startWeek.getTime()
  }, [boundary, client, weekStart])
  /** The saved entry for whichever side is selected. The form's dirty
   *  tracking, cancel-reseed, and save-vs-update branching all key off
   *  this. */
  const activeEntry = entries[selectedSide]

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // ---- Load client + all entry ranges (once per client) -----------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [clientRes, entriesRes] = await Promise.all([
        supabase
          .from('clients_safe')
          .select('*')
          .eq('id', clientId)
          .maybeSingle(),
        supabase
          .from('weekly_entries')
          .select('week_start_date, days')
          .eq('client_id', clientId),
      ])
      if (cancelled) return
      if (clientRes.error || !clientRes.data) {
        setLoadError(clientRes.error?.message ?? 'Client not found')
        return
      }
      setClient(clientRes.data as Client)
      const ranges = (
        (entriesRes.data ?? []) as { week_start_date: string; days: number }[]
      ).map((r) => ({ startIso: r.week_start_date, days: r.days ?? 7 }))
      setSavedEntryRanges(ranges)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  // ---- Load entry (on week change) --------------------------------------
  const seedFromEntry = (e: WeeklyEntry | null) => {
    setKpiValues(e?.kpi_values ?? {})
    setCapacityValues(e?.capacity_values ?? {})
    setNotes(e?.notes ?? '')
    setClosed(e?.closed ?? false)
  }
  useEffect(() => {
    let cancelled = false
    setLoadingEntry(true)
    ;(async () => {
      const b = monthBoundaryInWeek(weekStart)
      if (b) {
        // Boundary week — fetch both partials in parallel so the side
        // cards above the form can show saved/not-entered status for
        // each, and switching sides is a free state swap (no fetch).
        const [resA, resB] = await Promise.all([
          supabase
            .from('weekly_entries')
            .select('*')
            .eq('client_id', clientId)
            .eq('week_start_date', b.a.startIso)
            .maybeSingle(),
          supabase
            .from('weekly_entries')
            .select('*')
            .eq('client_id', clientId)
            .eq('week_start_date', b.b.startIso)
            .maybeSingle(),
        ])
        if (cancelled) return
        setLoadingEntry(false)
        if (resA.error || resB.error) {
          setLoadError(resA.error?.message ?? resB.error?.message ?? 'Load failed')
          return
        }
        const eA = (resA.data as WeeklyEntry | null) ?? null
        const eB = (resB.data as WeeklyEntry | null) ?? null
        setEntries({ a: eA, b: eB })
        setSelectedSide('a')
        seedFromEntry(eA)
      } else {
        const { data, error } = await supabase
          .from('weekly_entries')
          .select('*')
          .eq('client_id', clientId)
          .eq('week_start_date', isoDate(weekStart))
          .maybeSingle()
        if (cancelled) return
        setLoadingEntry(false)
        if (error) {
          setLoadError(error.message)
          return
        }
        const e = (data as WeeklyEntry) ?? null
        setEntries({ a: e, b: null })
        setSelectedSide('a')
        seedFromEntry(e)
      }
      setSavedAt(null)
      setSaveError(null)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, weekStart])

  // When the starting week is a boundary week, Partial A is the closed
  // month and isn't shown. The load effect defaults boundary weeks to
  // side 'a', so flip to side 'b' (and re-seed from it) whenever A is
  // hidden so the form edits the entered partial, not the hidden one.
  useEffect(() => {
    if (startBoundaryHidesA && selectedSide === 'a') {
      setSelectedSide('b')
      seedFromEntry(entries.b)
    }
  }, [startBoundaryHidesA, selectedSide, entries.b])

  // ---- Dirty tracking ----------------------------------------------------
  const isDirty = useMemo(() => {
    const savedKpi = activeEntry?.kpi_values ?? {}
    const savedCap = activeEntry?.capacity_values ?? {}
    if (JSON.stringify(kpiValues) !== JSON.stringify(savedKpi)) return true
    if (JSON.stringify(capacityValues) !== JSON.stringify(savedCap))
      return true
    if (notes !== (activeEntry?.notes ?? '')) return true
    if (closed !== (activeEntry?.closed ?? false)) return true
    return false
  }, [kpiValues, capacityValues, notes, closed, activeEntry])

  // Toggling closed ON wipes KPI / capacity inputs to {} so the save
  // round-trip leaves no stale numbers under the closed row. If the
  // user has data entered we confirm first — otherwise it's a silent
  // flip. Toggling OFF preserves the cleared state; the user re-enters
  // any KPI values they want for the now-open week.
  const onToggleClosed = (next: boolean) => {
    if (next === closed) return
    if (next) {
      const hasValues =
        Object.values(kpiValues).some((v) => v !== 0 && v != null) ||
        Object.keys(capacityValues).length > 0
      if (
        hasValues &&
        !confirm(
          'Marking this week as closed will clear all KPI values. Continue?'
        )
      )
        return
      setKpiValues({})
      setCapacityValues({})
    }
    setClosed(next)
  }

  const setGuardDirty = useDirtyGuard(isDirty)

  // Saved-banner clears only when the form becomes dirty again. Green
  // "Saved ✓" persists between edits.
  useEffect(() => {
    if (savedAt && isDirty) setSavedAt(null)
  }, [savedAt, isDirty])

  // ---- Build the input rows, grouped by category -------------------------
  const groupedRows = useMemo(() => {
    if (!client) return new Map<KpiCategory, EntryRow[]>()
    const grouped = new Map<KpiCategory, EntryRow[]>()
    const push = (cat: KpiCategory, row: EntryRow) => {
      const list = grouped.get(cat) ?? []
      list.push(row)
      grouped.set(cat, list)
    }
    // Standard KPIs: include always-on KPIs AND any toggled-on KPI
    // (input OR auto-derived). Auto KPIs render as read-only derived
    // boxes that recompute as inputs change.
    for (const k of KPIS) {
      if (k.isCapacityFlag) continue // capacity entries handled separately
      if (!k.always && Number(client.kpis[k.id]) !== 1) continue
      push(k.category, {
        id: k.id,
        label: k.label,
        format: k.format,
        derived: DERIVABLE_WEEKLY_IDS.has(k.id),
        hint:
          k.aggregation === 'last' && !DERIVABLE_WEEKLY_IDS.has(k.id)
            ? 'End-of-week snapshot'
            : undefined,
        desc: k.desc,
      })
    }
    // Custom KPIs (never auto-derived)
    for (const c of client.custom_kpis ?? []) {
      if (c.active === false) continue
      push(c.category, {
        id: c.id,
        label: c.name,
        format: c.format,
        derived: false,
      })
    }
    return grouped
  }, [client])

  // Active standard-KPI ids — drives the contracts/estimates Won mutex
  // lookup in deriveWeeklyValue (closeRate).
  const visibleStandardIds = useMemo(() => {
    const s = new Set<string>()
    if (!client) return s
    for (const k of KPIS) {
      if (k.always) s.add(k.id)
      else if (Number(client.kpis[k.id]) === 1) s.add(k.id)
    }
    return s
  }, [client])

  // ---- Handlers ---------------------------------------------------------
  const setKpi = (id: string, n: number | undefined) => {
    setKpiValues((prev) => {
      const next = { ...prev }
      if (n === undefined) delete next[id]
      else next[id] = n
      return next
    })
  }

  const onCancel = () => {
    if (
      isDirty &&
      !confirm('You have unsaved changes. Leave without saving? Click OK to continue or Cancel to stay.')
    )
      return
    seedFromEntry(activeEntry)
    setSavedAt(null)
    setSaveError(null)
    setGuardDirty(false)
    onLeave()
  }

  /** Switch which side of a boundary week the form is editing. Dirty-
   *  guarded — if the user has unsaved edits on the current side, prompt
   *  before discarding and re-seeding from the other side. */
  const switchSide = (next: 'a' | 'b') => {
    if (next === selectedSide || !boundary) return
    if (
      isDirty &&
      !confirm(
        'You have unsaved changes on this partial. Switch to the other partial without saving?'
      )
    )
      return
    setSelectedSide(next)
    seedFromEntry(entries[next])
    setSavedAt(null)
    setSaveError(null)
  }

  const onSave = async () => {
    if (!client || saving) return
    if (!isDirty) {
      setSavedAt(Date.now())
      return
    }
    setSaveError(null)

    // YTD overlap notification — if a budget exists for this entry's
    // year with a ytd_thru_month that already covers this entry's month,
    // the cumulative dashboard will double-count income. Surface it
    // before the save commits so the user can decide.
    //
    // Use activeSlot.startIso (not weekStart) so the Jan-side partial
    // of a Dec/Jan boundary checks the NEW year's budget, not the old
    // year's — weekStart stays on the boundary Sunday for both partials.
    const slotStart = dateFromIso(activeSlot.startIso)
    const year = slotStart.getFullYear()
    const slotMonth = slotStart.getMonth()
    const { data: budget } = await supabase
      .from('budgets')
      .select('ytd_thru_month')
      .eq('client_id', client.id)
      .eq('year', year)
      .maybeSingle()
    const thru = (budget as { ytd_thru_month: number | null } | null)
      ?.ytd_thru_month
    if (thru != null && slotMonth <= thru) {
      const monthName = new Date(year, thru, 1).toLocaleDateString(
        'en-US',
        { month: 'long' }
      )
      if (
        !confirm(
          `Heads up — this week falls inside the YTD Actuals window (Jan–${monthName}). The cumulative dashboard may double-count income. Save this entry anyway?`
        )
      ) {
        return
      }
    }

    setSaving(true)

    const payload = {
      client_id: client.id,
      coach_id: client.coach_id,
      // For boundary partials, activeSlot.startIso is the side's start
      // (Sunday for A, 1st-of-next-month for B). For normal weeks it's
      // the Sunday.
      week_start_date: activeSlot.startIso,
      days: activeSlot.days,
      is_partial: activeSlot.isPartial,
      // Closed weeks store {} so dashboards / cumulative math read 0
      // for every KPI; non-closed weeks save whatever's in the form.
      kpi_values: closed ? {} : kpiValues,
      capacity_values: closed ? {} : capacityValues,
      notes: notes.trim() || null,
      closed,
    }

    const op = activeEntry
      ? supabase.from('weekly_entries').update(payload).eq('id', activeEntry.id)
      : supabase.from('weekly_entries').insert(payload)
    const { data, error } = await op.select().single()

    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    const saved = data as WeeklyEntry
    // Replace the saved entry on the side that was being edited; the
    // other side stays as-is (null if not yet entered).
    setEntries((prev) => ({ ...prev, [selectedSide]: saved }))
    seedFromEntry(saved)
    setSaveError(null)
    setSavedAt(Date.now())
    // Track the new (or updated) range so range-aware missed-weeks
    // reflects the save immediately. Dedup by startIso — partial saves
    // and re-saves should update the days field rather than duplicate.
    setSavedEntryRanges((prev) => {
      const without = prev.filter((r) => r.startIso !== saved.week_start_date)
      return [...without, { startIso: saved.week_start_date, days: saved.days ?? 7 }]
    })
  }

  const onDelete = async () => {
    if (!activeEntry || !client || saving) return
    const label = boundary
      ? `the ${activeSlot.days}-day partial starting ${formatWeekShort(dateFromIso(activeSlot.startIso))}`
      : `the entry for ${formatWeekShort(weekStart)}`
    if (!confirm(`Delete ${label}? This can't be undone.`)) return
    setSaveError(null)
    setSaving(true)
    const { error } = await supabase
      .from('weekly_entries')
      .delete()
      .eq('id', activeEntry.id)
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    // Reset active side back to "not yet entered"; other side untouched.
    setEntries((prev) => ({ ...prev, [selectedSide]: null }))
    seedFromEntry(null)
    setSavedAt(null)
    setGuardDirty(false)
    // Drop this range from saved so missed-weeks reflects the gap.
    setSavedEntryRanges((prev) =>
      prev.filter((r) => r.startIso !== activeSlot.startIso)
    )
  }

  // ---- Missed-weeks list -------------------------------------------------
  // Range-aware — walks each Sun-Sat week day-by-day and checks every
  // day is covered by some saved entry's date range. A boundary week
  // with only one partial saved still flags as missed because the
  // other partial's days aren't covered.
  const missedWeeks = useMemo(() => {
    if (!client) return []
    return missedWeeksBetween(new Date(client.created_at), savedEntryRanges)
  }, [client, savedEntryRanges])

  // ---- Render ------------------------------------------------------------
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

  const hasAnyRows = Array.from(groupedRows.values()).some(
    (rows) => rows.length > 0
  )

  return (
    <section className="space-y-4">
      {/* Sticky header + Save bar */}
      <div className="sticky top-[48px] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-6 sm:-mt-8 flex flex-wrap justify-between items-center gap-3">
        <h1 className="font-brand text-lg font-bold text-ink">Weekly Entry</h1>
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {/* Week picker row */}
      <WeekPicker
        weekStart={weekStart}
        onChange={setWeekStart}
        missedWeeks={missedWeeks}
      />

      {/* Boundary-week card picker. Only renders when the picked Sun-
          Sat week crosses a month. The two cards show each partial's
          date range, day count, and saved/not-entered status. Clicking
          one (with dirty-guard) scopes every input below to that
          partial's row. */}
      {boundary && (
        <BoundaryCardPicker
          boundary={boundary}
          entries={entries}
          selectedSide={selectedSide}
          onSelect={switchSide}
          hideA={startBoundaryHidesA}
        />
      )}

      {/* Closed-week toggle + banner. When on, the KPI cards below are
          replaced with a yellow informational banner and only Notes
          stays editable. Saving sends closed=true + cleared values.
          In boundary mode the flag scopes to whichever side is
          selected — each partial has its own closed state. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={closed}
            onChange={(e) => onToggleClosed(e.target.checked)}
            className="w-4 h-4 accent-accent cursor-pointer"
          />
          <span className="text-black text-sm font-semibold">
            Closed this week (no business)
          </span>
        </label>
      </div>

      {closed && (
        <div className="bg-yellow-50 border border-yellow-300 rounded p-3 text-sm text-black">
          <strong>Closed week.</strong> All KPI values save as zero. The
          closure counts as a non-revenue week against your unchanged
          monthly / annual goals. Use Notes below to document the reason.
        </div>
      )}

      {saveError && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
          {saveError}
        </div>
      )}

      {loadingEntry && !activeEntry && (
        <div className="text-xs text-black italic">Loading week…</div>
      )}

      {/* Closed mode: skip KPI cards entirely, show Notes alone so the
          client can document the closure. The form still has the toggle
          and banner above; saving sends closed=true + empty values. */}
      {closed && (
        <div className="max-w-2xl">
          <Card title="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was the reason for the closure? (Optional.)"
              rows={3}
              className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent resize-y"
            />
          </Card>
        </div>
      )}

      {/* KPI actuals as one Card per category. Within each card, rows
          render in registry order — inputs and derived interleave per the
          KPI registry, distinguished visually by NumberField (editable
          yellow ring) vs DerivedKpiBox (read-only gray border). Cards
          collapse independently via the Card's +/− button. Hidden in
          closed mode (above). */}
      {!closed && (!hasAnyRows && (client.capacity_groups?.length ?? 0) === 0 ? (
        <Card title="KPI Actuals">
          <div className="text-white text-xs">
            No active KPIs to enter. Toggle some on under{' '}
            <strong>Settings → Active KPIs</strong>.
          </div>
        </Card>
      ) : (
        (() => {
          // Build the flat card list, then distribute into two independent
          // column-stacks (evens → left, odds → right). Each column packs
          // its cards top-to-bottom with space-y-4 so collapsing a card
          // lets the one below it shift up — no shared row height.
          const cards: React.ReactNode[] = []
          for (const cat of CATEGORIES) {
            const rows = groupedRows.get(cat) ?? []
            const capacityGroupsHere =
              cat === 'Team' ? (client.capacity_groups ?? []) : []
            if (rows.length === 0 && capacityGroupsHere.length === 0) continue
            cards.push(
              <Card key={cat} title={cat}>
                {rows.map((row) =>
                  row.derived ? (
                    <div key={row.id} className="flex flex-col">
                      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1 flex items-center gap-1.5">
                        <span>{row.label}</span>
                        {row.desc && <InfoIcon text={row.desc} />}
                      </div>
                      <DerivedKpiBox
                        value={formatDerivedWeekly(
                          deriveWeeklyValue(
                            row.id,
                            kpiValues,
                            visibleStandardIds
                          ),
                          row.format
                        )}
                      />
                    </div>
                  ) : (
                    <div key={row.id} className="flex flex-col">
                      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1 flex items-center gap-1.5">
                        <span>{row.label}</span>
                        {row.desc && <InfoIcon text={row.desc} />}
                      </div>
                      <NumberField
                        value={kpiValues[row.id]}
                        onChange={(n) => setKpi(row.id, n)}
                        format={numberFieldFormat[row.format]}
                        max={row.format === '%' ? 100 : null}
                        ariaLabel={`${row.label} this week`}
                      />
                      {row.hint && (
                        <div className="text-xs text-white italic mt-1">
                          {row.hint}
                        </div>
                      )}
                    </div>
                  )
                )}
                {capacityGroupsHere.map((g) => {
                  const v = computeLiveUtilization(g, capacityValues[g.id])
                  return (
                    <div key={g.id} className="space-y-3">
                      {g.method !== 'manual' && (
                        <CapacityGroupEntryBlock
                          group={g}
                          values={capacityValues[g.id]}
                          onChange={(next) =>
                            setCapacityValues((prev) => {
                              const out = { ...prev }
                              if (next === undefined) delete out[g.id]
                              else out[g.id] = next
                              return out
                            })
                          }
                        />
                      )}
                      <div className="flex flex-col">
                        <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
                          {capacityUtilizationLabel(g)}
                        </div>
                        <DerivedKpiBox
                          value={v === null ? '—' : `${v.toFixed(1)}%`}
                        />
                      </div>
                    </div>
                  )
                })}
              </Card>
            )
          }
          cards.push(
            <Card key="notes" title="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything notable about this week? (Optional.)"
                rows={3}
                className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent resize-y"
              />
            </Card>
          )
          const leftCol = cards.filter((_, i) => i % 2 === 0)
          const rightCol = cards.filter((_, i) => i % 2 === 1)
          return (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
              <div className="space-y-4">{leftCol}</div>
              <div className="space-y-4">{rightCol}</div>
            </div>
          )
        })()
      ))}

      {/* Delete this entry — only when a saved entry exists for the
          currently-selected partial / week. Per Doc 06: small subtle
          link below the sticky top Save bar, requires confirm. */}
      {activeEntry && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="text-xs text-black underline hover:opacity-80 disabled:opacity-50"
          >
            Delete this entry
          </button>
        </div>
      )}
    </section>
  )
}

// =============================================================================
// Helpers
// =============================================================================

/** Two-card picker for boundary weeks. Each card shows one partial's
 *  date range + day count + saved-status; the active card is highlighted
 *  with the dark pill treatment, the inactive one stays light with a
 *  hover affordance. Tapping the inactive card swaps which partial the
 *  form below is editing (dirty-guarded in the parent). */
function BoundaryCardPicker({
  boundary,
  entries,
  selectedSide,
  onSelect,
  hideA = false,
}: {
  boundary: { a: PartialSlot; b: PartialSlot }
  entries: { a: WeeklyEntry | null; b: WeeklyEntry | null }
  selectedSide: 'a' | 'b'
  onSelect: (side: 'a' | 'b') => void
  /** Hide the Partial A card (closed-month half of the starting week). */
  hideA?: boolean
}) {
  const renderRange = (startIso: string, days: number) => {
    const start = dateFromIso(startIso)
    const end = new Date(start)
    end.setDate(end.getDate() + days - 1)
    const sameMonth = start.getMonth() === end.getMonth()
    const startFmt = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
    const endFmt = end.toLocaleDateString('en-US', {
      month: sameMonth ? undefined : 'short',
      day: 'numeric',
    })
    return `${startFmt}–${endFmt}`
  }

  const Card = ({
    side,
    slot,
    entry,
  }: {
    side: 'a' | 'b'
    slot: { startIso: string; days: number }
    entry: WeeklyEntry | null
  }) => {
    const active = selectedSide === side
    const status = entry
      ? entry.closed
        ? 'Saved · closed'
        : 'Saved'
      : 'Not yet entered'
    // Compact pill — both cards bg-ink, sized to content (no flex-1).
    // Active card carries a yellow accent border per the fillable-
    // input convention; inactive card uses a subtle dark border.
    return (
      <button
        type="button"
        onClick={() => onSelect(side)}
        aria-pressed={active}
        className={`bg-ink text-white text-left rounded px-2.5 py-1.5 border-2 transition-colors hover:brightness-110 ${
          active ? 'border-accent' : 'border-line'
        }`}
      >
        <div className="text-sm font-bold">
          {renderRange(slot.startIso, slot.days)}
        </div>
        <div className="text-xs text-white/80">
          {slot.days}-day partial · {status}
        </div>
        <div className="text-xs font-semibold text-accent">
          {active ? '● Editing' : '○ Click to update'}
        </div>
      </button>
    )
  }

  return (
    <div className="flex flex-wrap gap-3">
      {!hideA && <Card side="a" slot={boundary.a} entry={entries.a} />}
      <Card side="b" slot={boundary.b} entry={entries.b} />
    </div>
  )
}

function WeekPicker({
  weekStart,
  onChange,
  missedWeeks,
}: {
  weekStart: Date
  onChange: (next: Date) => void
  missedWeeks: Date[]
}) {
  // Both pills resolve any picked date to its Sunday-start week.
  const pickWeekFromDate = (d: Date) => onChange(weekStartSunday(d))

  return (
    <div className="flex flex-wrap items-center gap-3 text-base">
      {/* Combined "Week of [date] 📅" pill — tap to open the OS-native
          date picker, capped at the most recent completed Saturday so
          users can only enter completed weeks. Same component as the
          dashboard's header so the two screens read identically. */}
      <WeekOfCalendarPill weekStart={weekStart} onPick={pickWeekFromDate} />

      {/* Red "Missed weeks (N)" dropdown — only when there are gaps,
          most recent first. Picking jumps the entry page to that week
          (same handler as the calendar pill). */}
      {missedWeeks.length > 0 && (
        <MissedWeeksPill
          missedWeeks={missedWeeks}
          onPick={pickWeekFromDate}
        />
      )}
    </div>
  )
}

/** Read-only display for auto-derived weekly KPIs (Gross Profit, GP%,
 *  Conversion Rate, etc.). Same dark surface + 0.5px yellow line as the
 *  derived boxes elsewhere on the page so the "auto-populated" visual
 *  treatment is consistent. */
function DerivedKpiBox({ value }: { value: string }) {
  return (
    <div className="w-full bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm px-3 py-2 min-h-[40px] flex items-center">
      {value}
    </div>
  )
}

// =============================================================================
// Capacity-group entry blocks — one per group on the client. Renders
// method-specific inputs and a live utilization % in the block header.
// Stored on the row at capacity_values[groupId].
// =============================================================================

function CapacityGroupEntryBlock({
  group,
  values,
  onChange,
}: {
  group: CapacityGroup
  values: WeeklyCapacityActual | undefined
  onChange: (next: WeeklyCapacityActual | undefined) => void
}) {
  // The live utilization % is no longer in the block header — it lives in
  // the right-side "Auto-calculated" card per category-split layout.
  return (
    <div className="bg-surface-2 rounded-lg p-3 space-y-3">
      <div className="text-white text-sm font-semibold">
        {group.name || 'Untitled group'}
      </div>
      <CapacityGroupBody
        group={group}
        values={values}
        onChange={onChange}
      />
    </div>
  )
}

/** Label for the auto-calculated utilization row on the right side of
 *  Weekly Entry. Uses the group name, the word "Utilization", and (when
 *  set) the "What's Being Measured" field — per user's spec:
 *    Body Team Utilization — Labor Hours
 *  If no measurable, drops the trailing qualifier. */
function capacityUtilizationLabel(group: CapacityGroup): string {
  const name = group.name?.trim() || 'Untitled group'
  const measurable = group.measurable?.trim()
  return measurable
    ? `${name} Utilization — ${measurable}`
    : `${name} Utilization`
}

function CapacityGroupBody({
  group,
  values,
  onChange,
}: {
  group: CapacityGroup
  values: WeeklyCapacityActual | undefined
  onChange: (next: WeeklyCapacityActual | undefined) => void
}) {
  switch (group.method) {
    case 'manual':
      // Doc 04 PC #3: Manual % is a one-time setting in Settings —
      // no weekly entry input. The block header still displays the
      // staticUtilPct from the group definition as informational context.
      return <ManualInfo />
    case 'slots':
      return (
        <SlotsBlock group={group} values={values} onChange={onChange} />
      )
    case 'labor':
      return (
        <LaborBlock group={group} values={values} onChange={onChange} />
      )
    case 'revenue':
      return (
        <RevenueBlock group={group} values={values} onChange={onChange} />
      )
    case 'headcount':
      return (
        <HeadcountBlock
          group={group}
          values={values}
          onChange={onChange}
        />
      )
    default:
      return (
        <div className="text-white text-xs italic">
          No tracking method picked yet. Set one in Settings → Capacity
          &amp; Utilization Tracking.
        </div>
      )
  }
}

function ManualInfo() {
  return (
    <div className="text-xs text-white italic">
      Set in Settings — not entered weekly.
    </div>
  )
}

function SlotsBlock({
  group,
  values,
  onChange,
}: {
  group: CapacityGroup
  values: WeeklyCapacityActual | undefined
  onChange: (next: WeeklyCapacityActual | undefined) => void
}) {
  const v =
    (values as { slotsFilled?: number; totalSlots?: number } | undefined) ??
    {}
  const m = group.measurable?.trim()
  // No measurable → no label. Better blank than a generic
  // "Slots Filled" that misrepresents what the coach is tracking.
  const filledLabel = m ? `${m} Filled` : ''
  return (
    <Labeled label={filledLabel}>
      <NumberField
        value={v.slotsFilled}
        onChange={(n) => {
          if (n === undefined) {
            onChange(undefined)
            return
          }
          // Preserve any legacy totalSlots value so historic entries
          // continue to parse; the new max comes from group config.
          onChange({
            slotsFilled: n,
            totalSlots: v.totalSlots ?? 0,
          })
        }}
        format="count"
        ariaLabel={filledLabel}
      />
    </Labeled>
  )
}

function LaborBlock({
  group,
  values,
  onChange,
}: {
  group: CapacityGroup
  values: WeeklyCapacityActual | undefined
  onChange: (next: WeeklyCapacityActual | undefined) => void
}) {
  const v = (values as { producedHours?: number } | undefined) ?? {}
  const cap = groupMaxCapacity(group)
  // No measurable → no label. Empty is better than a generic
  // "Labor Hours Completed" fallback.
  const label = group.measurable?.trim() ?? ''
  return (
    <div className="space-y-2">
      <Labeled label={label}>
        <NumberField
          value={v.producedHours}
          onChange={(n) =>
            onChange(n === undefined ? undefined : { producedHours: n })
          }
          format="count"
          ariaLabel={label}
        />
      </Labeled>
      <div className="text-xs text-white italic">
        Capacity: {cap} hrs/wk
      </div>
    </div>
  )
}

function RevenueBlock({
  group,
  values,
  onChange,
}: {
  group: CapacityGroup
  values: WeeklyCapacityActual | undefined
  onChange: (next: WeeklyCapacityActual | undefined) => void
}) {
  const v = (values as { revenueProduced?: number } | undefined) ?? {}
  const cap = groupMaxCapacity(group)
  // No measurable → no label. The "$" prefix from NumberField already
  // signals dollars; the generic fallback ("Dollars Earned") wasn't
  // adding clarity.
  const label = group.measurable?.trim() ?? ''
  return (
    <div className="space-y-2">
      <Labeled label={label}>
        <NumberField
          value={v.revenueProduced}
          onChange={(n) =>
            onChange(n === undefined ? undefined : { revenueProduced: n })
          }
          format="dollars"
          max={null}
          ariaLabel={label}
        />
      </Labeled>
      <div className="text-xs text-white italic">
        Capacity: {formatDollars(cap)}/wk
      </div>
    </div>
  )
}

function HeadcountBlock({
  group,
  values,
  onChange,
}: {
  group: CapacityGroup
  values: WeeklyCapacityActual | undefined
  onChange: (next: WeeklyCapacityActual | undefined) => void
}) {
  const v =
    (values as
      | {
          hoursWorked?: number
          departments?: Record<string, { hoursWorked: number }>
        }
      | undefined) ?? {}
  // Read the new single-field hoursWorked; fall back to the legacy
  // per-department sum so old entries display correctly.
  const totalFromLegacy = Object.values(v.departments ?? {}).reduce(
    (sum, d) => sum + (d.hoursWorked ?? 0),
    0
  )
  const current = v.hoursWorked ?? (totalFromLegacy || undefined)
  const cap = groupMaxCapacity(group)
  // No measurable → no label. Empty is preferable to a generic
  // "Hours Worked" fallback.
  const label = group.measurable?.trim() ?? ''
  return (
    <div className="space-y-2">
      <Labeled label={label}>
        <NumberField
          value={current}
          onChange={(n) =>
            onChange(n === undefined ? undefined : { hoursWorked: n })
          }
          format="count"
          ariaLabel={label}
        />
      </Labeled>
      <div className="text-xs text-white italic">
        Capacity: {cap} hrs/wk
      </div>
    </div>
  )
}

function Labeled({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  // Empty label = render just the input with no label row. Used on
  // capacity blocks when the coach hasn't filled in "What's Being
  // Measured" — we'd rather show nothing than a generic placeholder
  // that misrepresents what the field is for.
  return (
    <div>
      {label && (
        <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Utilization math — same shape as the dashboard will eventually consume so
// per-method live computation stays in one place.
// -----------------------------------------------------------------------------

function computeLiveUtilization(
  group: CapacityGroup,
  values: WeeklyCapacityActual | undefined
): number | null {
  // Manual is special — the value comes from group.staticUtilPct (set
  // once in Settings), not from this week's entry. Doc 04 PC #3.
  if (group.method === 'manual') {
    return group.staticUtilPct ?? null
  }
  if (!values) return null
  const cap = groupMaxCapacity(group)
  if (!cap) return null
  switch (group.method) {
    case 'slots': {
      const v = values as { slotsFilled?: number }
      return ((v.slotsFilled ?? 0) / cap) * 100
    }
    case 'labor': {
      const v = values as { producedHours?: number }
      return ((v.producedHours ?? 0) / cap) * 100
    }
    case 'revenue': {
      const v = values as { revenueProduced?: number }
      return ((v.revenueProduced ?? 0) / cap) * 100
    }
    case 'headcount': {
      // Legacy entries kept per-department hoursWorked; new entries
      // store a single hoursWorked total. Try both shapes.
      const v = values as {
        hoursWorked?: number
        departments?: Record<string, { hoursWorked?: number }>
      }
      const total =
        v.hoursWorked ??
        Object.values(v.departments ?? {}).reduce(
          (sum, d) => sum + (d.hoursWorked ?? 0),
          0
        )
      return (total / cap) * 100
    }
    default:
      return null
  }
}

function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
