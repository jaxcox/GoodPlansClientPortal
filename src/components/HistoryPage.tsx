import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { KpiDef, KpiCategory } from '../lib/kpis'
import type {
  Budget,
  CapacityGroup,
  Client,
  CustomKpi,
  WeeklyEntry,
} from '../lib/types'
import { isoDate, dateFromIso, formatEntryRange } from '../lib/week'
import {
  visibleTileKpis,
  weeklyGoal,
  actualValue,
  monthShareFractions,
} from '../lib/dashboardGoals'
import { computeBudgetView, emptyMonthArray } from '../lib/budget'
import type { MonthlyGoal } from '../lib/budget'
import { formatValue as formatKpiValue } from './KpiTile'
import { groupMaxCapacity, groupWorkingHours } from '../lib/capacity'
import { computeBand } from '../lib/band'
import type { CapacityGroupGoal } from '../lib/types'
import writeXlsxFile from 'write-excel-file/browser'

type Props = {
  clientId: string
}

/** One row in the History table — a KPI or a capacity-group derived row. */
type Row =
  | {
      kind: 'standard'
      id: string
      label: string
      kpi: KpiDef
    }
  | {
      kind: 'custom'
      id: string
      label: string
      custom: CustomKpi
    }
  | {
      kind: 'capacity'
      id: string
      label: string
      group: CapacityGroup
      subKind: 'utilization' | 'laborHours' | 'laborEfficiency'
    }

