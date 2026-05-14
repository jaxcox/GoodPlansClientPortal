// =============================================================================
// Weekly Dashboard goal computation.
//
// Per Doc 03 + the project memory note (project_kpi_goal_periodicity):
//   - sum/$ KPI goals are stored as ANNUAL amounts on client.kpis[id]
//   - dashboard math pro-rates by season_pct[month] × (entry.days / days_in_month)
//   - %/avg/last KPIs use the stored goal as-is (no pro-rate)
//   - Financials (Income/COGS/GP/GPM) derive from monthly goals computed by
//     computeBudgetView in lib/budget.ts
//
// For boundary weeks (Sun–Sat crossing a month boundary), the active behavior
// is: count the entire week to whichever month the Sunday falls in. Partial
// Period entries are parked (parking lot #4) — they'd split the week into two
// entries with their own .days each, but that's not implemented yet.
// =============================================================================

import { findKpi, KPIS } from './kpis'
import type { KpiDef } from './kpis'
import type {
  CapacityGroup,
  Client,
  SeasonType,
  WeeklyEntry,
} from './types'
import type { MonthlyGoal } from './budget'
import { dateFromIso } from './week'

/** Per-month share fractions summing to exactly 1.0 — matches the math
 *  computeBudgetView uses internally. Even mode = exact 1/12 (avoids the
 *  8.3%/8.7% display rounding in evenSeasonPct, which is for the UI).
 *  Seasonal mode normalizes the saved percentages by their total so they
 *  sum to 1 regardless of whether the user's row adds to exactly 100. */
export function monthShareFractions(
  seasonType: SeasonType,
  seasonPct: number[]
): number[] {
  if (seasonType === 'seasonal' && seasonPct.length === 12) {
    const total = seasonPct.reduce((a, b) => a + b, 0)
    if (total > 0) return seasonPct.map((p) => p / total)
  }
  return Array(12).fill(1 / 12)
}

// =============================================================================
// Derived KPI goal computation — produces the ANNUAL goal value for a
// derived KPI by composing related KPI goals. Used by both the Budget &
// Goals → KPI Goals card (to render the derived box live as inputs change)
// AND the Weekly Dashboard (to surface goals on derived tiles like Sales
// Close Rate or Avg Estimate Value when the underlying KPIs have goals).
// =============================================================================

function safeDivide(
  num: number | undefined,
  den: number | undefined
): number | null {
  if (!num || !den) return null
  return num / den
}

/** Pick whichever of contractsWonDollars / estimatesWonDollars is the
 *  currently-active won-dollars KPI for this client, and return its goal.
 *  Goals for the inactive sibling are ignored so stale values from a
 *  previous toggle state don't leak into derived calculations. */
function wonDollarsGoal(
  goals: Record<string, number>,
  enabledIds: Set<string>
): number | undefined {
  if (enabledIds.has('contractsWonDollars')) return goals['contractsWonDollars']
  if (enabledIds.has('estimatesWonDollars')) return goals['estimatesWonDollars']
  return undefined
}

export function deriveAnnualGoal(
  kpiId: string,
  goals: Record<string, number>,
  annualRevenue: number | undefined,
  enabledIds: Set<string>
): number | null {
  const g = (id: string) => goals[id]
  switch (kpiId) {
    case 'conversionRate': {
      const r = safeDivide(g('newClients'), g('leads'))
      return r === null ? null : r * 100
    }
    case 'avgEstimateValue':
      return safeDivide(g('proposalsDollars'), g('estimatesWritten'))
    case 'avgPipelineDeal':
      return safeDivide(g('pipelineValue'), g('pipelineDeals'))
    case 'closeRate': {
      const r = safeDivide(
        wonDollarsGoal(goals, enabledIds),
        g('proposalsDollars')
      )
      return r === null ? null : r * 100
    }
    case 'avgTransactionValue':
      return safeDivide(annualRevenue, g('transactions'))
    case 'avgRepairOrder':
      return safeDivide(annualRevenue, g('jobsCompleted'))
    case 'contractValuePerNewClient':
      return safeDivide(
        wonDollarsGoal(goals, enabledIds),
        g('newClients')
      )
    default:
      return null
  }
}

/** Days in `year`'s `month` (month is 0-indexed). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

/** Pro-rate fraction for a Sun–Sat full week: 7 / daysInMonth. Partial
 *  Period entries (parking lot #4) would carry a per-row days count; until
 *  that lands every entry is treated as a 7-day full week. */
