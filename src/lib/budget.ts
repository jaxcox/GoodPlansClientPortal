import type { Budget, SeasonType } from './types'
import { dateFromIso, entryCoveredIsos, isoDate } from './week'

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
    annual_expenses: null,
    season_type: 'even',
    season_pct: [],
    ytd_thru_month: null,
    ytd_revenue_by_month: null,
    ytd_cogs_by_month: null,
    ytd_expenses_by_month: null,
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

/** Annual Net Profit $ = Gross Profit $ − Expenses $. Null until both inputs
 *  exist. */
export function annualNetProfitDollars(
  annualGpDollars: number | null,
  annualExpenses: number | null
): number | null {
  if (annualGpDollars == null || annualExpenses == null) return null
  return annualGpDollars - annualExpenses
}

/** Annual Net Profit % = Net Profit $ ÷ Revenue × 100. */
export function annualNetProfitPct(
  annualNpDollars: number | null,
  annualRevenue: number | null
): number | null {
  if (annualNpDollars == null || annualRevenue == null || annualRevenue === 0)
    return null
  return (annualNpDollars / annualRevenue) * 100
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
  /** True for a past month that's calendar-complete but still missing one or
   *  more weekly entries — the tile shows the actuals available so far and a
   *  heads-up badge. Never set for YTD-import months (those are pre-loaded)
   *  or future months. */
  incomplete: boolean
  revenue: number
  cogs: number
  grossProfit: number
  /** Computed margin in % (e.g. 55.0). */
  gpPct: number
  expenses: number
  netProfit: number
  /** Computed Net Profit margin: NP$ ÷ Revenue × 100. 0 when revenue is 0. */
  netProfitPct: number
}

/** Per-month actuals for a month that completed DURING the program (after the
 *  YTD-import window), aggregated from the client's weekly entries. */
export type MonthActual = {
  revenue: number
  cogs: number
  expenses: number
  /** False when the month is calendar-complete but some of its weeks have no
   *  saved entry yet. */
  complete: boolean
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
  ytdExpensesActual: number
  ytdNetProfitActual: number
  /** Remaining-year totals — useful for the "Remaining revenue: $X across N months" line. */
  remainingMonths: number
  remainingRevenue: number
  remainingGrossProfit: number
  remainingNetProfit: number
}

type ComputeArgs = {
  annualRevenue: number | null
  /** Gross Profit % (NOT cogs %) — matches the form input. */
  grossProfitPct: number | null
  /** Annual operating expenses (below COGS). null when not yet entered. */
  annualExpenses: number | null
  seasonType: SeasonType
  seasonPct: number[]
  /** -1 / null = no YTD set. */
  ytdThruMonth: number | null
  ytdRevenueByMonth: (number | null)[] | null
  ytdCogsByMonth: (number | null)[] | null
  ytdExpensesByMonth: (number | null)[] | null
  /** Actuals for months that have completed during the program (after the
   *  YTD window, before the current month), keyed by month index (0–11).
   *  Non-null entries are treated as past months showing real results, exactly
   *  like YTD months. Omit (or leave null) to get YTD-only behavior. */
  programActualsByMonth?: (MonthActual | null)[]
}