export function HistoryPage({ clientId }: Props) {
  const [client, setClient] = useState<Client | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [entries, setEntries] = useState<WeeklyEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadingEntries, setLoadingEntries] = useState(false)

  // Default date range — the most recent COMPLETED calendar quarter (the one
  // before the current, in-progress quarter). The current quarter often has no
  // finished weeks yet, especially early in it, which left History blank; the
  // last completed quarter always reflects a full, finished period.
  const defaultRange = useMemo(() => {
    const today = new Date()
    const curQ = Math.floor(today.getMonth() / 3) // 0..3, current quarter
    // Step back one quarter, rolling into the prior year from Q1.
    let year = today.getFullYear()
    let q = curQ - 1
    if (q < 0) {
      q = 3
      year -= 1
    }
    const startMonth = q * 3
    return {
      from: isoDate(new Date(year, startMonth, 1)),
      to: isoDate(new Date(year, startMonth + 3, 0)), // last day of the quarter
    }
  }, [])

  const [fromDate, setFromDate] = useState<string>(defaultRange.from)
  const [toDate, setToDate] = useState<string>(defaultRange.to)

  // Load client + current-year budget once on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const year = new Date().getFullYear()
      const [clientRes, budgetRes] = await Promise.all([
        supabase.from('clients_safe').select('*').eq('id', clientId).maybeSingle(),
        supabase
          .from('budgets')
          .select('*')
          .eq('client_id', clientId)
          .eq('year', year)
          .maybeSingle(),
      ])
      if (cancelled) return
      if (clientRes.error || !clientRes.data) {
        setLoadError(clientRes.error?.message ?? 'Client not found')
        return
      }
      setClient(clientRes.data as Client)
      setBudget((budgetRes.data as Budget) ?? null)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  // Reload weekly entries any time the date range changes (or client loads).
  useEffect(() => {
    let cancelled = false
    setLoadingEntries(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('weekly_entries')
        .select('*')
        .eq('client_id', clientId)
        .gte('week_start_date', fromDate)
        .lte('week_start_date', toDate)
        .order('week_start_date', { ascending: true })
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setLoadingEntries(false)
        return
      }
      setEntries((data ?? []) as WeeklyEntry[])
      setLoadingEntries(false)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, fromDate, toDate])

  // ---- Derived data ------------------------------------------------------
  const budgetView = useMemo(() => {
    if (!budget) return null
    return computeBudgetView({
      annualRevenue: budget.annual_revenue ?? null,
      grossProfitPct:
        budget.cogs_target_pct == null ? null : 100 - budget.cogs_target_pct,
      annualExpenses: budget.annual_expenses ?? null,
      seasonType: budget.season_type ?? 'even',
      seasonPct: budget.season_pct ?? [],
      ytdThruMonth: budget.ytd_thru_month ?? null,
      ytdRevenueByMonth: budget.ytd_revenue_by_month ?? emptyMonthArray(),
      ytdCogsByMonth: budget.ytd_cogs_by_month ?? emptyMonthArray(),
      ytdExpensesByMonth: budget.ytd_expenses_by_month ?? emptyMonthArray(),
    })
  }, [budget])

  const monthShares = useMemo(
    () =>
      monthShareFractions(
        budget?.season_type ?? 'even',
        budget?.season_pct ?? []
      ),
    [budget]
  )

  const enabledIds = useMemo(() => {
    const out = new Set<string>()
    if (!client) return out
    for (const [id, v] of Object.entries(client.kpis ?? {})) {
      if (Number(v) === 1) out.add(id)
    }
    return out
  }, [client])

  // Build row list — standard KPIs (excluding hideTile + capacity-flag),
  // custom KPIs (active only), and per-capacity-group derived rows. Order
  // mirrors the Weekly Dashboard's Weekly-mode tile set.
  const rows = useMemo<Row[]>(() => {
    if (!client) return []
    const out: Row[] = []
    const standardKpis = visibleTileKpis(client)
    // Group by category so capacity rows can interleave under Team.
    const byCategory = new Map<KpiCategory, KpiDef[]>()
    for (const k of standardKpis) {
      const list = byCategory.get(k.category) ?? []
      list.push(k)
      byCategory.set(k.category, list)
    }
    const customByCategory = new Map<KpiCategory, CustomKpi[]>()
    for (const c of client.custom_kpis ?? []) {
      if (c.active === false) continue
      const list = customByCategory.get(c.category) ?? []
      list.push(c)
      customByCategory.set(c.category, list)
    }

    const categories: KpiCategory[] = [
      'Financials',
      'Marketing',
      'Sales',
      'Operations',
      'Team',
      'Overall Company',
    ]
    for (const cat of categories) {
      for (const k of byCategory.get(cat) ?? []) {
        out.push({ kind: 'standard', id: k.id, label: k.label, kpi: k })
      }
      // Team category gets per-capacity-group derived rows after standard KPIs
      if (cat === 'Team' && Number(client.kpis.capacityUtilization) === 1) {
        for (const g of client.capacity_groups ?? []) {
          const groupName = g.name || 'Untitled group'
          out.push({
            kind: 'capacity',
            id: `${g.id}:utilization`,
            label: `${groupName} — Utilization`,
            group: g,
            subKind: 'utilization',
          })
          if (g.method === 'labor') {
            out.push({
              kind: 'capacity',
              id: `${g.id}:laborHours`,
              label: `${groupName} — Labor Hours`,
              group: g,
              subKind: 'laborHours',
            })
            if (!g.hideLaborEfficiency) {
              out.push({
                kind: 'capacity',
                id: `${g.id}:laborEfficiency`,
                label: `${groupName} — Labor Efficiency`,
                group: g,
                subKind: 'laborEfficiency',
              })
            }
          }
        }
      }
      for (const c of customByCategory.get(cat) ?? []) {
        out.push({ kind: 'custom', id: c.id, label: c.name, custom: c })
      }
    }
    return out
  }, [client])

  // Per-entry weekly goal lookup helper — pulls the monthly goal for the
  // entry's calendar month, then asks `weeklyGoal()` to pro-rate.
  const monthlyGoalForEntry = (entry: WeeklyEntry): MonthlyGoal | null => {
    if (!budgetView) return null
    const idx = dateFromIso(entry.week_start_date).getMonth()
    return budgetView.months[idx] ?? null
  }

  // ---- Render -----------------------------------------------------------
  if (loadError) {
    return (
      <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
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

  return (
    <section className="space-y-4">
      {/* Sticky header bar */}
      <div className="sticky top-[var(--app-header-h,48px)] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-6 sm:-mt-8 flex flex-wrap justify-between items-center gap-3">
        <h1 className="font-brand text-lg font-bold text-ink">Weekly History</h1>
        <div className="flex items-center gap-4 flex-wrap">
          <button
            type="button"
            onClick={async () => {
              console.log('[History] Export Excel click', {
                entries: entries.length,
              })
              if (entries.length === 0) return
              try {
                await exportXlsx({
                  rows,
                  entries,
                  client,
                  capacityGroups: client.capacity_groups ?? [],
                  monthlyGoalForEntry,
                  monthShares,
                  kpiGoals: budget?.goals ?? {},
                  capacityGroupGoals: budget?.capacity_group_goals ?? {},
                  enabledIds,
                  annualRevenue:
                    budget?.annual_revenue != null
                      ? Number(budget.annual_revenue)
                      : undefined,
                  fromDate,
                  toDate,
                })
                console.log('[History] Export Excel completed')
              } catch (err) {
                console.error('[History] Excel export failed:', err)
                alert(
                  `Excel export failed: ${err instanceof Error ? err.message : String(err)}`
                )
              }
            }}
            disabled={entries.length === 0}
            className="bg-accent text-black font-bold px-3 py-2 sm:py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Export Excel ↓
          </button>
        </div>
      </div>

      {/* Date range card */}
      <Card title="Date Range">
        <div className="flex flex-wrap items-end gap-3">
          <DateField label="From Date" value={fromDate} onChange={setFromDate} />
          <DateField label="To Date" value={toDate} onChange={setToDate} />
        </div>
        <div className="text-xs text-white mt-3">
          {loadingEntries
            ? 'Loading entries…'
            : `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} in range.`}
        </div>
      </Card>

      {/* Table or empty state */}
      {entries.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
          No entries in this date range.
        </div>
      ) : (
        <HistoryTable
          rows={rows}
          entries={entries}
          client={client}
          monthlyGoalForEntry={monthlyGoalForEntry}
          monthShares={monthShares}
          kpiGoals={budget?.goals ?? {}}
          capacityGroupGoals={budget?.capacity_group_goals ?? {}}
          enabledIds={enabledIds}
          annualRevenue={
            budget?.annual_revenue != null
              ? Number(budget.annual_revenue)
              : undefined
          }
        />
      )}
    </section>
  )
}

