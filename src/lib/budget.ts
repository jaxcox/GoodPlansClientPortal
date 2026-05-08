import type { Budget, SeasonType } from './types'

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** Returns 12 percentages that sum to 100, distributed evenly. */
export function evenSeasonPct(): number[] {
  // 100 ÷ 12 = 8.333... — keep 1 decimal, fix the last entry so the sum is
  // exactly 100 to avoid display weirdness.
  const base = Math.round((100 / 12) * 10) / 10 // 8.3
  const arr = Array.from({ length: 12 }, () => base)
  const drift = +(100 - arr.reduce((a, b) => a + b, 0)).toFixed(1)
  arr[11] = +(arr[11] + drift).toFixed(1)
  return arr
}

/** Effective per-month % for goal pro-rating purposes — returns 12 entries
 * regardless of mode. In 'even' mode each is 100/12. */
export function effectiveSeasonPct(
  seasonType: SeasonType,
  seasonPct: number[]
): number[] {
  if (seasonType === 'seasonal' && seasonPct.length === 12) return seasonPct
  return evenSeasonPct()
}

/** Empty draft used when a client has no budget for the current year yet. */
export function emptyBudget(
  clientId: string,
  coachId: string,
  year: number
): Omit<Budget, 'id' | 'created_at' | 'updated_at'> {
  return {
    client_id: clientId,
    coach_id: coachId,
    year,
    annual_revenue: null,
    cogs_target_pct: null,
    season_type: 'even',
    season_pct: [],
    ytd_thru_month: null,
    ytd_revenue_by_month: null,
    ytd_cogs_by_month: null,
    goals: {},
    capacity_group_goals: {},
  }
}

/** Annual GP $ from Revenue × Gross-Profit %. */
export function annualGrossProfitDollars(
  annualRevenue: number | null,
  grossProfitPct: number | null
): number | null {
  if (annualRevenue == null || grossProfitPct == null) return null
  return annualRevenue * (grossProfitPct / 100)
}

/** Cost of Goods Sold $ = Revenue − GP $. */
export function annualCostOfGoodsDollars(
  annualRevenue: number | null,
  grossProfitPct: number | null
): number | null {
  if (annualRevenue == null || grossProfitPct == null) return null
  return annualRevenue * (1 - grossProfitPct / 100)
}

/** Cost of Goods Sold % = 100% − Gross Profit %. (cogs_target_pct in the
 *  database is still the source of truth — Gross Profit % is just the inverse
 *  presentation in the UI.) */
export function costOfGoodsPct(grossProfitPct: number | null): number | null {
  if (grossProfitPct == null) return null
  return 100 - grossProfitPct
}

// =============================================================================
// YTD actuals month-array helpers (Doc 08 PC: month-by-month storage)
// =============================================================================

export function emptyMonthArray(): (number | null)[] {
  return Array(12).fill(null)
}

/** Sum of values from index 0 through `thruMonthInclusive` (0–11). */
export function sumMonthsThru(
  arr: (number | null)[] | null | undefined,
  thruMonthInclusive: number | null
): number {
  if (!arr || thruMonthInclusive == null) return 0
  let total = 0
  for (let i = 0; i <= thruMonthInclusive && i < 12; i++) {
    total += Number(arr[i] ?? 0)
  }
  return total
}

/** Spread a single total across months 0..thruMonthInclusive, weighted by
 *  season_pct in 'seasonal' mode and split evenly otherwise. Months past the
 *  YTD window are null. */
export function distributeAcrossMonths(
  total: number,
  thruMonthInclusive: number,
  seasonType: SeasonType,
  seasonPct: number[]
): (number | null)[] {
  const out: (number | null)[] = Array(12).fill(null)
  if (thruMonthInclusive < 0 || thruMonthInclusive > 11) return out

  const useSeasonal =
    seasonType === 'seasonal' &&
    seasonPct.length === 12 &&
    seasonPct.slice(0, thruMonthInclusive + 1).some((v) => v > 0)

  if (useSeasonal) {
    const coveredPct = seasonPct
      .slice(0, thruMonthInclusive + 1)
      .reduce((a, b) => a + b, 0)
    if (coveredPct > 0) {
      for (let i = 0; i <= thruMonthInclusive; i++) {
        out[i] = +(total * (seasonPct[i] / coveredPct)).toFixed(2)
      }
      return out
    }
  }

  // Even split fallback
  const monthShare = +(total / (thruMonthInclusive + 1)).toFixed(2)
  for (let i = 0; i <= thruMonthInclusive; i++) {
    out[i] = monthShare
  }
  return out
}

/** Heuristic: did a coach manually edit a month, vs. accept the auto-distribute?
 *  We treat the months as "evenly distributed" if every covered month has the
 *  same value (within $0.50 tolerance for rounding) — anything else is treated
 *  as overrides for the warn-before-overwrite UX. */
export function looksAutoDistributed(
  arr: (number | null)[] | null | undefined,
  thruMonthInclusive: number | null
): boolean {
  if (!arr || thruMonthInclusive == null) return true
  if (thruMonthInclusive < 0) return true
  const first = arr[0] ?? 0
  for (let i = 1; i <= thruMonthInclusive && i < 12; i++) {
    if (Math.abs((arr[i] ?? 0) - first) > 0.5) return false
  }
  return true
}

// =============================================================================
// Computed budget view — Monthly Financial Goals + status banners
// =============================================================================
//
// Doc 05 spec: per-month Revenue / COGS / GP / GP% tiles, with future months
// auto-adjusted to close the GP gap when YTD actuals are behind. GP is the
// priority — the algorithm holds the annual GP $ target constant by raising
// remaining months' GP (and Revenue, since the GP % stays constant) so the
// year still lands on plan.

