// =============================================================================
// CumulativeKpiGrid — MTD / QTD / YTD tile grid
// =============================================================================
// Doc-08. Renders the same category structure as the weekly KpiGrid (Financials
// → Marketing → Sales [with Pipeline subsection] → Operations → Team → Overall
// Company → Custom), but every tile is a CumulativeTile pulling aggregated
// values + pace-adjusted goals from lib/cumulative.
//
// Capacity-group tiles and the laborHoursCompleted exclusion are deferred to
// Phase 8 step 6 — this grid renders standard + custom KPIs only.

import { findKpi } from '../lib/kpis'
import type {
  Budget,
  CapacityGroup,
  CapacityGroupGoal,
  Client,
  CustomKpi,
  WeeklyEntry,
} from '../lib/types'
import type { KpiDef, KpiCategory } from '../lib/kpis'
import { CATEGORIES } from '../lib/kpis'
import {
  aggregateCapacityValue,
  aggregateCustomKpi,
  aggregateKpi,
  getPeriodGoalFull,
  paceFrac,
  totalWeeksInPeriod,
  ytdActualsContribution,
  type Mode,
} from '../lib/cumulative'
import type { MonthlyGoal } from '../lib/budget'
import { visibleTileKpis } from '../lib/dashboardGoals'
import { groupMaxCapacity, groupWorkingHours } from '../lib/capacity'
import { CumulativeTile } from './CumulativeTile'
import { InfoIcon } from './InfoIcon'
import { formatValue } from './KpiTile'

type Props = {
  client: Client
  /** Active cumulative mode (mtd / qtd / ytd — never 'weekly' here). */
  mode: Exclude<Mode, 'weekly'>
  /** Year of the active period (today's year). */
  year: number
  /** Month index 0-11 — used to pick the quarter for QTD and the
   *  specific month for MTD. */
  month: number
  /** Entries already filtered down to this period. */
  entriesInPeriod: WeeklyEntry[]
  /** Full budget row — needed to resolve YTD-actuals contributions. */
  budget: Budget | null
  /** Per-month financial goals from the budget engine. Null when no
   *  budget exists yet. */
  monthlyGoals: MonthlyGoal[] | null
  /** monthShareFractions output — 12 floats summing to 1.0. */
  monthShares: number[]
  /** budget.goals — annual amounts for sum/$ KPIs, raw for %/avg/last. */
  kpiGoals: Record<string, number>
  /** Currently-enabled KPI ids — drives mutex resolution on derived goals. */
  enabledIds: Set<string>
  /** Annual income target from budget.annual_revenue. */
  annualRevenue: number | undefined
  /** Capacity group goals — unused at this step, threaded through for
   *  the upcoming capacity rollup (step 6). */
  capacityGroupGoals: Record<string, CapacityGroupGoal>
}

export function CumulativeKpiGrid({
  client,
  mode,
  year,
  month,
  entriesInPeriod,
  budget,
  monthlyGoals,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  capacityGroupGoals,
}: Props) {
  // Pre-coaching YTD actuals fold into Revenue/COGS/Expenses (and the
  // derived GP/NP) for YTD mode and any QTD month that comes after
  // ytd_thru_month. weeksCovered bumps currentWeeks so pace accounts
  // for the months we already have actuals for.
  const ytd = ytdActualsContribution(budget, mode, year, month)

  const weeksInPeriod = totalWeeksInPeriod(mode, year, month)
  const currentWeeks = entriesInPeriod.length + ytd.weeksCovered
  const pace = paceFrac(currentWeeks, weeksInPeriod)

  const visible = visibleTileKpis(client)
  const customKpis = (client.custom_kpis ?? []).filter(
    (c) => c.active !== false
  )
  const capacityGroups =
    Number(client.kpis?.capacityUtilization) === 1
      ? client.capacity_groups ?? []
      : []

  return (
    <div className="space-y-5">
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat}
          category={cat}
          mode={mode}
          month={month}
          entries={entriesInPeriod}
          pace={pace}
          ytdExtra={ytd.contribution}
          monthlyGoals={monthlyGoals}
          monthShares={monthShares}
          kpiGoals={kpiGoals}
          enabledIds={enabledIds}
          annualRevenue={annualRevenue}
          standardKpis={visible.filter((k) => k.category === cat)}
          customKpis={customKpis.filter((c) => c.category === cat)}
          capacityGroups={cat === 'Team' ? capacityGroups : []}
          capacityGroupGoals={capacityGroupGoals}
          weeksInPeriod={weeksInPeriod}
        />
      ))}
    </div>
  )
}