// =============================================================================
// Sub-components
// =============================================================================

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-ink border border-line rounded-lg p-5">
      <h2 className="font-brand text-white text-sm font-bold mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/** A single cell shape that `write-excel-file` accepts. `null` = blank
 *  cell (per the library's convention). */
type ExcelCell =
  | null
  | {
      value: string | number
      type?: typeof Number | typeof String
      format?: string
      fontWeight?: 'bold'
      align?: 'left' | 'right' | 'center'
      backgroundColor?: string
      color?: string
    }

/** Excel hex colors for the three goal bands. Match the on-screen
 *  Tailwind variables (--color-good / --color-accent / --color-bad)
 *  exactly so the export looks the same as the page. Text is black on
 *  all three bands for consistency. */
const BAND_COLORS = {
  green: { bg: '#7ED957', text: '#000000' },
  yellow: { bg: '#FFF200', text: '#000000' },
  red: { bg: '#FF3131', text: '#000000' },
} as const

/** Build + download a real .xlsx workbook of the current History view. */
async function exportXlsx({
  rows,
  entries,
  client,
  capacityGroups,
  monthlyGoalForEntry,
  monthShares,
  kpiGoals,
  capacityGroupGoals,
  enabledIds,
  annualRevenue,
  fromDate,
  toDate,
}: {
  rows: Row[]
  entries: WeeklyEntry[]
  client: Client
  capacityGroups: CapacityGroup[]
  monthlyGoalForEntry: (entry: WeeklyEntry) => MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  fromDate: string
  toDate: string
}): Promise<void> {
  const headerRow: ExcelCell[] = [
    { value: 'KPI', fontWeight: 'bold' },
    ...entries.map(
      (e): ExcelCell => ({
        value: formatEntryRange(e.week_start_date, e.days ?? 7),
        fontWeight: 'bold',
        align: 'right',
      })
    ),
  ]

  const dataRows: ExcelCell[][] = rows.map((row) => {
    const cells: ExcelCell[] = [{ value: row.label, fontWeight: 'bold' }]
    for (const entry of entries) {
      const { value, goal, format, direction, range } = computeCell({
        row,
        entry,
        client,
        capacityGroups,
        monthlyGoal: monthlyGoalForEntry(entry),
        monthShares,
        kpiGoals,
        capacityGroupGoals,
        enabledIds,
        annualRevenue,
      })
      const band = computeBand({ value, goal, direction, range })
      cells.push(xlsxCell(value, format, band))
    }
    return cells
  })

  const sheet: ExcelCell[][] = [headerRow, ...dataRows]
  const filename = `${client.company_name} - History - ${fromDate} to ${toDate}.xlsx`
  // `write-excel-file` (browser build) returns a builder object with
  // `toFile(fileName)` and `toBlob()` methods — NOT a promise directly.
  // Calling `.toFile(name)` builds the workbook and triggers a
  // browser download.
  const result = (writeXlsxFile as unknown as (
    rows: ExcelCell[][],
    opts: {
      stickyRowsCount?: number
      stickyColumnsCount?: number
    }
  ) => {
    toFile: (fileName: string) => Promise<void>
    toBlob: () => Promise<Blob>
  })(sheet, {
    stickyRowsCount: 1,
    stickyColumnsCount: 1,
  })
  await result.toFile(filename)
}

/** Map a value + KPI format (+ optional goal band) to an Excel cell.
 *  Blank cell (null) when value is null. When a band is provided the
 *  cell is tinted with the matching green / yellow / red background
 *  and contrasting text color, so the exported workbook looks like the
 *  on-screen table. */
function xlsxCell(
  value: number | null,
  format: '$' | '%' | '#',
  band: 'green' | 'yellow' | 'red' | null
): ExcelCell {
  if (value == null || !Number.isFinite(value)) {
    return null
  }
  const colors = band ? BAND_COLORS[band] : null
  const base: ExcelCell = (() => {
    if (format === '$') {
      return {
        type: Number,
        value,
        format: '"$"#,##0',
        align: 'right',
      }
    }
    if (format === '%') {
      // KPI %-format values are stored as 0–100 numbers; Excel's % format
      // multiplies by 100 so we divide first.
      return {
        type: Number,
        value: value / 100,
        format: '0.0%',
        align: 'right',
      }
    }
    return {
      type: Number,
      value,
      format: '#,##0.##',
      align: 'right',
    }
  })()
  if (colors && base) {
    return { ...base, backgroundColor: colors.bg, color: colors.text }
  }
  return base
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // text-base (16px) on the input prevents iOS Safari from
        // auto-zooming into the form when the user taps the picker.
        className="bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-base sm:text-sm px-2 py-1.5 focus:outline-none focus:border-accent"
      />
    </div>
  )
}