export type MonthlyGoal = {
  monthIdx: number // 0–11
  isPast: boolean
  /** True for future months when the GP gap pushed targets above the baseline. */
  isAdjusted: boolean
  revenue: number
  cogs: number
  grossProfit: number
  /** Computed margin in % (e.g. 55.0). */
  gpPct: number
}

export type BudgetView = {
  months: MonthlyGoal[]
  /** YTD comparisons. Negative gap = behind plan; positive = ahead. */
  ytdRevenueActual: number
  ytdRevenuePlanned: number
  revenueGap: number
  ytdGpActual: number
  ytdGpPlanned: number
  gpGap: number
  /** Remaining-year totals — useful for the "Remaining revenue: $X across N months" line. */
  remainingMonths: number
  remainingRevenue: number
  remainingGrossProfit: number
}

type ComputeArgs = {
  annualRevenue: number | null
  /** Gross Profit % (NOT cogs %) — matches the form input. */
  grossProfitPct: number | null
  seasonType: SeasonType
  seasonPct: number[]
  /** -1 / null = no YTD set. */
  ytdThruMonth: number | null
  ytdRevenueByMonth: (number | null)[] | null
  ytdCogsByMonth: (number | null)[] | null
}

export function computeBudgetView(args: ComputeArgs): BudgetView | null {
  const {
    annualRevenue,
    grossProfitPct,
    seasonType,
    seasonPct,
    ytdThruMonth,
    ytdRevenueByMonth,
    ytdCogsByMonth,
  } = args

  if (annualRevenue == null || grossProfitPct == null) return null

  const gpRate = grossProfitPct / 100
  const annualGp = annualRevenue * gpRate

  // Effective season percentages (length 12, summing to 100). Even mode is a
  // flat 1/12 each. Seasonal mode uses the saved array if valid.
  const effectivePct = effectiveSeasonPct(seasonType, seasonPct)

  // Step 1: baseline planned revenue per month from the season distribution.
  const baselineRevenue: number[] = effectivePct.map(
    (p) => annualRevenue * (p / 100)
  )

  // Step 2: actual YTD totals when the YTD window is set.
  const thru = ytdThruMonth ?? -1
  const hasYtd = thru >= 0
  let ytdRevenueActual = 0
  let ytdGpActual = 0
  if (hasYtd) {
    for (let i = 0; i <= thru && i < 12; i++) {
      const r = Number(ytdRevenueByMonth?.[i] ?? 0)
      const c = Number(ytdCogsByMonth?.[i] ?? 0)
      ytdRevenueActual += r
      ytdGpActual += r - c
    }
  }

  // Step 3: planned YTD = sum of baseline through thru.
  let ytdRevenuePlanned = 0
  for (let i = 0; i <= thru && i < 12; i++) {
    ytdRevenuePlanned += baselineRevenue[i]
  }
  const ytdGpPlanned = ytdRevenuePlanned * gpRate

  const revenueGap = ytdRevenueActual - ytdRevenuePlanned // < 0 = behind
  const gpGap = ytdGpActual - ytdGpPlanned

  // Step 4: build the per-month view, holding annual GP $ constant by
  // distributing the remaining GP across future months by season weight.
  const futureIdxs: number[] = []
  for (let i = thru + 1; i < 12; i++) futureIdxs.push(i)
  const futurePctSum = futureIdxs.reduce(
    (acc, i) => acc + effectivePct[i],
    0
  )
  const remainingGpNeeded = annualGp - ytdGpActual
  const remainingRevenueNeeded = gpRate > 0 ? remainingGpNeeded / gpRate : 0

  let remainingRevenueSum = 0
  let remainingGpSum = 0
  const months: MonthlyGoal[] = []

  for (let i = 0; i < 12; i++) {
    if (i <= thru && hasYtd) {
      const r = Number(ytdRevenueByMonth?.[i] ?? 0)
      const c = Number(ytdCogsByMonth?.[i] ?? 0)
      const gp = r - c
      months.push({
        monthIdx: i,
        isPast: true,
        isAdjusted: false,
        revenue: r,
        cogs: c,
        grossProfit: gp,
        gpPct: r > 0 ? (gp / r) * 100 : 0,
      })
    } else {
      const weight =
        futurePctSum > 0 && futureIdxs.length > 0
          ? effectivePct[i] / futurePctSum
          : 1 / Math.max(futureIdxs.length, 1)
      const gp = remainingGpNeeded * weight
      const revenue = gpRate > 0 ? gp / gpRate : 0
      const cogs = revenue - gp
      const baseline = baselineRevenue[i]
      const isAdjusted = hasYtd && Math.abs(revenue - baseline) > 0.5
      months.push({
        monthIdx: i,
        isPast: false,
        isAdjusted,
        revenue,
        cogs,
        grossProfit: gp,
        gpPct: revenue > 0 ? (gp / revenue) * 100 : grossProfitPct,
      })
      remainingRevenueSum += revenue
      remainingGpSum += gp
    }
  }

  return {
    months,
    ytdRevenueActual,
    ytdRevenuePlanned,
    revenueGap,
    ytdGpActual,
    ytdGpPlanned,
    gpGap,
    remainingMonths: futureIdxs.length,
    remainingRevenue: remainingRevenueSum || remainingRevenueNeeded,
    remainingGrossProfit: remainingGpSum || remainingGpNeeded,
  }
}