// =============================================================================
// Per-category section — header + tile grid (+ Pipeline subsection on Sales)
// =============================================================================

function CategorySection({
  category,
  mode,
  month,
  entries,
  pace,
  ytdExtra,
  monthlyGoals,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  standardKpis,
  customKpis,
  capacityGroups,
  capacityGroupGoals,
  weeksInPeriod,
}: {
  category: KpiCategory
  mode: Exclude<Mode, 'weekly'>
  month: number
  entries: WeeklyEntry[]
  pace: number
  ytdExtra: Record<string, number>
  monthlyGoals: MonthlyGoal[] | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  standardKpis: KpiDef[]
  customKpis: CustomKpi[]
  capacityGroups: CapacityGroup[]
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  weeksInPeriod: number
}) {
  if (
    standardKpis.length === 0 &&
    customKpis.length === 0 &&
    capacityGroups.length === 0
  )
    return null

  // Same Sales split as the weekly grid: Pipeline KPIs render as their
  // own sub-section under the Sales card.
  const pipelineIds = new Set<string>([
    'pipelineValue',
    'pipelineDeals',
    'avgPipelineDeal',
  ])
  // Same primary-KPI set as the weekly dashboard: department output
  // measures get a tall, double-height tile at the top of their
  // category.
  const primaryKpiIds = new Set<string>([
    'revenue',
    'grossProfit',
    'newClients',
    'estimatesWonDollars',
    'contractsWonDollars',
    'jobsCompleted',
  ])
  const mainKpis =
    category === 'Sales'
      ? standardKpis.filter((k) => !pipelineIds.has(k.id))
      : standardKpis
  const pipelineKpis =
    category === 'Sales'
      ? standardKpis.filter((k) => pipelineIds.has(k.id))
      : []
  const primaries = mainKpis.filter((k) => primaryKpiIds.has(k.id))
  const regulars = mainKpis.filter((k) => !primaryKpiIds.has(k.id))

  const renderStandardTile = (kpi: KpiDef, opts?: { tall?: boolean }) => (
    <CumulativeStandardTile
      key={kpi.id}
      kpi={kpi}
      mode={mode}
      month={month}
      entries={entries}
      pace={pace}
      ytdExtra={ytdExtra}
      monthlyGoals={monthlyGoals}
      monthShares={monthShares}
      kpiGoals={kpiGoals}
      enabledIds={enabledIds}
      annualRevenue={annualRevenue}
      tall={opts?.tall ?? false}
    />
  )

  return (
    <div>
      <div className="text-base font-bold text-ink uppercase tracking-wider pb-1 mb-3 border-b-2 border-accent">
        {category}
      </div>
      {(primaries.length > 0 || category === 'Financials') && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-stretch mb-4">
          {primaries.map((kpi) => (
            <div key={kpi.id} className="md:col-span-1">
              {renderStandardTile(kpi, { tall: true })}
            </div>
          ))}
          {category === 'Financials' && (
            <div className="md:col-span-1">
              <GapToGoalTile
                mode={mode}
                month={month}
                entries={entries}
                ytdExtra={ytdExtra}
                monthlyGoals={monthlyGoals}
                monthShares={monthShares}
                kpiGoals={kpiGoals}
                enabledIds={enabledIds}
                annualRevenue={annualRevenue}
              />
            </div>
          )}
        </div>
      )}
      {(regulars.length > 0 || customKpis.length > 0) && (
        <TileGrid>
          {regulars.map((kpi) => renderStandardTile(kpi))}
          {customKpis.map((c) => (
            <CumulativeCustomTile
              key={c.id}
              custom={c}
              entries={entries}
              pace={pace}
              kpiGoals={kpiGoals}
              mode={mode}
              month={month}
              monthShares={monthShares}
            />
          ))}
        </TileGrid>
      )}
      {pipelineKpis.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-ink uppercase tracking-wider pb-1 mb-2 border-b border-line">
            Pipeline
          </div>
          <TileGrid>{pipelineKpis.map((kpi) => renderStandardTile(kpi))}</TileGrid>
        </div>
      )}
      {/* Capacity group subsections — one per group, with tiles for
          Utilization (always), Labor Hours Produced + Labor Efficiency
          (labor method only). Doc-08: raw values sum across entries;
          full goals scale by weeksInPeriod; color is pace-based. */}
      {capacityGroups.map((g, i) => (
        <div
          key={g.id}
          className={
            i > 0 || standardKpis.length > 0 || customKpis.length > 0
              ? 'mt-4'
              : ''
          }
        >
          <div className="text-xs font-bold text-ink uppercase tracking-wider pb-1 mb-2 border-b border-line">
            {g.name || 'Untitled group'}
          </div>
          <TileGrid>
            <CumulativeCapacityTile
              group={g}
              entries={entries}
              goal={capacityGroupGoals[g.id]}
              pace={pace}
              weeksInPeriod={weeksInPeriod}
            />
            {g.method === 'labor' && (
              <>
                <CumulativeLaborHoursTile
                  group={g}
                  entries={entries}
                  goal={capacityGroupGoals[g.id]?.laborHoursGoal}
                  pace={pace}
                  weeksInPeriod={weeksInPeriod}
                />
                {!g.hideLaborEfficiency && (
                  <CumulativeLaborEfficiencyTile
                    group={g}
                    entries={entries}
                    goal={capacityGroupGoals[g.id]?.laborEfficiencyGoal}
                    weeksInPeriod={weeksInPeriod}
                  />
                )}
              </>
            )}
          </TileGrid>
        </div>
      ))}
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
// Individual tile renderers
// =============================================================================

