// =============================================================================
// Cumulative dashboards (MTD / QTD / YTD) — period math + aggregation
// =============================================================================
// Doc-08 spec. The Weekly Dashboard already renders per-entry tiles; the
// cumulative modes roll up every saved entry whose week_start_date falls in
// the current month / quarter / year, then compare actuals to a pace-adjusted
// goal (full goal × elapsed weeks ÷ total weeks).
//
// This file is the math layer only — period predicate, per-KPI aggregation,
// pace fraction, period-total goal. The dashboard component pulls these in
// when mode ≠ 'weekly'.
//
// Key choices documented in doc-08:
//   - For 'derived' KPIs we aggregate the raw INPUTS first, then compute the
//     derived value once. (Sum revenue, sum cogs, then GP = sum(rev)-sum(cogs).)
//     Averaging per-week derived values gives the wrong answer for any month
//     with uneven weekly revenue.
//   - Sum-aggregated KPIs scale their goal by the share of the year covered
//     by the period. %, avg, last, and derived KPIs use the goal as-is — a
//     60% close rate is 60% whether it's MTD or YTD.
//   - Future-dated entries (week_start_date > today) are excluded.

import type { KpiDef } from './kpis'
import type {
  Budget,
  CapacityGroup,
  CustomKpi,
  WeeklyEntry,
} from './types'
import { dateFromIso } from './week'
import { daysInMonth } from './dashboardGoals'
import type { MonthlyGoal } from './budget'

export type Mode = 'weekly' | 'mtd' | 'qtd' | 'ytd'

// =============================================================================
// Period helpers
// =============================================================================

/** 0-indexed month → 0-indexed quarter. */
export function quarterFromMonth(month: number): number {
  return Math.floor(month / 3)
}

/** Number of days in the active period. */
export function daysInPeriod(
  mode: Exclude<Mode, 'weekly'>,
  year: number,
  month: number
): number {
  if (mode === 'mtd') return daysInMonth(year, month)
  if (mode === 'qtd') {
    const q = quarterFromMonth(month)
    let total = 0
    for (let i = 0; i < 3; i++) total += daysInMonth(year, q * 3 + i)
    return total
  }
  // ytd
  let total = 0
  for (let i = 0; i < 12; i++) total += daysInMonth(year, i)
  return total
}

/** Total weeks in the period (days ÷ 7). Used as the denominator of
 *  paceFrac. */
export function totalWeeksInPeriod(
  mode: Exclude<Mode, 'weekly'>,
  year: number,
  month: number
): number {
  return daysInPeriod(mode, year, month) / 7
}

/** Pace fraction — "how far through the period are we?" Capped at 1.0
 *  so a heavy first week doesn't read as ahead of pace in the goal math. */
export function paceFrac(
  currentWeeks: number,
  totalWeeks: number
): number {
  if (totalWeeks <= 0) return 0
  return Math.min(currentWeeks / totalWeeks, 1)
}

/** True when entry.week_start_date falls inside the current period and is
 *  not in the future (today and earlier only). */
export function entryInPeriod(
  entry: WeeklyEntry,
  mode: Exclude<Mode, 'weekly'>,
  year: number,
  month: number,
  today: Date = new Date()
): boolean {
  const d = dateFromIso(entry.week_start_date)
  if (d > today) return false
  if (d.getFullYear() !== year) return false
  if (mode === 'mtd') return d.getMonth() === month
  if (mode === 'qtd') {
    return quarterFromMonth(d.getMonth()) === quarterFromMonth(month)
  }
  // ytd: any month of the active year
  return true
}

/** Human label for the active period. The mode pill already tells the
 *  user which view they're in, so the label just identifies the period:
 *  "April" / "Q2" / "2026". */
export function periodLabel(
  mode: Exclude<Mode, 'weekly'>,
  year: number,
  month: number
): string {
  if (mode === 'mtd') {
    return new Date(year, month, 1).toLocaleDateString('en-US', {
      month: 'long',
    })
  }
  if (mode === 'qtd') {
    return `Q${quarterFromMonth(month) + 1}`
  }
  return `${year}`
}

// =============================================================================
// Per-KPI aggregation
// =============================================================================

