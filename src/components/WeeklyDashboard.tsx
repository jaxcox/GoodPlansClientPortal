import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, KPIS } from '../lib/kpis'
import type { KpiCategory, KpiDef } from '../lib/kpis'
import type {
  Budget,
  CapacityGroup,
  CapacityGroupGoal,
  Client,
  CustomKpi,
  WeeklyEntry,
} from '../lib/types'
import { computeBudgetView, emptyMonthArray } from '../lib/budget'
import type { MonthlyGoal } from '../lib/budget'
import {
  actualValue,
  monthShareFractions,
  visibleTileKpis,
  weeklyGoal,
} from '../lib/dashboardGoals'
import {
  totalCapacityHours,
  totalRevenueCapacity,
} from '../lib/capacity'
import {
  dateFromIso,
  formatWeekShort,
  isoDate,
  mostRecentCompletedWeekStart,
  shiftWeek,
} from '../lib/week'
import { KpiTile } from './KpiTile'
import { CoachNoteBlock } from './CoachNoteBlock'
import { InfoIcon } from './InfoIcon'

/** Tooltip text for every Capacity Utilization tile. Generic across all
 *  capacity groups (Body Team, Estimator Team, etc.) and clearly
 *  distinguishes capacity utilization from Labor Efficiency, which
 *  measures a different thing. Kept in sync with the same description on
 *  the Budget & Goals → Capacity & Utilization section header. */
export const TEAM_CAPACITY_DESC =
  "What share of the team's available weekly capacity was used. Capacity is the maximum amount of work or money the team can produce in a week without overworking or working overtime. Different from Labor Efficiency, which measures productivity per working hour."

// =============================================================================
// Phase 5b — Weekly Dashboard
// =============================================================================
// Shows the most recent weekly entry as a grid of KPI tiles, color-coded
// against weekly goals (annual-target × season_pct × 7/days-in-month for
// sum/$ KPIs; pass-through for %/avg/last). Categories: Financials →
// Marketing → Sales (with Pipeline subsection) → Operations → Team →
// Overall Company. Custom KPIs render in their assigned categories.
// Capacity groups render as tiles in Team.
//
// Mode pills (Weekly / MTD / QTD / YTD) are rendered as a visual element
// only — Weekly is the active mode; clicking another pill does nothing
// for now (Phase 6 wires up MTD/QTD/YTD cumulative views).
// =============================================================================

type Props = {
  clientId: string
  coachView: boolean
}

type Mode = 'weekly' | 'mtd' | 'qtd' | 'ytd'