function CumulativeStandardTile({
  kpi,
  mode,
  month,
  entries,
  pace,
  ytdExtra,
  monthlyGoals,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  tall = false,
}: {
  kpi: KpiDef
  mode: Exclude<Mode, 'weekly'>
  month: number
  entries: WeeklyEntry[]
  pace: number
  ytdExtra: Record<string, number>
  monthlyGoals: MonthlyGoal[] | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  tall?: boolean
}) {
  const value = aggregateKpi(kpi, entries, ytdExtra)
  const fullGoal = getPeriodGoalFull({
    kpi,
    mode,
    month,
    monthlyGoals,
    monthShares,
    kpiGoals,
    enabledIds,
    annualRevenue,
  })

  // Sum KPIs (and dollar-summed derived KPIs) scale their goal with the
  // period — paceGoal is fullGoal × paceFrac. Per-unit values (%, avg,
  // last, ratio-style derived) use the full goal as the pace goal too,
  // since "a 60% conversion rate is 60% whether MTD or YTD."
  const scalesWithPace =
    kpi.format !== '%' &&
    !kpi.range &&
    (kpi.aggregation === 'sum' ||
      // Financials grossProfit / netProfit are derived $ that DO scale,
      // because they're sums of period-summed inputs.
      kpi.id === 'grossProfit' ||
      kpi.id === 'netProfit')
  const paceGoal =
    fullGoal != null && scalesWithPace ? fullGoal * pace : fullGoal

  return (
    <CumulativeTile
      label={kpi.label}
      desc={kpi.desc}
      format={kpi.format}
      direction={kpi.direction ?? 'hi'}
      value={value}
      fullGoal={fullGoal}
      paceGoal={paceGoal}
      range={kpi.range}
      // Direction='lo' accumulators (Expenses) shouldn't flash
      // "Achieved!" early in the period — they're under-goal by
      // construction until the very end.
      hideAchieved={(kpi.direction ?? 'hi') === 'lo'}
      tall={tall}
    />
  )
}