/** Sum a raw input KPI across the supplied entries. Treats missing /
 *  non-numeric values as 0 but only returns null when NO entry had a
 *  value — distinguishes "summed to zero" from "no data at all."
 *
 *  `extraTotals` is the YTD-actuals contribution (pre-coaching monthly
 *  totals from the budget row that fold into YTD/QTD rollups per doc-08).
 *  When a contribution exists for this KPI, it's added to the sum and
 *  also counts toward "had a value" so the tile shows the integrated
 *  number rather than null. */
function sumRaw(
  id: string,
  entries: WeeklyEntry[],
  extraTotals?: Record<string, number>
): number | null {
  let total = 0
  let any = false
  for (const e of entries) {
    const v = e.kpi_values?.[id]
    if (typeof v === 'number' && Number.isFinite(v)) {
      total += v
      any = true
    }
  }
  const extra = extraTotals?.[id]
  if (typeof extra === 'number' && Number.isFinite(extra)) {
    total += extra
    any = true
  }
  return any ? total : null
}

/** Aggregate a derived KPI by first aggregating its raw inputs, then
 *  computing the derived value once. Returns null when inputs are missing
 *  or when the formula would divide by zero.
 *
 *  `extra` carries any YTD-actuals contribution to fold into the relevant
 *  raw inputs (revenue / cogs / expenses) so derived Financials reflect
 *  pre-coaching months too. */
function aggregateDerived(
  kpiId: string,
  entries: WeeklyEntry[],
  extra?: Record<string, number>
): number | null {
  const safeDiv = (num: number | null, den: number | null): number | null => {
    if (num == null || den == null || den === 0) return null
    return num / den
  }

  switch (kpiId) {
    case 'grossProfit': {
      const r = sumRaw('revenue', entries, extra)
      const c = sumRaw('cogs', entries, extra)
      if (r == null || c == null) return null
      return r - c
    }
    case 'grossMargin': {
      const r = sumRaw('revenue', entries, extra)
      const c = sumRaw('cogs', entries, extra)
      const gp = safeDiv(r != null && c != null ? r - c : null, r)
      return gp == null ? null : gp * 100
    }
    case 'netProfit': {
      const r = sumRaw('revenue', entries, extra)
      const c = sumRaw('cogs', entries, extra)
      const e = sumRaw('expenses', entries, extra)
      if (r == null || c == null || e == null) return null
      return r - c - e
    }
    case 'netProfitMargin': {
      const r = sumRaw('revenue', entries, extra)
      const c = sumRaw('cogs', entries, extra) ?? 0
      const e = sumRaw('expenses', entries, extra) ?? 0
      if (r == null || r === 0) return null
      return ((r - c - e) / r) * 100
    }
    case 'conversionRate': {
      const leads = sumRaw('leads', entries)
      const nc = sumRaw('newClients', entries)
      return safeDiv(nc, leads) == null
        ? null
        : (safeDiv(nc, leads) as number) * 100
    }
    case 'avgEstimateValue':
      return safeDiv(
        sumRaw('proposalsDollars', entries),
        sumRaw('estimatesWritten', entries)
      )
    case 'avgEstimateWon':
      return safeDiv(
        sumRaw('estimatesWonDollars', entries),
        sumRaw('estimatesWonCount', entries)
      )
    case 'avgContractWon':
      return safeDiv(
        sumRaw('contractsWonDollars', entries),
        sumRaw('contractsWonCount', entries)
      )
    case 'avgPipelineDeal':
      return safeDiv(
        sumRaw('pipelineValue', entries),
        sumRaw('pipelineDeals', entries)
      )
    case 'closeRate': {
      // wins / estimates-written. wins is whichever of contractsWonDollars /
      // estimatesWonDollars is being tracked (mutex partners).
      const wins =
        sumRaw('contractsWonDollars', entries) ??
        sumRaw('estimatesWonDollars', entries)
      const written = sumRaw('proposalsDollars', entries)
      const r = safeDiv(wins, written)
      return r == null ? null : r * 100
    }
    case 'avgTransactionValue':
      return safeDiv(
        sumRaw('revenue', entries, extra),
        sumRaw('transactions', entries)
      )
    case 'avgRepairOrder':
      return safeDiv(
        sumRaw('revenue', entries, extra),
        sumRaw('jobsCompleted', entries)
      )
    default:
      return null
  }
}

/** Aggregate a standard KPI over the supplied entries.
 *  Capacity-group rollups are handled separately (see aggregateCapacityValue).
 *
 *  `ytdExtra` (when provided) adds YTD-actuals contributions to revenue /
 *  cogs / expenses sums — used in YTD and overlapping-QTD modes to fold
 *  in pre-coaching months captured on the budget row. */