export function WeeklyDashboard({ clientId, coachView }: Props) {
  const [client, setClient] = useState<Client | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [entries, setEntries] = useState<WeeklyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('weekly')

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    const year = new Date().getFullYear()
    const [cRes, bRes, eRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
      supabase
        .from('budgets')
        .select('*')
        .eq('client_id', clientId)
        .eq('year', year)
        .maybeSingle(),
      supabase
        .from('weekly_entries')
        .select('*')
        .eq('client_id', clientId)
        .order('week_start_date', { ascending: false })
        .limit(60),
    ])
    if (cRes.error) {
      setError(cRes.error.message)
      setLoading(false)
      return
    }
    setClient(cRes.data as Client | null)
    setBudget((bRes.data as Budget | null) ?? null)
    setEntries(((eRes.data as WeeklyEntry[] | null) ?? []) as WeeklyEntry[])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [clientId])

  // Pick the entry to display: prefer the current Sunday's entry; fall
  // back to the most recent entry by date.
  const { displayedEntry, isCurrentWeek, mostRecentDateIso } = useMemo(() => {
    if (entries.length === 0)
      return {
        displayedEntry: null as WeeklyEntry | null,
        isCurrentWeek: false,
        mostRecentDateIso: null as string | null,
      }
    const currentSunIso = isoDate(mostRecentCompletedWeekStart())
    const current = entries.find((e) => e.week_start_date === currentSunIso)
    const mostRecent = entries[0]
    return {
      displayedEntry: current ?? mostRecent,
      isCurrentWeek: !!current,
      mostRecentDateIso: mostRecent?.week_start_date ?? null,
    }
  }, [entries])

  // Prior-week entry for week-over-week deltas: exactly 7 days before the
  // displayed entry. Null when no such row exists.
  const priorEntry = useMemo(() => {
    if (!displayedEntry) return null
    const prevIso = isoDate(
      shiftWeek(dateFromIso(displayedEntry.week_start_date), -1)
    )
    return entries.find((e) => e.week_start_date === prevIso) ?? null
  }, [entries, displayedEntry])

  // Compute the budget view for the entry's year. Returns null if no
  // budget exists yet. GP% derives from cogs_target_pct (which is what the
  // DB stores — Budget & Goals form just inverts it for display).
  const budgetView = useMemo(() => {
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
      seasonType: (budget.season_type ?? 'even') as Budget['season_type'],
      seasonPct: (budget.season_pct as number[] | null) ?? [],
      ytdThruMonth: budget.ytd_thru_month ?? null,
      ytdRevenueByMonth:
        (budget.ytd_revenue_by_month as (number | null)[] | null) ?? null,
      ytdCogsByMonth:
        (budget.ytd_cogs_by_month as (number | null)[] | null) ?? null,
      ytdExpensesByMonth:
        (budget.ytd_expenses_by_month as (number | null)[] | null) ??
        emptyMonthArray(),
    })
  }, [budget])

  // Per-month share fractions summing to 1.0 — same math the budget engine
  // uses internally. Drives every non-financial weekly goal (sum/$ KPIs).
  const monthShares = useMemo(
    () =>
      monthShareFractions(
        (budget?.season_type ?? 'even') as Budget['season_type'],
        (budget?.season_pct as number[] | null) ?? []
      ),
    [budget]
  )

  // Find the MonthlyGoal for whichever month the displayed entry's Sunday
  // belongs to.
  const entryMonthlyGoal: MonthlyGoal | null = useMemo(() => {
    if (!displayedEntry || !budgetView) return null
    const month = dateFromIso(displayedEntry.week_start_date).getMonth()
    return budgetView.months.find((m) => m.monthIdx === month) ?? null
  }, [displayedEntry, budgetView])

  // KPI annual goals — live on the budget, NOT on client.kpis (that's the
  // active-toggle map keyed by KPI id with 0/1 values).
  const kpiGoals = (budget?.goals ?? {}) as Record<string, number>

  // Which KPI ids are currently enabled per client.kpis. Used when picking
  // between mutex partners (e.g. closeRate's won-dollars source) in
  // deriveAnnualGoal.
  const enabledIds = useMemo(() => {
    const out = new Set<string>()
    for (const [id, v] of Object.entries(client?.kpis ?? {})) {
      if (Number(v) === 1) out.add(id)
    }
    return out
  }, [client])

  // ---- Render --------------------------------------------------------------

  if (loading)
    return <div className="text-black text-sm">Loading dashboard…</div>
  if (error)
    return (
      <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
        {error}
      </div>
    )
  if (!client) return null

  return (
    <section className="space-y-4">
      <Header
        clientName={client.company_name}
        mode={mode}
        onMode={setMode}
        displayedEntry={displayedEntry}
        isCurrentWeek={isCurrentWeek}
        mostRecentDateIso={mostRecentDateIso}
      />

      {/* No-entry overdue banner — slim red strip when the current week
          has no entry but older entries exist. */}
      {!isCurrentWeek && displayedEntry && (
        <OverdueBanner mostRecentDateIso={mostRecentDateIso!} />
      )}

      {/* Coach Note block at the top — coach edits, client reads. Empty
          on client view if no note exists. Constrained to the width of one
          KPI tile so it doesn't dominate the dashboard. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <CoachNoteBlock
          clientId={clientId}
          note={client.coach_note}
          updatedAt={client.coach_note_updated_at}
          coachView={coachView}
          onSaved={loadAll}
        />
      </div>

      {/* Empty state — no entries at all */}
      {entries.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
          No entries yet. Go to <strong>Weekly Entry</strong> to log your
          first week.
        </div>
      )}

      {/* KPI grid */}
      {displayedEntry && (
        <KpiGrid
          client={client}
          entry={displayedEntry}
          priorEntry={priorEntry}
          monthlyGoal={entryMonthlyGoal}
          monthShares={monthShares}
          kpiGoals={kpiGoals}
          enabledIds={enabledIds}
          annualRevenue={
            budget?.annual_revenue != null
              ? Number(budget.annual_revenue)
              : undefined
          }
          capacityGroupGoals={
            (budget?.capacity_group_goals ?? {}) as Record<
              string,
              CapacityGroupGoal
            >
          }
        />
      )}

      {/* Notes block for the displayed entry (different from coach notes:
          this is the per-week note typed on Weekly Entry) */}
      {displayedEntry?.notes && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-black mb-1">
            Notes for {formatWeekShort(dateFromIso(displayedEntry.week_start_date))}
          </div>
          <div className="text-sm text-black whitespace-pre-wrap leading-relaxed">
            {displayedEntry.notes}
          </div>
        </div>
      )}
    </section>
  )
}