function weekFraction(entry: WeeklyEntry): number {
  const startDate = dateFromIso(entry.week_start_date)
  const year = startDate.getFullYear()
  const month = startDate.getMonth()
  return 7 / daysInMonth(year, month)
}

type WeeklyGoalArgs = {
  kpi: KpiDef
  entry: WeeklyEntry
  client: Client
  /** Monthly goal for the entry's Sunday month. May be null if the budget
   *  hasn't been set yet. */
  monthlyGoal: MonthlyGoal | null
  /** Per-month share fractions summing to 1.0 (from monthShareFractions).
   *  NOT the percentage form — these are 0.0833... for even months. */
  monthShares: number[]
  /** All standard KPI goals (annual amounts) keyed by id. */
  kpiGoals: Record<string, number>
  /** Set of currently-enabled KPI ids for this client. Used by
   *  deriveAnnualGoal to pick between mutex partners (e.g. closeRate). */
  enabledIds: Set<string>
  /** Annual revenue target (from budget.annual_revenue). Used as the
   *  numerator for ratio KPIs like Avg Repair Order. */
  annualRevenue: number | undefined
}

/**
 * Compute the weekly goal for one KPI on one entry.
 * Returns null if no goal is set / can't be computed.
 */
export function weeklyGoal({
  kpi,
  entry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
}: WeeklyGoalArgs): number | null {
  const frac = weekFraction(entry)
  const startDate = dateFromIso(entry.week_start_date)
  const month = startDate.getMonth()

  // Financials come from the monthly budget view (already factored in
  // season + adjusted-target logic, including the GP-gap catch-up math).
  if (kpi.id === 'revenue') {
    if (!monthlyGoal) return null
    return monthlyGoal.revenue * frac
  }
  if (kpi.id === 'cogs') {
    if (!monthlyGoal) return null
    return monthlyGoal.cogs * frac
  }
  if (kpi.id === 'grossProfit') {
    if (!monthlyGoal) return null
    return monthlyGoal.grossProfit * frac
  }
  if (kpi.id === 'grossMargin') {
    // GP% is a ratio — not pro-rated, just the month's planned %
    if (!monthlyGoal) return null
    return monthlyGoal.gpPct
  }
  if (kpi.id === 'expenses') {
    if (!monthlyGoal) return null
    return monthlyGoal.expenses * frac
  }
  if (kpi.id === 'netProfit') {
    if (!monthlyGoal) return null
    return monthlyGoal.netProfit * frac
  }
  if (kpi.id === 'netProfitMargin') {
    // NP% is a ratio — not pro-rated, just the month's planned %
    if (!monthlyGoal) return null
    return monthlyGoal.netProfitPct
  }

  // Derived KPIs: their "goal" is composed from related KPI goals (e.g.
  // closeRate = wonDollars goal ÷ proposalsDollars goal × 100). Same logic
  // the KPI Goals card uses to render the derived box. Result is a per-unit
  // value (ratio or per-period $) — no pro-rating needed.
  if (kpi.aggregation === 'derived') {
    return deriveAnnualGoal(kpi.id, kpiGoals, annualRevenue, enabledIds)
  }

  // All other KPIs: read goal from kpiGoals (annual for sum/$, raw for
  // %/avg/last). Sum/$ get pro-rated by month share + day fraction; others
  // use the raw goal.
  const annual = kpiGoals[kpi.id]
  if (annual == null || annual === 0) return null

  if (kpi.format === '%') return annual // ratio target, applies any period
  if (kpi.aggregation === 'last' || kpi.aggregation === 'avg') return annual

  // sum/$ KPI: annual × month_share_fraction × (entry.days / daysInMonth)
  // monthShares sum to 1.0 (e.g. 0.0833 for even months) — same math the
  // budget engine uses internally, no 8.3% display rounding.
  const share = monthShares[month] ?? 1 / 12
  return annual * share * frac
}

/** Compute the actual value of a KPI from an entry's stored input values.
 *  For input KPIs this is just the value entered. For derived KPIs it
 *  computes from the inputs the same way the Weekly Entry preview does.
 *
 *  capacityGroups is optional and only used by KPIs that aggregate across
 *  capacity-group entries (currently just Labor Efficiency, which sums
 *  produced hours across all labor-method groups and divides by the total
 *  working hours defined on those groups). */