function CumulativeCustomTile({
  custom,
  entries,
  pace,
  kpiGoals,
  mode,
  month,
  monthShares,
}: {
  custom: CustomKpi
  entries: WeeklyEntry[]
  pace: number
  kpiGoals: Record<string, number>
  mode: Exclude<Mode, 'weekly'>
  month: number
  monthShares: number[]
}) {
  const value = aggregateCustomKpi(custom, entries)
  // Custom KPIs follow the same goal-periodicity rule as standard sum
  // KPIs: $/# goals are stored annual, % is raw rate.
  const rawGoal = kpiGoals[custom.id]
  let fullGoal: number | null = null
  let paceGoal: number | null = null
  if (typeof rawGoal === 'number' && Number.isFinite(rawGoal)) {
    if (custom.format === '%') {
      fullGoal = rawGoal
      paceGoal = rawGoal
    } else {
      const share =
        mode === 'mtd'
          ? monthShares[month] ?? 1 / 12
          : mode === 'qtd'
            ? sumQuarterShares(month, monthShares)
            : 1
      fullGoal = rawGoal * share
      paceGoal = fullGoal * pace
    }
  }
  return (
    <CumulativeTile
      label={custom.name}
      format={custom.format}
      direction={custom.direction ?? 'hi'}
      value={value}
      fullGoal={fullGoal}
      paceGoal={paceGoal}
    />
  )
}

function sumQuarterShares(month: number, monthShares: number[]): number {
  const q = Math.floor(month / 3)
  let s = 0
  for (let i = 0; i < 3; i++) s += monthShares[q * 3 + i] ?? 1 / 12
  return s
}

// =============================================================================
// Gap-to-Goal — "Revenue Needed This [Period]" callout for Financials
// =============================================================================
//
// Doc-08: a cumulative-only tile that answers "how much more income do I
// need to bring in to hit my Gross Profit goal for this period?" Skipped
// when any input is missing (no GP goal, no GP% set, no GP yet).

function periodUnitLabel(mode: Exclude<Mode, 'weekly'>): string {
  if (mode === 'mtd') return 'Month'
  if (mode === 'qtd') return 'Quarter'
  return 'Year'
}

function GapToGoalTile({
  mode,
  month,
  entries,
  ytdExtra,
  monthlyGoals,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
}: {
  mode: Exclude<Mode, 'weekly'>
  month: number
  entries: WeeklyEntry[]
  ytdExtra: Record<string, number>
  monthlyGoals: MonthlyGoal[] | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
}) {
  const gpKpi = findKpi('grossProfit')
  if (!gpKpi) return null

  const gpActual = aggregateKpi(gpKpi, entries, ytdExtra)
  const gpGoal = getPeriodGoalFull({
    kpi: gpKpi,
    mode,
    month,
    monthlyGoals,
    monthShares,
    kpiGoals,
    enabledIds,
    annualRevenue,
  })
  const gpMarginGoal = monthlyGoals?.[month]?.gpPct ?? null

  // Silently skip when any input is missing — the tile only appears when
  // it can actually answer the question.
  if (gpActual == null || gpGoal == null || !gpMarginGoal || gpMarginGoal <= 0)
    return null

  const gpShort = gpGoal - gpActual
  const met = gpShort <= 0
  const revenueNeeded = met ? 0 : gpShort / (gpMarginGoal / 100)

  const unit = periodUnitLabel(mode)
  const unitLower = unit.toLowerCase()
  return (
    <div className="bg-ink rounded-lg p-3 min-h-[220px] flex flex-col">
      <div className="flex items-center gap-0.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          Revenue Needed This {unit}
        </div>
        <InfoIcon
          text={`How much more income you need to bring in to hit your ${unitLower} Gross Profit goal. Could be different from your current revenue goal due to this period's gross profit performance.`}
        />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        {met ? (
          <div className="text-3xl font-semibold leading-none text-good">
            GP Goal Met!
          </div>
        ) : (
          <div className="text-3xl font-semibold leading-none text-white">
            {formatValue(revenueNeeded, '$')}
          </div>
        )}
        <div className="text-sm text-white mt-1">To hit GP goal</div>
      </div>
    </div>
  )
}