export function computeBudgetView(args: ComputeArgs): BudgetView | null {
  const {
    annualRevenue,
    grossProfitPct,
    annualExpenses,
    seasonType,
    seasonPct,
    ytdThruMonth,
    ytdRevenueByMonth,
    ytdCogsByMonth,
    ytdExpensesByMonth,
    programActualsByMonth,
  } = args

  if (annualRevenue == null || grossProfitPct == null) return null

  const gpRate = grossProfitPct / 100
  const annualGp = annualRevenue * gpRate
  // Expenses default to 0 when not yet entered, so Net Profit just collapses
  // to Gross Profit. We surface a "—" in the UI when expenses is null.
  const totalAnnualExpenses = annualExpenses ?? 0

  // Per-month share as fractions summing to 1 — the math uses these directly
  // so the per-month tiles always sum exactly to the annual targets. Even
  // mode is exactly 1/12 each (avoiding the 8.3/8.7 rounding artifact in
  // evenSeasonPct, which is for *display*). Seasonal mode normalizes the
  // saved percentages.
  let monthShare: number[]
  if (seasonType === 'seasonal' && seasonPct.length === 12) {
    const total = seasonPct.reduce((a, b) => a + b, 0)
    monthShare =
      total > 0
        ? seasonPct.map((p) => p / total)
        : Array(12).fill(1 / 12)
  } else {
    monthShare = Array(12).fill(1 / 12)
  }

  // Step 1: baseline planned revenue per month.
  const baselineRevenue: number[] = monthShare.map(
    (s) => annualRevenue * s
  )

  // Step 2: actuals to date. "Past" months are the YTD-import window
  // (0..ytdThruMonth, actuals pre-loaded on the budget) PLUS any months that
  // have since completed during the program, whose actuals arrive via
  // programActualsByMonth (aggregated from weekly entries by the caller).
  // Both kinds are treated identically here — real results the future months
  // adjust around.
  const thru = ytdThruMonth ?? -1
  const hasYtd = thru >= 0
  const prog = programActualsByMonth ?? []

  // A month is "past" (shows actuals) if it's in the YTD window or has a
  // program-actuals entry. Program months are contiguous after the YTD
  // window, so pastThru is simply the last such month.
  let pastThru = thru
  for (let i = thru + 1; i < 12; i++) {
    if (prog[i]) pastThru = i
    else break
  }
  const hasPast = pastThru >= 0

  // Actuals for a past month, from whichever source owns it.
  const actualFor = (i: number): { r: number; c: number; e: number } | null => {
    if (i <= thru && hasYtd) {
      return {
        r: Number(ytdRevenueByMonth?.[i] ?? 0),
        c: Number(ytdCogsByMonth?.[i] ?? 0),
        e: Number(ytdExpensesByMonth?.[i] ?? 0),
      }
    }
    const a = prog[i]
    if (a) return { r: a.revenue, c: a.cogs, e: a.expenses }
    return null
  }

  // Totals across all past months (YTD + completed program months), plus the
  // baseline that was planned for those same months — the gap between them
  // drives the future-month adjustment.
  let pastRevenueActual = 0
  let pastGpActual = 0
  let pastExpensesActual = 0
  let pastRevenuePlanned = 0
  for (let i = 0; i <= pastThru; i++) {
    pastRevenuePlanned += baselineRevenue[i]
    const a = actualFor(i)
    if (a) {
      pastRevenueActual += a.r
      pastGpActual += a.r - a.c
      pastExpensesActual += a.e
    }
  }
  const pastNetProfitActual = pastGpActual - pastExpensesActual
  const pastGpPlanned = pastRevenuePlanned * gpRate

  const revenueGap = pastRevenueActual - pastRevenuePlanned // < 0 = behind
  const gpGap = pastGpActual - pastGpPlanned

  // Step 3: build the per-month view, holding annual GP $ constant by
  // distributing the remaining GP across the still-future months by share.
  const futureIdxs: number[] = []
  for (let i = pastThru + 1; i < 12; i++) futureIdxs.push(i)
  const futureShareSum = futureIdxs.reduce(
    (acc, i) => acc + monthShare[i],
    0
  )
  const remainingGpNeeded = annualGp - pastGpActual
  const remainingRevenueNeeded = gpRate > 0 ? remainingGpNeeded / gpRate : 0

  let remainingRevenueSum = 0
  let remainingGpSum = 0
  let remainingNpSum = 0
  const months: MonthlyGoal[] = []

  // Expenses are distributed by the same monthShare as revenue, but unlike GP
  // they aren't auto-adjusted to close the gap — they're an independent
  // operating-cost target. Past months show actual expenses; future months
  // show their share of the remaining annual expense pool.
  const remainingAnnualExpenses = totalAnnualExpenses - pastExpensesActual

  for (let i = 0; i < 12; i++) {
    const a = i <= pastThru ? actualFor(i) : null
    if (a) {
      const gp = a.r - a.c
      const np = gp - a.e
      // YTD-import months are pre-loaded and always complete; a program month
      // is flagged incomplete when some of its weeks aren't entered yet.
      const incomplete = i > thru && !!prog[i] && !prog[i]!.complete
      months.push({
        monthIdx: i,
        isPast: true,
        isAdjusted: false,
        incomplete,
        revenue: a.r,
        cogs: a.c,
        grossProfit: gp,
        gpPct: a.r > 0 ? (gp / a.r) * 100 : 0,
        expenses: a.e,
        netProfit: np,
        netProfitPct: a.r > 0 ? (np / a.r) * 100 : 0,
      })
    } else {
      const weight =
        futureShareSum > 0 && futureIdxs.length > 0
          ? monthShare[i] / futureShareSum
          : 1 / Math.max(futureIdxs.length, 1)
      const gp = remainingGpNeeded * weight
      const revenue = gpRate > 0 ? gp / gpRate : 0
      const cogs = revenue - gp
      const expenses = remainingAnnualExpenses * weight
      const np = gp - expenses
      const baseline = baselineRevenue[i]
      const isAdjusted = hasPast && Math.abs(revenue - baseline) > 0.5
      months.push({
        monthIdx: i,
        isPast: false,
        isAdjusted,
        incomplete: false,
        revenue,
        cogs,
        grossProfit: gp,
        gpPct: revenue > 0 ? (gp / revenue) * 100 : grossProfitPct,
        expenses,
        netProfit: np,
        netProfitPct: revenue > 0 ? (np / revenue) * 100 : 0,
      })
      remainingRevenueSum += revenue
      remainingGpSum += gp
      remainingNpSum += np
    }
  }

  return {
    months,
    ytdRevenueActual: pastRevenueActual,
    ytdRevenuePlanned: pastRevenuePlanned,
    revenueGap,
    ytdGpActual: pastGpActual,
    ytdGpPlanned: pastGpPlanned,
    gpGap,
    ytdExpensesActual: pastExpensesActual,
    ytdNetProfitActual: pastNetProfitActual,
    remainingMonths: futureIdxs.length,
    remainingRevenue: remainingRevenueSum || remainingRevenueNeeded,
    remainingGrossProfit: remainingGpSum || remainingGpNeeded,
    remainingNetProfit: remainingNpSum,
  }
}

