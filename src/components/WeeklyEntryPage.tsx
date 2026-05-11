import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  CATEGORIES,
  KPIS,
  type KpiCategory,
  type KpiFormat,
} from '../lib/kpis'
import {
  totalCapacityHours,
  totalHeadcountCapacityHours,
  totalRevenueCapacity,
} from '../lib/capacity'
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
  /** Optional inline hint shown below the input — e.g. for snapshot KPIs
   *  that are end-of-week values rather than weekly totals. */
  hint?: string
}

const numberFieldFormat: Record<KpiFormat, 'dollars' | 'percent' | 'count'> = {
  $: 'dollars',
  '%': 'percent',
  '#': 'count',
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

  useEffect(() => {
    if (savedAt && isDirty) setSavedAt(null)
  }, [savedAt, isDirty])
  useEffect(() => {
    if (savedAt === null) return
    const t = setTimeout(() => setSavedAt(null), 3000)
    return () => clearTimeout(t)
  }, [savedAt])

  // ---- Build the input rows, grouped by category -------------------------
  const groupedRows = useMemo(() => {
    if (!client) return new Map<KpiCategory, EntryRow[]>()
    const grouped = new Map<KpiCategory, EntryRow[]>()
    const push = (cat: KpiCategory, row: EntryRow) => {
      const list = grouped.get(cat) ?? []
      list.push(row)
      grouped.set(cat, list)
    }
    // Standard KPIs: include always-on inputs (revenue, cogs) and any
    // toggled-on non-auto KPI. Skip auto-derived.
    for (const k of KPIS) {
      if (k.auto) continue
      if (k.isCapacityFlag) continue // capacity entries handled separately
      if (!k.always && Number(client.kpis[k.id]) !== 1) continue
      push(k.category, {
        id: k.id,
        label: k.label,
        format: k.format,
        hint:
          k.aggregation === 'last'
            ? 'End-of-week snapshot'
            : undefined,
      })
    }
    // Custom KPIs
    for (const c of client.custom_kpis ?? []) {
      if (c.active === false) continue
      push(c.category, {
        id: c.id,
        label: c.name,
        format: c.format,
      })
    }
    return grouped
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
      !confirm('Discard your unsaved changes and leave Weekly Entry?')
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
      {/* Header + Save bar */}
      <div className="flex flex-wrap justify-between items-center gap-3">
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

      {/* KPI inputs */}
      <Card title="KPI Actuals">
        {!hasAnyRows && (client.capacity_groups?.length ?? 0) === 0 ? (
          <div className="text-white text-xs">
            No active KPIs to enter. Toggle some on under{' '}
            <strong>Settings → Active KPIs</strong>.
          </div>
        ) : (
          <div className="space-y-5">
            {CATEGORIES.map((cat) => {
              const rows = groupedRows.get(cat) ?? []
              const teamGroups =
                cat === 'Team' ? (client.capacity_groups ?? []) : []
              // Doc 6 planned change: hide empty categories entirely.
              if (rows.length === 0 && teamGroups.length === 0) return null
              return (
                <div key={cat}>
                  <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
                    {cat}
                  </div>
                  {rows.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                      {rows.map((row) => (
                        <div
                          key={row.id}
                          className="flex flex-col h-full justify-end"
                        >
                          <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
                            {row.label}
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
                      ))}
                    </div>
                  )}
                  {teamGroups.length > 0 && (
                    <div
                      className={`space-y-3 ${
                        rows.length > 0 ? 'mt-4' : ''
                      }`}
                    >
                      {teamGroups.map((g) => (
                        <CapacityGroupEntryBlock
                          key={g.id}
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
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Notes */}
      <Card title="Notes">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anything notable about this week? (Optional.)"
          rows={3}
          className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent resize-y"
        />
      </Card>

      {/* Bottom save */}
      <div className="flex justify-end pt-2">
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {/* Delete this entry — only when a saved entry exists for this week.
          Per Doc 06: small subtle link below the Save bar, requires confirm. */}
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
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {/* Calendar (date picker, capped at last completed Saturday — no
          current-or-future weeks). */}
      <label className="flex items-center gap-2">
        <span className="text-black font-semibold">Pick a date:</span>
        <input
          type="date"
          value={selectedIso}
          max={maxIso}
          onChange={(e) => onPickDate(e.target.value)}
          className="bg-white border border-gray-300 rounded text-black text-xs px-2 py-1 focus:outline-none focus:border-gray-400"
        />
      </label>

      {/* Resolved week range. */}
      <span className="text-black font-semibold whitespace-nowrap">
        {formatWeekShort(weekStart)}
      </span>

      {/* Missed-weeks dropdown — only weeks that have no saved entry yet,
          most recent first. Hidden when there are no gaps. */}
      {missedWeeks.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onPickDate(e.target.value)
          }}
          aria-label="Jump to a missed week"
          className="select-yellow bg-white border border-gray-300 rounded text-black text-xs px-3 py-1 focus:outline-none focus:border-gray-400"
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
        {saving ? 'Saving…' : showSaved ? 'Saved ✓' : 'Save Entry'}
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
    <div className="bg-ink border border-line rounded-lg p-5 space-y-4">
      <h2 className="text-white text-sm font-bold">{title}</h2>
      {children}
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
  const utilPct = computeLiveUtilization(group, values)
  return (
    <div className="bg-surface-2 border-[0.5px] border-accent rounded-lg p-3 space-y-3">
      <div className="flex justify-between items-center gap-3">
        <div className="text-white text-sm font-semibold">
          {group.name || 'Untitled group'}
        </div>
        <div className="text-white text-sm font-bold whitespace-nowrap">
          {utilPct === null ? '—' : `${utilPct.toFixed(1)}%`}
        </div>
      </div>
      <CapacityGroupBody
        group={group}
        values={values}
        onChange={onChange}
      />
    </div>
  )
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
          No tracking method picked yet — set one in Settings → Capacity
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
    (values as { totalSlots?: number; slotsFilled?: number } | undefined) ??
    {}
  const m = group.measurable?.trim()
  const totalLabel = m ? `Total ${m}` : 'Total Slots'
  const filledLabel = m ? `${m} Filled` : 'Slots Filled'
  const update = (patch: { totalSlots?: number; slotsFilled?: number }) => {
    const merged = { ...v, ...patch }
    const total = merged.totalSlots
    const filled = merged.slotsFilled
    if (total === undefined && filled === undefined) {
      onChange(undefined)
      return
    }
    onChange({
      totalSlots: total ?? 0,
      slotsFilled: filled ?? 0,
    })
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Labeled label={totalLabel}>
        <NumberField
          value={v.totalSlots}
          onChange={(n) => update({ totalSlots: n })}
          format="count"
          ariaLabel={totalLabel}
        />
      </Labeled>
      <Labeled label={filledLabel}>
        <NumberField
          value={v.slotsFilled}
          onChange={(n) => update({ slotsFilled: n })}
          format="count"
          ariaLabel={filledLabel}
        />
      </Labeled>
    </div>
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
  const cap = totalCapacityHours(group)
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
  const cap = totalRevenueCapacity(group)
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
      | { departments?: Record<string, { hoursWorked: number }> }
      | undefined) ?? {}
  const departments = group.departments ?? []
  const cap = totalHeadcountCapacityHours(group)

  const update = (deptId: string, hours: number | undefined) => {
    const nextDepts: Record<string, { hoursWorked: number }> = {
      ...(v.departments ?? {}),
    }
    if (hours === undefined) delete nextDepts[deptId]
    else nextDepts[deptId] = { hoursWorked: hours }
    if (Object.keys(nextDepts).length === 0) {
      onChange(undefined)
      return
    }
    onChange({ departments: nextDepts })
  }

  if (departments.length === 0) {
    return (
      <div className="text-white text-xs italic">
        No departments yet — add some in Settings → Capacity &amp; Utilization
        Tracking.
      </div>
    )
  }
  const m = group.measurable?.trim()
  const unit = m || 'Hours Worked'
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        {departments.map((d) => (
          <Labeled
            key={d.id}
            label={`${d.name || 'Department'} — ${unit}`}
          >
            <NumberField
              value={v.departments?.[d.id]?.hoursWorked}
              onChange={(n) => update(d.id, n)}
              format="count"
              ariaLabel={`${d.name || 'Department'} ${unit.toLowerCase()}`}
            />
          </Labeled>
        ))}
      </div>
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
  switch (group.method) {
    case 'slots': {
      const v = values as { totalSlots?: number; slotsFilled?: number }
      if (!v.totalSlots) return null
      return ((v.slotsFilled ?? 0) / v.totalSlots) * 100
    }
    case 'labor': {
      const v = values as { producedHours?: number }
      const cap = totalCapacityHours(group)
      if (!cap) return null
      return ((v.producedHours ?? 0) / cap) * 100
    }
    case 'revenue': {
      const v = values as { revenueProduced?: number }
      const cap = totalRevenueCapacity(group)
      if (!cap) return null
      return ((v.revenueProduced ?? 0) / cap) * 100
    }
    case 'headcount': {
      const v = values as {
        departments?: Record<string, { hoursWorked?: number }>
      }
      const cap = totalHeadcountCapacityHours(group)
      if (!cap) return null
      const total = Object.values(v.departments ?? {}).reduce(
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