// =============================================================================
// Capacity-group cumulative tiles
// =============================================================================
//
// Doc-08: per-group tiles in Team. Raw values sum across in-period entries
// regardless of method (working hours, labor hours, revenue $). The full
// goal scales by weeksInPeriod (capacity × weeks-in-period); pace goal =
// full × paceFrac. Utilization KPIs (% goals) don't scale — a 75% target
// is 75% whether MTD or YTD.

const TEAM_CAPACITY_DESC =
  'Capacity is the maximum the team can produce in a week without overworking or working overtime.'

function CumulativeCapacityTile({
  group,
  entries,
  goal,
  pace,
  weeksInPeriod,
}: {
  group: CapacityGroup
  entries: WeeklyEntry[]
  goal: CapacityGroupGoal | undefined
  pace: number
  weeksInPeriod: number
}) {
  const value = aggregateCapacityValue(group, entries)
  const cap = groupMaxCapacity(group)
  const cumCap = cap * weeksInPeriod
  const utilPct =
    cumCap > 0 && value != null ? (value / cumCap) * 100 : null

  // The raw value carries the group's unit. Manual is the exception —
  // the input IS already a % so there's no separate raw count, and the
  // tile just shows that %.
  let valueText = '—'
  if (value != null) {
    if (group.method === 'manual') {
      valueText = utilPct != null ? `${utilPct.toFixed(1)}%` : '—'
    } else if (group.method === 'slots') {
      valueText = `${Math.round(value).toLocaleString()} slots`
    } else if (group.method === 'labor' || group.method === 'headcount') {
      valueText = `${Math.round(value).toLocaleString()} hrs`
    } else if (group.method === 'revenue') {
      valueText = `$${Math.round(value).toLocaleString()}`
    }
  }
  const subLabel =
    group.method !== 'manual' && utilPct != null
      ? `${utilPct.toFixed(1)}% utilization`
      : undefined

  // Resolve goal + comparison anchor. For % utilization goals the
  // comparison is the cumulative util %; for $ goals on revenue groups
  // it's the cumulative dollars (and goal scales by weeksInPeriod).
  let bandValue: number | null = null
  let bandFullGoal: number | null = null
  let bandPaceGoal: number | null = null
  let goalText: string | undefined
  let paceText: string | undefined
  if (goal) {
    if (group.method === 'revenue' && goal.format === '$') {
      const target = goal.target * weeksInPeriod
      bandValue = value
      bandFullGoal = target
      bandPaceGoal = target * pace
      goalText = `$${Math.round(target).toLocaleString()}`
      paceText =
        bandPaceGoal != null
          ? `$${Math.round(bandPaceGoal).toLocaleString()}`
          : undefined
    } else if (group.method === 'revenue' && goal.format === '%') {
      // % of capacity goal on a revenue group — convert to $.
      const target = (cumCap * goal.target) / 100
      bandValue = value
      bandFullGoal = target
      bandPaceGoal = target * pace
      goalText = `$${Math.round(target).toLocaleString()}`
      paceText =
        bandPaceGoal != null
          ? `$${Math.round(bandPaceGoal).toLocaleString()}`
          : undefined
    } else if (goal.format === '$') {
      const target = goal.target * weeksInPeriod
      bandValue = value
      bandFullGoal = target
      bandPaceGoal = target * pace
      goalText = `$${Math.round(target).toLocaleString()}`
      paceText =
        bandPaceGoal != null
          ? `$${Math.round(bandPaceGoal).toLocaleString()}`
          : undefined
    } else {
      // % utilization goal — doesn't scale. Compare cumulative util %.
      bandValue = utilPct
      bandFullGoal = goal.target
      bandPaceGoal = goal.target
    }
  }

  return (
    <CumulativeTile
      label="Capacity Utilization"
      desc={TEAM_CAPACITY_DESC}
      format={goal?.format === '$' || group.method === 'revenue' ? '$' : '%'}
      direction="hi"
      value={bandValue}
      fullGoal={bandFullGoal}
      paceGoal={bandPaceGoal}
      valueText={valueText}
      subLabel={subLabel}
      goalText={goalText}
      paceText={paceText}
    />
  )
}