/** Aggregate weekly entries into per-month actuals for the months that
 *  completed DURING the program — i.e. after the YTD-import window
 *  (`ytdThruMonth`) and strictly before the current, in-progress month.
 *  Returns a length-12 array; only those months are non-null (feed it
 *  straight to `computeBudgetView`'s `programActualsByMonth`).
 *
 *  Attribution: each entry's revenue / COGS / expenses land in the month of
 *  its `week_start_date`. Boundary weeks are stored as two partial rows (one
 *  per month, each starting in its own month), so this is exact — no day-
 *  splitting needed here.
 *
 *  Completeness: a month is `complete` only when every one of its days is
 *  covered by some saved entry's date range. A closed week still counts as
 *  covered (it's a real zero-revenue week), so an intentionally-closed
 *  business doesn't read as "incomplete". */
export function monthlyProgramActuals(
  entries: {
    week_start_date: string
    days: number
    kpi_values: Record<string, number>
  }[],
  year: number,
  ytdThruMonth: number | null,
  today: Date = new Date()
): (MonthActual | null)[] {
  const byMonth: (MonthActual | null)[] = Array(12).fill(null)
  const thru = ytdThruMonth ?? -1

  // Last calendar-complete month for this budget year.
  let calThru: number
  if (year < today.getFullYear()) calThru = 11
  else if (year > today.getFullYear()) calThru = -1
  else calThru = today.getMonth() - 1

  if (calThru <= thru) return byMonth

  const covered = new Set<string>()
  const sums = Array.from({ length: 12 }, () => ({
    revenue: 0,
    cogs: 0,
    expenses: 0,
  }))
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0)

  for (const e of entries) {
    for (const iso of entryCoveredIsos(e.week_start_date, e.days)) {
      covered.add(iso)
    }
    const d = dateFromIso(e.week_start_date)
    if (d.getFullYear() !== year) continue
    const m = d.getMonth()
    sums[m].revenue += num(e.kpi_values?.revenue)
    sums[m].cogs += num(e.kpi_values?.cogs)
    sums[m].expenses += num(e.kpi_values?.expenses)
  }

  for (let m = thru + 1; m <= calThru; m++) {
    const lastDay = new Date(year, m + 1, 0).getDate()
    let complete = true
    for (let day = 1; day <= lastDay; day++) {
      if (!covered.has(isoDate(new Date(year, m, day)))) {
        complete = false
        break
      }
    }
    byMonth[m] = { ...sums[m], complete }
  }
  return byMonth
}