export function actualValue(
  kpiId: string,
  entry: WeeklyEntry,
  capacityGroups: CapacityGroup[] = []
): number | null {
  const values = entry.kpi_values ?? {}
  const raw = values[kpiId]
  if (raw != null && !Number.isNaN(raw)) return raw

  // Fall back to derived computation for auto KPIs that weren't stored
  // (older entries may not have these saved; we recompute on the fly).
  const kpi = findKpi(kpiId)
  if (!kpi) return null

  const v = (id: string) => {
    const n = Number(values[id])
    return Number.isFinite(n) ? n : null
  }

  switch (kpiId) {
    case 'grossProfit': {
      const rev = v('revenue')
      const cogs = v('cogs')
      if (rev == null || cogs == null) return null
      return rev - cogs
    }
    case 'grossMargin': {
      const rev = v('revenue')
      const cogs = v('cogs')
      if (!rev || rev === 0) return null
      return ((rev - (cogs ?? 0)) / rev) * 100
    }
    case 'netProfit': {
      const rev = v('revenue')
      const cogs = v('cogs')
      const exp = v('expenses')
      if (rev == null || cogs == null || exp == null) return null
      return rev - cogs - exp
    }
    case 'netProfitMargin': {
      const rev = v('revenue')
      const cogs = v('cogs')
      const exp = v('expenses')
      if (!rev || rev === 0) return null
      return ((rev - (cogs ?? 0) - (exp ?? 0)) / rev) * 100
    }
    case 'conversionRate': {
      const leads = v('leads')
      const nc = v('newClients')
      if (!leads) return null
      return ((nc ?? 0) / leads) * 100
    }
    case 'avgEstimateValue': {
      const dollars = v('proposalsDollars')
      const count = v('estimatesWritten')
      if (!count) return null
      return (dollars ?? 0) / count
    }
    case 'avgPipelineDeal': {
      const value = v('pipelineValue')
      const deals = v('pipelineDeals')
      if (!deals) return null
      return (value ?? 0) / deals
    }
    case 'closeRate': {
      // Whichever wins KPI is active (mutex on contractsWonDollars vs
      // estimatesWonDollars).
      const wins =
        v('contractsWonDollars') ?? v('estimatesWonDollars')
      const written = v('proposalsDollars')
      if (!written) return null
      return ((wins ?? 0) / written) * 100
    }
    case 'avgTransactionValue': {
      const rev = v('revenue')
      const tx = v('transactions')
      if (!tx) return null
      return (rev ?? 0) / tx
    }
    case 'avgRepairOrder': {
      const rev = v('revenue')
      const jobs = v('jobsCompleted')
      if (!jobs) return null
      return (rev ?? 0) / jobs
    }
    case 'contractValuePerNewClient': {
      const wins =
        v('contractsWonDollars') ?? v('estimatesWonDollars')
      const nc = v('newClients')
      if (!nc) return null
      return (wins ?? 0) / nc
    }
    default:
      return null
  }
}

/** Returns which standard KPIs should render as tiles on the dashboard:
 *  always-on (excluding COGS — input-only per kpi.hideTile), plus any
 *  toggled on per client.kpis[id]. Derived KPIs are included if their
 *  dependencies are also enabled. */
export function visibleTileKpis(client: Client): KpiDef[] {
  const enabled = (id: string) => Number(client.kpis?.[id] ?? 0) === 1

  /** A dep is satisfied if it's always-on, enabled directly, OR if any of
   *  its mutex partners (excludes) is enabled. The mutex case matters for
   *  Sales Close Rate + Contract Value per New Client, whose formulas use
   *  either contractsWonDollars OR its mutex sibling estimatesWonDollars. */
  const depSatisfied = (depId: string): boolean => {
    const depKpi = findKpi(depId)
    if (depKpi?.always) return true
    if (enabled(depId)) return true
    if (depKpi?.excludes?.length) {
      return depKpi.excludes.some((alt) => enabled(alt))
    }
    return false
  }

  return KPIS.filter((k) => {
    if (k.hideTile) return false // COGS is an input, not a tile
    if (k.isCapacityFlag) return false // capacity groups render separately
    if (k.always) return true
    if (!enabled(k.id)) return false
    if (k.dependsOn?.length && !k.dependsOn.every(depSatisfied)) return false
    return true
  })
}
