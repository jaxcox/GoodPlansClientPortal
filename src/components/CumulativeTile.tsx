// =============================================================================
// CumulativeTile — MTD / QTD / YTD tile variant
// =============================================================================
// Doc-08. Same dark "ink" tile chrome as the weekly KpiTile, but the body
// swaps in:
//
//   - A thin progress bar (actual ÷ paceGoal, capped at 100%) for sum / dollar
//     / count KPIs. Bar color follows the pace color.
//   - A "Pace: X · Goal: Y" line below — pace in the tile color, full goal in
//     muted gray. Tells the user both where they should be by today and where
//     they need to finish.
//   - For % / range / avg KPIs (no meaningful "amount accumulated" concept),
//     the bar is hidden and we render a simple "+X.X% vs goal" delta line.
//
// Color rule is pace-based: green when actual is at-or-above paceGoal (or
// at-or-below for direction='lo'), red when behind. Range KPIs (Accounts
// Receivable) use ±10% of the full goal instead. White when there's no
// resolvable goal yet. Two-tone in cumulative mode — the weekly band's yellow
// "close but not quite" middle doesn't translate to a period rollup, where
// the question is just "are you on track or not."
//
// "Achieved!" badge: top-right corner when actual ≥ fullGoal (≤ for lo).
// Range KPIs don't show it — they're not "complete-able."

import { InfoIcon } from './InfoIcon'
import { formatValue } from './KpiTile'
import type { KpiFormat, KpiDirection } from '../lib/kpis'

type Props = {
  label: string
  desc?: string
  format: KpiFormat
  direction: KpiDirection
  /** Cumulative actual for the period (e.g. summed revenue MTD). */
  value: number | null
  /** Period-total goal — the "finish line" for the period. */
  fullGoal: number | null
  /** Pace-adjusted goal (fullGoal × paceFrac). The color anchor. */
  paceGoal: number | null
  /** Range KPI (Accounts Receivable): on-target within ±10% of fullGoal,
   *  not pace-based. */
  range?: boolean
  /** Suppress the "Achieved!" badge even when actual would qualify.
   *  Used for direction='lo' accumulators like Expenses where the
   *  inverted "achieved when under goal" fires too early in the period. */
  hideAchieved?: boolean
  /** Double-height "primary KPI" variant — matches the weekly
   *  FinancialsRowTile primary tile sizing (220px min, larger value).
   *  Coaches read the output KPIs of each department at a glance. */
  tall?: boolean
  /** Pre-formatted value string. When supplied, overrides the
   *  auto-formatted output of formatValue() — used by capacity tiles
   *  whose values carry custom units ("1,800 hrs", "12 slots"). The
   *  numeric `value` is still used for color/pace math. */
  valueText?: string
  /** Pre-formatted pace + full-goal strings. Optional — falls back to
   *  formatValue() when not supplied. Used by capacity tiles so the
   *  pace/goal line uses the same custom units as the value. */
  paceText?: string
  goalText?: string
  /** Optional small sub-label rendered between the value and the
   *  footer. Used on capacity tiles to surface the derived
   *  utilization %, e.g. "75% utilization". */
  subLabel?: string
}

type PaceColor = 'green' | 'red' | null

function paceColor(
  value: number | null,
  paceGoal: number | null,
  fullGoal: number | null,
  direction: KpiDirection,
  range: boolean
): PaceColor {
  if (value == null) return null
  if (range) {
    if (fullGoal == null || fullGoal === 0) return null
    return Math.abs(value - fullGoal) / fullGoal <= 0.1 ? 'green' : 'red'
  }
  if (paceGoal == null || paceGoal === 0) return null
  return direction === 'lo'
    ? value <= paceGoal
      ? 'green'
      : 'red'
    : value >= paceGoal
      ? 'green'
      : 'red'
}

function isAchieved(
  value: number | null,
  fullGoal: number | null,
  direction: KpiDirection,
  range: boolean
): boolean {
  if (range) return false
  if (value == null || fullGoal == null || fullGoal === 0) return false
  return direction === 'lo' ? value <= fullGoal : value >= fullGoal
}

export function CumulativeTile({
  label,
  desc,
  format,
  direction,
  value,
  fullGoal,
  paceGoal,
  range = false,
  hideAchieved = false,
  tall = false,
  valueText,
  paceText,
  goalText,
  subLabel,
}: Props) {
  const minH = tall ? 'min-h-[220px]' : 'min-h-[110px]'
  const valueTextSize = tall
    ? 'text-3xl font-semibold leading-none'
    : 'text-xl font-bold leading-none'
  const color = paceColor(value, paceGoal, fullGoal, direction, range)
  const valueColor =
    color === 'green' ? 'text-good' : color === 'red' ? 'text-bad' : 'text-white'
  const barColor =
    color === 'green' ? 'bg-good' : color === 'red' ? 'bg-bad' : 'bg-white/30'
  const achieved =
    !hideAchieved && isAchieved(value, fullGoal, direction, range)

  // Progress fraction for the bar. Pace goal is the denominator —
  // hitting the pace goal fills it; exceeding it stays at 100%. For
  // direction='lo' accumulators (Expenses) the bar still reads as
  // "% of budget used by now" — color carries the over/under signal.
  let progressPct = 0
  if (value != null && paceGoal && paceGoal > 0) {
    progressPct = Math.min((value / paceGoal) * 100, 100)
  }

  // Only percent and range KPIs skip the progress bar. Direction='lo'
  // sum KPIs (Expenses) still get the bar — they accumulate over the
  // period like Revenue, just colored inverse.
  const isRatio = format === '%' || range

  return (
    <div className={`bg-ink rounded-lg p-3 ${minH} flex flex-col relative`}>
      {achieved && (
        <div className="absolute top-1 right-2 text-[10px] font-bold text-good">
          Achieved!
        </div>
      )}
      <div className="flex items-center gap-0.5">
        <div className="text-sm font-semibold uppercase tracking-wider text-white">
          {label}
        </div>
        {desc && <InfoIcon text={desc} />}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`${valueTextSize} ${valueColor}`}>
          {valueText ?? formatValue(value, format)}
        </div>
        {subLabel && (
          <div className="text-sm text-white mt-1">{subLabel}</div>
        )}
        {/* Ratio / range tiles: goal caption sits centered under the
            value, same placement as Weekly — no progress bar context to
            anchor to. */}
        {isRatio && (
          <div className="text-base text-white mt-1">
            {fullGoal == null
              ? 'No goal set'
              : range
                ? `Goal: ${goalText ?? formatValue(fullGoal, format)} (±10%)`
                : `Goal: ${goalText ?? formatValue(fullGoal, format)}`}
          </div>
        )}
      </div>

      {/* Sum tiles get the progress bar with Pace + Goal split below.
          Same text size and white color as the Weekly tile's goal line. */}
      {!isRatio && (
        <div>
          <div className="h-[3px] bg-line rounded-full overflow-hidden mb-1">
            <div
              className={`h-full ${barColor}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-base text-white">
            <span>
              {paceGoal == null
                ? 'No goal set'
                : `Pace: ${paceText ?? formatValue(paceGoal, format)}`}
            </span>
            <span>
              {fullGoal == null
                ? ''
                : `Goal: ${goalText ?? formatValue(fullGoal, format)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
