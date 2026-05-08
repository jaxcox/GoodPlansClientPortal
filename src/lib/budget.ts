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
