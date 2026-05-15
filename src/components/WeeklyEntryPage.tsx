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
  lastCompletedSaturday,
  mostRecentCompletedWeekStart,
  weekStartSunday,
} from '../lib/week'
import { useDirtyGuard } from '../lib/dirtyGuard'
import { NumberField } from './NumberField'
import { SaveBar } from './SaveBar'
import { Card } from './Card'
import { InfoIcon } from './InfoIcon'

// =============================================================================
// Phase 5 — Weekly Entry
// One row per (client, week_start_date). Coach + client can both edit.
// Loads the entry for the currently-selected Sunday-start week, or shows a
// blank form if none exists yet (insert on first save).
// =============================================================================

type Props = {
  clientId: string
  /** True when a coach is viewing on behalf of the client. */
  coachView: boolean
  onLeave: () => void
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
  capacityValues: Record<string, WeeklyCapacityActual>,
  capacityGroups: CapacityGroup[],
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

export function WeeklyEntryPage({ clientId, onLeave }: Props) {
  const [client, setClient] = useState<Client | null>(null)
  const [capacityValues, setCapacityValues] = useState<
    Record<string, WeeklyCapacityActual>
  >({})
  const [entry, setEntry] = useState<WeeklyEntry | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingEntry, setLoadingEntry] = useState(false)
  /** All weeks the client has saved entries for. Used to compute the list
   *  of "missed" weeks (gaps between client.created_at and the current
   *  week that have no entry yet). */
  const [savedWeekDates, setSavedWeekDates] = useState<Set<string>>(
    () => new Set()
  )

  // Default to the most recent COMPLETED week — i.e. last week. The
  // in-progress current week is intentionally NOT selectable; users only
  // enter actuals for weeks that have finished.
  const [weekStart, setWeekStart] = useState<Date>(() =>
    mostRecentCompletedWeekStart()
  )
  const [kpiValues, setKpiValues] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState('')

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // ---- Load client + all entry dates (once per client) -------------------
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [clientRes, entriesRes] = await Promise.all([
        supabase
          .from('clients')
          .select('*')
          .eq('id', clientId)
          .maybeSingle(),
        supabase
          .from('weekly_entries')
          .select('week_start_date')
          .eq('client_id', clientId),
      ])
      if (cancelled) return
      if (clientRes.error || !clientRes.data) {
        setLoadError(clientRes.error?.message ?? 'Client not found')
        return
      }
      setClient(clientRes.data as Client)
      const dates = new Set<string>(
        (entriesRes.data ?? []).map(
          (r) => (r as { week_start_date: string }).week_start_date
        )
      )
      setSavedWeekDates(dates)
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
  }
  useEffect(() => {
    let cancelled = false
    setLoadingEntry(true)
    ;(async () => {
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
      setEntry(e)
      seedFromEntry(e)
      setSavedAt(null)
      setSaveError(null)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, weekStart])

  // ---- Dirty tracking ----------------------------------------------------
  const isDirty = useMemo(() => {
    const savedKpi = entry?.kpi_values ?? {}
    const savedCap = entry?.capacity_values ?? {}
    if (JSON.stringify(kpiValues) !== JSON.stringify(savedKpi)) return true
    if (JSON.stringify(capacityValues) !== JSON.stringify(savedCap))
      return true
    if (notes !== (entry?.notes ?? '')) return true
    return false
  }, [kpiValues, capacityValues, notes, entry])

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
    seedFromEntry(entry)
    setSavedAt(null)
    setSaveError(null)
    setGuardDirty(false)
    onLeave()
  }

  const onSave = async () => {
    if (!client || saving) return
    if (!isDirty) {
      setSavedAt(Date.now())
      return
    }
    setSaveError(null)

    // YTD overlap notification — if a budget exists for this week's year
    // with a ytd_thru_month that already covers this week's month, the
    // cumulative dashboard will double-count income. Surface it before
    // the save commits so the user can decide.
    const year = weekStart.getFullYear()
    const { data: budget } = await supabase
      .from('budgets')
      .select('ytd_thru_month')
      .eq('client_id', client.id)
      .eq('year', year)
      .maybeSingle()
    const thru = (budget as { ytd_thru_month: number | null } | null)
      ?.ytd_thru_month
    if (thru != null && weekStart.getMonth() <= thru) {
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
      week_start_date: isoDate(weekStart),
      kpi_values: kpiValues,
      capacity_values: capacityValues,
      notes: notes.trim() || null,
    }

    const op = entry
      ? supabase.from('weekly_entries').update(payload).eq('id', entry.id)
      : supabase.from('weekly_entries').insert(payload)
    const { data, error } = await op.select().single()

    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    const saved = data as WeeklyEntry
    setEntry(saved)
    seedFromEntry(saved)
    setSaveError(null)
    setSavedAt(Date.now())
    // Track this week as saved so it falls out of the missed-weeks list.
    setSavedWeekDates((prev) => {
      if (prev.has(saved.week_start_date)) return prev
      const next = new Set(prev)
      next.add(saved.week_start_date)
      return next
    })
  }

  const onDelete = async () => {
    if (!entry || !client || saving) return
    if (
      !confirm(
        `Delete the entry for ${formatWeekShort(weekStart)}? This can't be undone.`
      )
    )
      return
    setSaveError(null)
    setSaving(true)
    const { error } = await supabase
      .from('weekly_entries')
      .delete()
      .eq('id', entry.id)
    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    // Reset form to a blank entry for the same week.
    setEntry(null)
    seedFromEntry(null)
    setSavedAt(null)
    setGuardDirty(false)
    // Surface the week as missed again so the dropdown picks it up.
    setSavedWeekDates((prev) => {
      const iso = isoDate(weekStart)
      if (!prev.has(iso)) return prev
      const next = new Set(prev)
      next.delete(iso)
      return next
    })
  }

  // ---- Missed-weeks list -------------------------------------------------
  // Sundays from the client's first week up to (but not including) the
  // current in-progress week, minus any week that already has an entry.
  // The in-progress week is never selectable (entry is for completed
  // weeks only), so it doesn't appear here even if "missed".
  const missedWeeks = useMemo(() => {
    if (!client) return []
    const start = weekStartSunday(new Date(client.created_at))
    const current = weekStartSunday(new Date())
    const out: Date[] = []
    const cur = new Date(start)
    while (cur < current) {
      if (!savedWeekDates.has(isoDate(cur))) out.push(new Date(cur))
      cur.setDate(cur.getDate() + 7)
    }
    return out.reverse() // most-recent missed week first
  }, [client, savedWeekDates])

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
        <h1 className="text-lg font-bold text-ink">Weekly Entry</h1>
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

      {saveError && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
          {saveError}
        </div>
      )}

      {loadingEntry && !entry && (
        <div className="text-xs text-black italic">Loading week…</div>
      )}

      {/* KPI actuals as one Card per category. Within each card, rows
          render in registry order — inputs and derived interleave per the
          KPI registry, distinguished visually by NumberField (editable
          yellow ring) vs DerivedKpiBox (read-only gray border). Cards
          collapse independently via the Card's +/− button. */}
      {!hasAnyRows && (client.capacity_groups?.length ?? 0) === 0 ? (
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
                            capacityValues,
                            client.capacity_groups ?? [],
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
      )}

      {/* Delete this entry — only when a saved entry exists for this week.
          Per Doc 06: small subtle link below the sticky top Save bar, requires confirm. */}
      {entry && (
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

function WeekPicker({
  weekStart,
  onChange,
  missedWeeks,
}: {
  weekStart: Date
  onChange: (next: Date) => void
  missedWeeks: Date[]
}) {
  // Calendar max: the Saturday of the most recent completed week. Past
  // dates only — the in-progress week and anything beyond is not pickable.
  const maxIso = isoDate(lastCompletedSaturday())
  const selectedIso = isoDate(weekStart)

  const onPickDate = (iso: string) => {
    if (!iso) return
    onChange(weekStartSunday(dateFromIso(iso)))
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-base">
      {/* Calendar (date picker, capped at last completed Saturday — no
          current-or-future weeks). */}
      <label className="flex items-center gap-2">
        <span className="text-black font-semibold">Pick a date:</span>
        <input
          type="date"
          value={selectedIso}
          max={maxIso}
          onChange={(e) => onPickDate(e.target.value)}
          className="bg-white border border-gray-300 rounded text-black text-base px-2 py-1 focus:outline-none focus:border-gray-400"
        />
      </label>

      {/* Resolved week range. */}
      <span className="text-black font-semibold whitespace-nowrap">
        {formatWeekShort(weekStart)}
      </span>

      {/* Missed-weeks dropdown — only weeks that have no saved entry yet,
          most recent first. Hidden when there are no gaps.
          Red font: missed-action / overdue states use red per the
          feedback_overdue_red.md project rule. */}
      {missedWeeks.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onPickDate(e.target.value)
          }}
          aria-label="Jump to a missed week"
          className="select-yellow bg-white border border-gray-300 rounded text-bad font-bold text-xs px-3 py-1 focus:outline-none focus:border-gray-400"
        >
          <option value="">
            Missed weeks ({missedWeeks.length})
          </option>
          {missedWeeks.map((d) => (
            <option key={isoDate(d)} value={isoDate(d)}>
              {formatWeekShort(d)}
            </option>
          ))}
        </select>
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
  const filledLabel = m ? `${m} Filled` : 'Slots Filled'
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
  const m = group.measurable?.trim()
  // Use the measurable verbatim, no "Completed" suffix.
  const label = m || 'Labor Hours Completed'
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
  // Use the measurable verbatim — the "$" prefix comes from the
  // NumberField input itself, no need to append "($)" to the label.
  const label = group.measurable?.trim() || 'Dollars Earned'
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
  const label = group.measurable?.trim() || 'Hours Worked'
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
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </div>
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