function CumulativeLaborHoursTile({
  group,
  entries,
  goal,
  pace,
  weeksInPeriod,
}: {
  group: CapacityGroup
  entries: WeeklyEntry[]
  goal: number | undefined
  pace: number
  weeksInPeriod: number
}) {
  // Sum producedHours across in-period entries.
  let total = 0
  let any = false
  for (const e of entries) {
    const cv = (e.capacity_values ?? {})[group.id] as
      | { producedHours?: number }
      | undefined
    if (
      cv &&
      typeof cv.producedHours === 'number' &&
      Number.isFinite(cv.producedHours)
    ) {
      total += cv.producedHours
      any = true
    }
  }
  const value = any ? total : null
  const fullGoal = goal && goal > 0 ? goal * weeksInPeriod : null
  const paceGoal = fullGoal != null ? fullGoal * pace : null

  return (
    <CumulativeTile
      label="Labor Hours Produced"
      desc="Productive labor hours generated by this team in the period."
      format="#"
      direction="hi"
      value={value}
      fullGoal={fullGoal}
      paceGoal={paceGoal}
      valueText={value != null ? `${Math.round(value).toLocaleString()} hrs` : '—'}
      goalText={
        fullGoal != null
          ? `${Math.round(fullGoal).toLocaleString()} hrs`
          : undefined
      }
      paceText={
        paceGoal != null
          ? `${Math.round(paceGoal).toLocaleString()} hrs`
          : undefined
      }
    />
  )
}

function CumulativeLaborEfficiencyTile({
  group,
  entries,
  goal,
  weeksInPeriod,
}: {
  group: CapacityGroup
  entries: WeeklyEntry[]
  goal: number | undefined
  weeksInPeriod: number
}) {
  // Efficiency = sum(producedHours) / (workingHours × weeksInPeriod) × 100.
  let total = 0
  let any = false
  for (const e of entries) {
    const cv = (e.capacity_values ?? {})[group.id] as
      | { producedHours?: number }
      | undefined
    if (
      cv &&
      typeof cv.producedHours === 'number' &&
      Number.isFinite(cv.producedHours)
    ) {
      total += cv.producedHours
      any = true
    }
  }
  const working = groupWorkingHours(group)
  const cumWorking = working * weeksInPeriod
  const pct = any && cumWorking > 0 ? (total / cumWorking) * 100 : null

  return (
    <CumulativeTile
      label="Labor Efficiency"
      desc="How productively the team used their scheduled time across this period."
      format="%"
      direction="hi"
      value={pct}
      fullGoal={goal && goal > 0 ? goal : null}
      paceGoal={goal && goal > 0 ? goal : null}
      subLabel={
        any && cumWorking > 0
          ? `${Math.round(total).toLocaleString()} / ${Math.round(
              cumWorking
            ).toLocaleString()} hrs`
          : undefined
      }
    />
  )
}