// =============================================================================
// Header — title + mode pills + most-recent-entry pill
// =============================================================================

function Header({
  mode,
  onMode,
  displayedEntry,
  isCurrentWeek,
  mostRecentDateIso,
}: {
  clientName: string
  mode: Mode
  onMode: (m: Mode) => void
  displayedEntry: WeeklyEntry | null
  isCurrentWeek: boolean
  mostRecentDateIso: string | null
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-lg font-bold text-ink">Performance Dashboard</h1>
        <ModePills mode={mode} onMode={onMode} />
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs">
        {!displayedEntry ? (
          <span className="bg-ink text-white px-3 py-1 rounded font-semibold">
            No entries yet
          </span>
        ) : isCurrentWeek ? (
          <span className="bg-ink text-white px-3 py-1 rounded font-semibold">
            Week of{' '}
            {formatWeekShort(dateFromIso(displayedEntry.week_start_date))}
          </span>
        ) : (
          <span className="bg-bad text-white px-3 py-1 rounded font-semibold">
            ⚠ Entry overdue · last entry{' '}
            {formatWeekShort(dateFromIso(mostRecentDateIso!))}
          </span>
        )}
      </div>
    </div>
  )
}

function ModePills({
  mode,
  onMode,
}: {
  mode: Mode
  onMode: (m: Mode) => void
}) {
  const pill = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => onMode(m)}
      title={m === 'weekly' ? undefined : 'Cumulative views coming soon'}
      className={`px-3 py-1.5 rounded text-xs font-bold border ${
        mode === m
          ? 'bg-ink text-accent border-line'
          : 'bg-transparent text-black border-gray-400'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap gap-1">
      {pill('weekly', 'Weekly')}
      {pill('mtd', 'MTD')}
      {pill('qtd', 'QTD')}
      {pill('ytd', 'YTD')}
    </div>
  )
}

function OverdueBanner({ mostRecentDateIso }: { mostRecentDateIso: string }) {
  return (
    <div className="bg-bad text-white text-sm rounded-lg p-3 flex flex-wrap justify-between items-center gap-2">
      <span>
        <strong>Weekly entry overdue.</strong> Last entry{' '}
        {formatWeekShort(dateFromIso(mostRecentDateIso))} — your dashboard
        can't reflect this week until you log it.
      </span>
    </div>
  )
}

// =============================================================================
// KPI Grid — all categories, all tiles
// =============================================================================

function KpiGrid({
  client,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  capacityGroupGoals,
}: {
  client: Client
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  capacityGroupGoals: Record<string, CapacityGroupGoal>
}) {
  const visible = visibleTileKpis(client)
  const customKpis = (client.custom_kpis ?? []).filter(
    (c) => c.active !== false
  )

  return (
    <div className="space-y-5">
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat}
          category={cat}
          client={client}
          entry={entry}
          priorEntry={priorEntry}
          monthlyGoal={monthlyGoal}
          monthShares={monthShares}
          kpiGoals={kpiGoals}
          enabledIds={enabledIds}
          annualRevenue={annualRevenue}
          capacityGroupGoals={capacityGroupGoals}
          standardKpis={visible.filter((k) => k.category === cat)}
          customKpis={customKpis.filter((c) => c.category === cat)}
          capacityGroups={cat === 'Team' ? client.capacity_groups ?? [] : []}
        />
      ))}
    </div>
  )
}

function CategorySection({
  category,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  capacityGroupGoals,
  client,
  standardKpis,
  customKpis,
  capacityGroups,
}: {
  category: KpiCategory
  client: Client
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  standardKpis: ReturnType<typeof visibleTileKpis>
  customKpis: CustomKpi[]
  capacityGroups: CapacityGroup[]
}) {
  // Hide categories with nothing in them. Empty Overall Company never
  // renders a header.
  const hasContent =
    standardKpis.length > 0 ||
    customKpis.length > 0 ||
    capacityGroups.length > 0
  if (!hasContent) return null

  // Sales gets a Pipeline subsection — KPIs whose category is 'Sales'
  // AND whose label contains 'Pipeline'. Everything else stays in main.
  // (Per Jackie's spec: dropped the Estimating subsection. The Estimates
  // Written / # of Estimates / Avg Estimate KPIs now flow into main Sales.)
  const pipelineIds = new Set<string>([
    'pipelineValue',
    'pipelineDeals',
    'avgPipelineDeal',
  ])
  const mainSales =
    category === 'Sales'
      ? standardKpis.filter((k) => !pipelineIds.has(k.id))
      : standardKpis
  const pipelineSales =
    category === 'Sales'
      ? standardKpis.filter((k) => pipelineIds.has(k.id))
      : []

  return (
    <div>
      <div className="text-xs font-bold text-ink uppercase tracking-wider pb-1 mb-3 border-b-2 border-accent">
        {category}
      </div>

      <TileGrid>
        {mainSales.map((kpi) => (
          <StandardTile
            key={kpi.id}
            kpi={kpi}
            entry={entry}
            priorEntry={priorEntry}
            monthlyGoal={monthlyGoal}
            monthShares={monthShares}
            kpiGoals={kpiGoals}
            enabledIds={enabledIds}
            annualRevenue={annualRevenue}
            client={client}
          />
        ))}
        {customKpis.map((c) => (
          <CustomTile
            key={c.id}
            custom={c}
            entry={entry}
            priorEntry={priorEntry}
            goal={kpiGoals[c.id]}
          />
        ))}
        {/* Capacity tiles render in Team only, after standard + custom KPIs.
            Goal source: per-group goal in budget.capacity_group_goals if
            set, otherwise the standard teamCapacity % is used as a
            consistent fallback for every group regardless of method. The
            tile converts the % to the group's native unit (e.g. revenue
            method: 85% × team $ capacity = $ target). */}
        {capacityGroups.map((g) => {
          const perGroup = capacityGroupGoals[g.id]
          const fallback =
            kpiGoals.teamCapacity != null
              ? ({
                  target: kpiGoals.teamCapacity,
                  format: '%',
                } as CapacityGroupGoal)
              : undefined
          return (
            <CapacityTile
              key={g.id}
              group={g}
              entry={entry}
              goal={perGroup ?? fallback}
            />
          )
        })}
      </TileGrid>

      {pipelineSales.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-ink uppercase tracking-wider pb-1 mb-2 border-b border-line">
            Pipeline
          </div>
          <TileGrid>
            {pipelineSales.map((kpi) => (
              <StandardTile
                key={kpi.id}
                kpi={kpi}
                entry={entry}
                priorEntry={priorEntry}
                monthlyGoal={monthlyGoal}
                monthShares={monthShares}
                kpiGoals={kpiGoals}
                enabledIds={enabledIds}
                annualRevenue={annualRevenue}
                client={client}
              />
            ))}
          </TileGrid>
        </div>
      )}
    </div>
  )
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      {children}
    </div>
  )
}

// =============================================================================
// Individual tile renderers (standard / custom / capacity)
// =============================================================================

function StandardTile({
  kpi,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  client,
}: {
  kpi: KpiDef
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  client: Client
}) {
  if (!kpi) return null
  const groups = client.capacity_groups ?? []
  const value = actualValue(kpi.id, entry, groups)
  const prior = priorEntry ? actualValue(kpi.id, priorEntry, groups) : null
  const delta =
    value != null && prior != null ? value - prior : null
  const goal = weeklyGoal({
    kpi,
    entry,
    client: {} as Client,
    monthlyGoal,
    monthShares,
    kpiGoals,
    enabledIds,
    annualRevenue,
  })

  return (
    <KpiTile
      label={kpi.label}
      desc={kpi.desc}
      format={kpi.format}
      direction={kpi.direction ?? 'hi'}
      value={value}
      goal={goal}
      delta={delta}
      range={kpi.range}
    />
  )
}

function CustomTile({
  custom,
  entry,
  priorEntry,
  goal,
}: {
  custom: CustomKpi
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  goal: number | undefined
}) {
  const value = (entry.kpi_values ?? {})[custom.id] ?? null
  const prior = priorEntry
    ? (priorEntry.kpi_values ?? {})[custom.id] ?? null
    : null
  const delta =
    value != null && prior != null ? Number(value) - Number(prior) : null

  // Custom KPI goals are STATIC — whatever the coach enters in Budget &
  // Goals is the per-period goal as-is. No annual-to-weekly pro-rating
  // (unlike standard sum/$ KPIs).
  const weeklyG = goal != null && goal !== 0 ? goal : null

  return (
    <KpiTile
      label={custom.name}
      format={custom.format}
      direction={custom.direction}
      value={value as number | null}
      goal={weeklyG}
      delta={delta}
      hideGoalPct
    />
  )
}

function CapacityTile({
  group,
  entry,
  goal,
}: {
  group: CapacityGroup
  entry: WeeklyEntry
  /** Capacity group goal from budget.capacity_group_goals[group.id]. */
  goal: CapacityGroupGoal | undefined
}) {
  const cv = (entry.capacity_values ?? {})[group.id]
  const totalCapacity = totalCapacityHours(group)

  // Two parallel "actual" values depending on the method:
  //   - actualPct: utilization % (used for labor / slots / manual /
  //     headcount tiles where the goal is also a utilization target)
  //   - actualDollars: produced $ for revenue-method groups (used when
  //     the goal is a dollar target)
  let actualPct: number | null = null
  let actualDollars: number | null = null
  let valueText = '—'
  let subLabel = ''

  if (group.method === 'manual') {
    const v = cv as { utilizationPct?: number } | undefined
    actualPct = v?.utilizationPct ?? group.staticUtilPct ?? null
    valueText = actualPct != null ? `${actualPct.toFixed(1)}%` : '—'
  } else if (group.method === 'slots') {
    const v = cv as { slotsFilled?: number; totalSlots?: number } | undefined
    const filled = v?.slotsFilled ?? 0
    const total = v?.totalSlots ?? totalCapacity
    actualPct = total ? (filled / total) * 100 : null
    valueText = actualPct != null ? `${actualPct.toFixed(1)}%` : '—'
    subLabel = `${filled} / ${total} slots`
  } else if (group.method === 'labor') {
    const v = cv as { producedHours?: number } | undefined
    const produced = v?.producedHours ?? 0
    actualPct = totalCapacity ? (produced / totalCapacity) * 100 : null
    valueText = actualPct != null ? `${actualPct.toFixed(1)}%` : '—'
    subLabel = `${produced} / ${totalCapacity} hrs`
  } else if (group.method === 'revenue') {
    const v = cv as { revenueProduced?: number } | undefined
    const produced = v?.revenueProduced ?? 0
    actualDollars = produced
    const cap = totalRevenueCapacity(group)
    // Big number is the $ produced; capacity goes on the sub-label so the
    // coach can see the headroom.
    valueText = `$${produced.toLocaleString()}`
    subLabel = `of $${cap.toLocaleString()} capacity`
  } else if (group.method === 'headcount') {
    const v = cv as
      | { departments?: Record<string, { hoursWorked: number }> }
      | undefined
    let totalWorked = 0
    for (const d of group.departments ?? []) {
      totalWorked += v?.departments?.[d.id]?.hoursWorked ?? 0
    }
    actualPct = totalCapacity ? (totalWorked / totalCapacity) * 100 : null
    valueText = actualPct != null ? `${actualPct.toFixed(1)}%` : '—'
    subLabel = `${totalWorked} / ${totalCapacity} hrs`
  }

  // Goal label + comparison.
  //   - For % goals on utilization methods (labor/slots/headcount/manual/
  //     revenue with $ goal): compare directly in native unit.
  //   - For % goals on revenue method: convert to $ target by multiplying
  //     the % by the team's revenue capacity, then compare $ vs $.
  //   - ±10% band in both cases.
  let goalLabel = 'No goal set'
  let onTrack: boolean | null = null
  if (goal) {
    if (group.method === 'revenue') {
      // Revenue method always compares in dollars. Convert % goals to a
      // dollar target by applying the % to the team's revenue capacity.
      const revCap = totalRevenueCapacity(group)
      const targetDollars =
        goal.format === '$' ? goal.target : (revCap * goal.target) / 100
      goalLabel = `Goal: $${Math.round(targetDollars).toLocaleString()} ±10%`
      if (actualDollars != null && targetDollars > 0) {
        onTrack =
          Math.abs(actualDollars - targetDollars) / targetDollars <= 0.1
      }
    } else if (goal.format === '$') {
      goalLabel = `Goal: $${goal.target.toLocaleString()} ±10%`
      if (actualDollars != null && goal.target > 0) {
        onTrack = Math.abs(actualDollars - goal.target) / goal.target <= 0.1
      }
    } else {
      goalLabel = `Goal: ${goal.target}% ±10%`
      if (actualPct != null) {
        onTrack = Math.abs(actualPct - goal.target) <= 10
      }
    }
  }

  const borderClass =
    onTrack == null
      ? 'border-line'
      : onTrack
        ? 'border-good'
        : 'border-bad'
  const footerColor =
    onTrack == null ? 'text-white' : onTrack ? 'text-good' : 'text-bad'

  return (
    <div
      className={`bg-ink rounded-lg p-3 border ${borderClass} min-h-[110px] flex flex-col`}
    >
      <div>
        <div className="flex items-center gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-white">
            Capacity Utilization
          </div>
          <InfoIcon text={TEAM_CAPACITY_DESC} />
        </div>
        <div className="text-xs text-white">{group.name}</div>
      </div>
      <div className="text-lg font-bold text-white mt-2">{valueText}</div>
      {subLabel && (
        <div className="text-xs text-white mt-1">{subLabel}</div>
      )}

      <div className="flex-1" />

      <div className={`border-t border-line pt-2 mt-2 text-xs ${footerColor}`}>
        <span>{goalLabel}</span>
      </div>
    </div>
  )
}