export function aggregateKpi(
  kpi: KpiDef,
  entries: WeeklyEntry[],
  ytdExtra?: Record<string, number>
): number | null {
  if (entries.length === 0 && !ytdExtra) return null

  if (kpi.aggregation === 'derived') {
    return aggregateDerived(kpi.id, entries, ytdExtra)
  }

  if (kpi.aggregation === 'sum') {
    // For Financials computed sums (grossProfit, netProfit), the value
    // is stored per-entry under its own key but older entries may have
    // saved only the raw inputs (revenue / cogs / expenses) without the
    // derived field. Fall back to recomputing from those inputs so the
    // tile still shows a value.
    const direct = sumRaw(kpi.id, entries, ytdExtra)
    if (direct != null) return direct
    if (kpi.id === 'grossProfit' || kpi.id === 'netProfit') {
      return aggregateDerived(kpi.id, entries, ytdExtra)
    }
    return null
  }

  if (kpi.aggregation === 'avg') {
    const vals: number[] = []
    for (const e of entries) {
      const v = e.kpi_values?.[kpi.id]
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
    }
    if (vals.length === 0) return null
    return vals.reduce((s, v) => s + v, 0) / vals.length
  }

  if (kpi.aggregation === 'last') {
    let latest: WeeklyEntry | null = null
    for (const e of entries) {
      const v = e.kpi_values?.[kpi.id]
      if (typeof v !== 'number' || !Number.isFinite(v)) continue
      if (!latest || e.week_start_date > latest.week_start_date) latest = e
    }
    if (!latest) return null
    const v = latest.kpi_values?.[kpi.id]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  return null
}

// =============================================================================
// YTD-actuals integration
// =============================================================================

/** Result of folding pre-coaching YTD actuals into the active period. */
export type YtdContribution = {
  /** Per-KPI additive contribution. Only populated for revenue / cogs /
   *  expenses — the budget engine doesn't capture other KPIs by month. */
  contribution: Record<string, number>
  /** Fractional weeks covered by the folded months. Added to currentWeeks
   *  when computing paceFrac so pace reflects "actuals + entries." */
  weeksCovered: number
  /** Month indices (0-11) that were folded in. Drives the "incl. actuals
   *  thru April" pill on the period label in YTD mode. */
  monthsCovered: number[]
}

const EMPTY_YTD: YtdContribution = {
  contribution: {},
  weeksCovered: 0,
  monthsCovered: [],
}

/** Compute the YTD-actuals contribution to the active period.
 *
 *  Rules (doc-08):
 *  - YTD: every month 0..ytd_thru_month folds in.
 *  - QTD: only the months in 0..ytd_thru_month that ALSO fall in the
 *         current quarter — AND current month must be strictly past
 *         ytd_thru_month (otherwise we'd double-count the current month).
 *  - MTD: never (actuals are monthly grain, not within-month).
 *
 *  Returns EMPTY_YTD when no fold applies (wrong year, no ytd_thru_month,
 *  no overlap, MTD mode). */
export function ytdActualsContribution(
  budget: Budget | null,
  mode: Exclude<Mode, 'weekly'>,
  year: number,
  month: number
): YtdContribution {
  if (!budget) return EMPTY_YTD
  if (budget.year !== year) return EMPTY_YTD
  const thru = budget.ytd_thru_month
  if (thru == null || thru < 0 || thru > 11) return EMPTY_YTD
  if (mode === 'mtd') return EMPTY_YTD

  let monthsToFold: number[]
  if (mode === 'ytd') {
    monthsToFold = []
    for (let i = 0; i <= thru; i++) monthsToFold.push(i)
  } else {
    // QTD — fold months that fall in the current quarter AND are <=
    // ytd_thru AND are strictly before the current month.
    const q = quarterFromMonth(month)
    monthsToFold = []
    for (let i = q * 3; i < q * 3 + 3 && i <= thru && i < month; i++) {
      monthsToFold.push(i)
    }
  }
  if (monthsToFold.length === 0) return EMPTY_YTD

  const rev = (budget.ytd_revenue_by_month as (number | null)[] | null) ?? []
  const cogs = (budget.ytd_cogs_by_month as (number | null)[] | null) ?? []
  const exp = (budget.ytd_expenses_by_month as (number | null)[] | null) ?? []

  let revTotal = 0
  let cogsTotal = 0
  let expTotal = 0
  let weeksCovered = 0
  for (const i of monthsToFold) {
    revTotal += Number(rev[i] ?? 0)
    cogsTotal += Number(cogs[i] ?? 0)
    expTotal += Number(exp[i] ?? 0)
    weeksCovered += daysInMonth(year, i) / 7
  }

  return {
    contribution: {
      revenue: revTotal,
      cogs: cogsTotal,
      expenses: expTotal,
    },
    weeksCovered,
    monthsCovered: monthsToFold,
  }
}

/** Aggregate a custom KPI: sum when format is # or $, average when %. */
export function aggregateCustomKpi(
  custom: CustomKpi,
  entries: WeeklyEntry[]
): number | null {
  if (entries.length === 0) return null
  if (custom.format === '%') {
    const vals: number[] = []
    for (const e of entries) {
      const v = e.kpi_values?.[custom.id]
      if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
    }
    if (vals.length === 0) return null
    return vals.reduce((s, v) => s + v, 0) / vals.length
  }
  return sumRaw(custom.id, entries)
}

/** Capacity-group rollup. Doc-08: raw values are summed across in-period
 *  entries regardless of method (working hours, labor hours, revenue $).
 *  Returns null when no entry has a recorded value for the group. */
export function aggregateCapacityValue(
  group: CapacityGroup,
  entries: WeeklyEntry[]
): number | null {
  let total = 0
  let any = false
  for (const e of entries) {
    const cv = (e.capacity_values ?? {})[group.id]
    if (!cv) continue
    let n: number | null = null
    if ('utilizationPct' in cv) n = cv.utilizationPct
    else if ('slotsFilled' in cv) n = cv.slotsFilled
    else if ('producedHours' in cv) n = cv.producedHours
    else if ('revenueProduced' in cv) n = cv.revenueProduced
    else if ('departments' in cv) {
      n = Object.values(cv.departments ?? {}).reduce(
        (s, d) => s + (d?.hoursWorked ?? 0),
        0
      )
    }
    if (n != null && Number.isFinite(n)) {
      total += n
      any = true
    }
  }
  return any ? total : null
}

// =============================================================================
// Period-total goals
// =============================================================================

/** Share of the year that the period covers, weighted by monthShares.
 *  MTD: monthShares[month]. QTD: sum of three months in the quarter.
 *  YTD: 1.0 (the whole year). */
function periodShare(
  mode: Exclude<Mode, 'weekly'>,
  month: number,
  monthShares: number[]
): number {
  if (mode === 'mtd') return monthShares[month] ?? 1 / 12
  if (mode === 'qtd') {
    const q = quarterFromMonth(month)
    let s = 0
    for (let i = 0; i < 3; i++) s += monthShares[q * 3 + i] ?? 1 / 12
    return s
  }
  return 1
}

/** Sum a per-month financial figure (revenue / cogs / grossProfit /
 *  netProfit / expenses) across the months covered by the period. The
 *  budget engine already produces per-month numbers that include YTD
 *  catch-up adjustments, so we just sum them. */
function sumMonthlyFinancial(
  field:
    | 'revenue'
    | 'cogs'
    | 'grossProfit'
    | 'netProfit'
    | 'expenses',
  mode: Exclude<Mode, 'weekly'>,
  month: number,
  monthlyGoals: MonthlyGoal[] | null
): number | null {
  if (!monthlyGoals || monthlyGoals.length !== 12) return null
  if (mode === 'mtd') return monthlyGoals[month]?.[field] ?? null
  let total = 0
  if (mode === 'qtd') {
    const q = quarterFromMonth(month)
    for (let i = 0; i < 3; i++) total += monthlyGoals[q * 3 + i]?.[field] ?? 0
    return total
  }
  // ytd
  for (let i = 0; i < 12; i++) total += monthlyGoals[i]?.[field] ?? 0
  return total
}

export type PeriodGoalArgs = {
  kpi: KpiDef
  mode: Exclude<Mode, 'weekly'>
  month: number
  /** BudgetView.months — per-month financial targets, already YTD-adjusted
   *  by computeBudgetView in lib/budget.ts. */
  monthlyGoals: MonthlyGoal[] | null
  /** monthShareFractions output (12 floats summing to 1.0). */
  monthShares: number[]
  /** All standard KPI goals from budget.goals (annual amounts). */
  kpiGoals: Record<string, number>
  /** Currently-enabled KPI ids (for derived goal mutex resolution). */
  enabledIds: Set<string>
  /** Annual revenue target — needed for derived ratio goals
   *  (e.g. avgTransactionValue = annualRevenue / annualTransactions). */
  annualRevenue: number | undefined
}

/** Period-total goal for one KPI. The full-goal anchor — paceGoal is
 *  derived from this by multiplying by paceFrac. Returns null when the
 *  goal can't be resolved (missing budget / missing inputs / etc.). */
export function getPeriodGoalFull({
  kpi,
  mode,
  month,
  monthlyGoals,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
}: PeriodGoalArgs): number | null {
  // Financials — sum the budget engine's per-month numbers.
  if (kpi.id === 'revenue') {
    return sumMonthlyFinancial('revenue', mode, month, monthlyGoals)
  }
  if (kpi.id === 'cogs') {
    return sumMonthlyFinancial('cogs', mode, month, monthlyGoals)
  }
  if (kpi.id === 'grossProfit') {
    return sumMonthlyFinancial('grossProfit', mode, month, monthlyGoals)
  }
  if (kpi.id === 'expenses') {
    return sumMonthlyFinancial('expenses', mode, month, monthlyGoals)
  }
  if (kpi.id === 'netProfit') {
    return sumMonthlyFinancial('netProfit', mode, month, monthlyGoals)
  }
  // Ratio Financials — gpPct / netProfitPct are %s that don't scale.
  // Use the annual rate from the first available month (they're equal
  // across months under the current model).
  if (kpi.id === 'grossMargin') {
    return monthlyGoals?.[month]?.gpPct ?? null
  }
  if (kpi.id === 'netProfitMargin') {
    return monthlyGoals?.[month]?.netProfitPct ?? null
  }

  // Derived KPIs (non-financial): per-unit value, no scaling. Pull from
  // the same deriveAnnualGoal that the KPI Goals card uses, since it
  // already produces a per-unit ratio / average.
  if (kpi.aggregation === 'derived') {
    return deriveDerivedGoal(kpi.id, kpiGoals, enabledIds, annualRevenue)
  }

  // %/avg/last KPIs: no scaling.
  if (kpi.format === '%') return kpiGoals[kpi.id] ?? null
  if (kpi.aggregation === 'avg' || kpi.aggregation === 'last') {
    return kpiGoals[kpi.id] ?? null
  }

  // Sum KPI ($ / #): annual × period share.
  const annual = kpiGoals[kpi.id]
  if (annual == null || annual === 0) return null
  return annual * periodShare(mode, month, monthShares)
}

/** Mirror of dashboardGoals.deriveAnnualGoal — kept local so changing one
 *  doesn't quietly drift the other. Same formulas; per-unit value. */
function deriveDerivedGoal(
  kpiId: string,
  goals: Record<string, number>,
  enabledIds: Set<string>,
  annualRevenue: number | undefined
): number | null {
  const g = (id: string) => goals[id]
  const safe = (n: number | undefined, d: number | undefined): number | null => {
    if (n == null || d == null || d === 0) return null
    return n / d
  }
  switch (kpiId) {
    case 'conversionRate': {
      const r = safe(g('newClients'), g('leads'))
      return r === null ? null : r * 100
    }
    case 'avgEstimateValue':
      return safe(g('proposalsDollars'), g('estimatesWritten'))
    case 'avgEstimateWon':
      return safe(g('estimatesWonDollars'), g('estimatesWonCount'))
    case 'avgContractWon':
      return safe(g('contractsWonDollars'), g('contractsWonCount'))
    case 'avgPipelineDeal':
      return safe(g('pipelineValue'), g('pipelineDeals'))
    case 'closeRate': {
      const wins = enabledIds.has('contractsWonDollars')
        ? g('contractsWonDollars')
        : g('estimatesWonDollars')
      const r = safe(wins, g('proposalsDollars'))
      return r === null ? null : r * 100
    }
    case 'avgTransactionValue':
      return safe(annualRevenue, g('transactions'))
    case 'avgRepairOrder':
      return safe(annualRevenue, g('jobsCompleted'))
    default:
      return null
  }
}