function HistoryTable({
  rows,
  entries,
  client,
  monthlyGoalForEntry,
  monthShares,
  kpiGoals,
  capacityGroupGoals,
  enabledIds,
  annualRevenue,
}: {
  rows: Row[]
  entries: WeeklyEntry[]
  client: Client
  monthlyGoalForEntry: (entry: WeeklyEntry) => MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  enabledIds: Set<string>
  annualRevenue: number | undefined
}) {
  const groups = client.capacity_groups ?? []
  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden">
      {/* Table wrapper IS the scroll container — both directions. Sticky
          headers anchor to the wrapper's edges, so the date header
          stays glued to its top during vertical scroll, the KPI column
          to its left during horizontal scroll, and the corner cell to
          both. max-height caps the wrapper so the page-level layout
          stays balanced; the table scrolls inside it. */}
      {/* svh (small viewport height) accounts for mobile browser UI
          chrome (address bar, etc.) so the table area doesn't overflow
          when chrome is showing. Falls back to vh on browsers that
          don't support svh. */}
      <div className="overflow-auto max-h-[calc(100svh-280px)]">
        <table className="border-collapse bg-white text-xs">
          <thead>
            <tr>
              {/* Top-left corner — sticky in BOTH directions, highest z
                  so it overlays the date-header row and KPI column. */}
              <th className="sticky left-0 top-0 z-30 bg-[#f2f2f2] text-black uppercase tracking-wider text-[10px] font-bold border-r border-b-2 border-gray-400 px-2 py-2 text-left">
                KPI
              </th>
              {entries.map((entry) => (
                <th
                  key={entry.id}
                  className="sticky top-0 z-20 bg-[#f2f2f2] text-black uppercase tracking-wider text-[10px] font-bold border-r border-b-2 border-gray-400 px-2 py-2 text-right whitespace-nowrap"
                >
                  <div className="inline-flex items-center justify-end gap-1.5">
                    {/* Closed-week marker — small "C" badge tells the
                        coach scanning the table that this week's zeros
                        are intentional (business closed), not the
                        client forgetting to log. */}
                    {entry.closed && (
                      <span
                        title="Closed week — business was not operating"
                        className="inline-flex items-center justify-center bg-ink text-white text-[10px] font-bold rounded w-4 h-4"
                      >
                        C
                      </span>
                    )}
                    <span>
                      {formatEntryRange(
                        entry.week_start_date,
                        entry.days ?? 7
                      )}
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-gray-300">
                <td className="sticky left-0 z-10 bg-[#f2f2f2] text-black font-bold border-r border-gray-400 px-2 py-1.5 text-left whitespace-nowrap">
                  {row.label}
                </td>
                {entries.map((entry) => (
                  <Cell
                    key={entry.id}
                    row={row}
                    entry={entry}
                    client={client}
                    capacityGroups={groups}
                    monthlyGoal={monthlyGoalForEntry(entry)}
                    monthShares={monthShares}
                    kpiGoals={kpiGoals}
                    capacityGroupGoals={capacityGroupGoals}
                    enabledIds={enabledIds}
                    annualRevenue={annualRevenue}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {/* Spacer so the last data row clears the horizontal scrollbar that
            overlays the bottom edge. A real element's height is reliably part
            of the scroll content, unlike padding-bottom, which Chrome/Safari
            drop on scroll containers. */}
        <div aria-hidden className="h-4" />
      </div>
    </div>
  )
}

/** Single table cell — value formatted to the KPI's format, background
 *  colored against the per-entry pro-rated goal using the same banded
 *  thresholds (green / yellow / red) the dashboard uses. */
function Cell({
  row,
  entry,
  client,
  capacityGroups,
  monthlyGoal,
  monthShares,
  kpiGoals,
  capacityGroupGoals,
  enabledIds,
  annualRevenue,
}: {
  row: Row
  entry: WeeklyEntry
  client: Client
  capacityGroups: CapacityGroup[]
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  enabledIds: Set<string>
  annualRevenue: number | undefined
}) {
  const { value, goal, format, direction, range } = computeCell({
    row,
    entry,
    client,
    capacityGroups,
    monthlyGoal,
    monthShares,
    kpiGoals,
    capacityGroupGoals,
    enabledIds,
    annualRevenue,
  })

  const band = computeBand({ value, goal, direction, range })
  const cellClass = (() => {
    if (band === null) return 'bg-white text-black'
    if (band === 'green') return 'bg-good text-black'
    if (band === 'yellow') return 'bg-accent text-black'
    return 'bg-bad text-black'
  })()

  const display =
    value == null
      ? '—'
      : format === '$' || format === '#' || format === '%'
        ? formatKpiValue(value, format)
        : String(value)

  return (
    <td
      className={`px-2 py-1.5 text-right border-r border-gray-300 whitespace-nowrap ${cellClass}`}
    >
      {display}
    </td>
  )
}

/** Compute value + goal + format + direction + range for a row × entry pair.
 *  Returns null value/goal when not applicable / not entered. */
function computeCell({
  row,
  entry,
  client: _client,
  capacityGroups,
  monthlyGoal,
  monthShares,
  kpiGoals,
  capacityGroupGoals,
  enabledIds,
  annualRevenue,
}: {
  row: Row
  entry: WeeklyEntry
  client: Client
  capacityGroups: CapacityGroup[]
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  enabledIds: Set<string>
  annualRevenue: number | undefined
}): {
  value: number | null
  goal: number | null
  format: '$' | '%' | '#'
  direction: 'hi' | 'lo'
  range: boolean
} {
  if (row.kind === 'standard') {
    const value = actualValue(row.kpi.id, entry, capacityGroups)
    const goal = weeklyGoal({
      kpi: row.kpi,
      entry,
      client: _client,
      monthlyGoal,
      monthShares,
      kpiGoals,
      enabledIds,
      annualRevenue,
    })
    return {
      value,
      goal,
      format: row.kpi.format,
      direction: row.kpi.direction ?? 'hi',
      range: row.kpi.range ?? false,
    }
  }
  if (row.kind === 'custom') {
    const raw = (entry.kpi_values ?? {})[row.custom.id]
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : null
    // Same goal-periodicity as standard sum/$ KPIs: $/# goals are
    // stored ANNUAL on budget.goals and pro-rated to this entry's week
    // by month_share × (7 / days in month). % goals are flat rates.
    const goalRaw = kpiGoals[row.custom.id]
    let goal: number | null = null
    if (typeof goalRaw === 'number' && goalRaw !== 0) {
      if (row.custom.format === '%') {
        goal = goalRaw
      } else {
        const start = dateFromIso(entry.week_start_date)
        const m = start.getMonth()
        const y = start.getFullYear()
        const share = monthShares[m] ?? 1 / 12
        const frac = (entry.days ?? 7) / new Date(y, m + 1, 0).getDate()
        goal = goalRaw * share * frac
      }
    }
    return {
      value,
      goal,
      format: row.custom.format,
      direction: row.custom.direction,
      range: false,
    }
  }
  // capacity group derived rows
  const g = row.group
  const cv = (entry.capacity_values ?? {})[g.id]
  const cgGoal = capacityGroupGoals[g.id]
  if (row.subKind === 'utilization') {
    const value = capacityUtilizationPct(g, cv)
    // Utilization is always shown as %; map the stored goal into a %
    // target. Revenue-method groups whose goal is in $ convert via the
    // group's revenue capacity (target $ ÷ revCap × 100). Other methods
    // store % goals directly.
    let goalPct: number | null = null
    if (cgGoal && cgGoal.target > 0) {
      if (cgGoal.format === '%') {
        goalPct = cgGoal.target
      } else if (g.method === 'revenue') {
        const revCap = groupMaxCapacity(g)
        goalPct = revCap > 0 ? (cgGoal.target / revCap) * 100 : null
      }
    }
    return { value, goal: goalPct, format: '%', direction: 'hi', range: true }
  }
  if (row.subKind === 'laborHours') {
    const v = cv as { producedHours?: number } | undefined
    const produced = v?.producedHours ?? null
    const goal = cgGoal?.laborHoursGoal ?? null
    return {
      value: produced,
      goal: goal != null && goal > 0 ? goal : null,
      format: '#',
      direction: 'hi',
      range: true,
    }
  }
  // laborEfficiency
  const v = cv as { producedHours?: number } | undefined
  const produced = v?.producedHours ?? 0
  const working = groupWorkingHours(g)
  const pct = working > 0 ? (produced / working) * 100 : null
  const effGoal = cgGoal?.laborEfficiencyGoal ?? null
  return {
    value: pct,
    goal: effGoal != null && effGoal > 0 ? effGoal : null,
    format: '%',
    direction: 'hi',
    range: true,
  }
}

/** Capacity utilization actual % for a group + that entry's capacity value. */
function capacityUtilizationPct(
  group: CapacityGroup,
  cv: unknown
): number | null {
  const cap = groupMaxCapacity(group)
  if (group.method === 'manual') {
    const v = cv as { utilizationPct?: number } | undefined
    return v?.utilizationPct ?? group.staticUtilPct ?? null
  }
  if (!cap) return null
  if (group.method === 'slots') {
    const v = cv as { slotsFilled?: number } | undefined
    const filled = v?.slotsFilled ?? 0
    return (filled / cap) * 100
  }
  if (group.method === 'labor') {
    const v = cv as { producedHours?: number } | undefined
    const produced = v?.producedHours ?? 0
    return (produced / cap) * 100
  }
  if (group.method === 'revenue') {
    const v = cv as { revenueProduced?: number } | undefined
    const produced = v?.revenueProduced ?? 0
    return (produced / cap) * 100
  }
  if (group.method === 'headcount') {
    const v = cv as
      | {
          hoursWorked?: number
          departments?: Record<string, { hoursWorked: number }>
        }
      | undefined
    const legacy = Object.values(v?.departments ?? {}).reduce(
      (s, d) => s + (d.hoursWorked ?? 0),
      0
    )
    const totalWorked = v?.hoursWorked ?? legacy
    return (totalWorked / cap) * 100
  }
  return null
}

