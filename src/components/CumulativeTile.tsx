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
}: Props) {
  const minH = tall ? 'min-h-[220px]' : 'min-h-[110px]'
  const valueTextSize = tall
    ? 'text-3xl font-semibold leading-none'
    : 'text-lg font-bold leading-none'
  const color = paceColor(value, paceGoal, fullGoal, direction, range)
  const valueColor =
    color === 'green' ? 'text-good' : color === 'red' ? 'text-bad' : 'text-white'
  const barColor =
    color === 'green' ? 'bg-good' : color === 'red' ? 'bg-bad' : 'bg-white/30'
  const paceTextColor =
    color === 'green' ? 'text-good' : color === 'red' ? 'text-bad' : 'text-white'
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

  // Per doc-08, only percent and range KPIs get the simpler "+X vs goal"
  // line. Direction='lo' sum KPIs (Expenses) still get the progress bar
  // — they accumulate $ over the period just like Revenue, just colored
  // inverse.
  const isRatio = format === '%' || range

  // Delta line for ratio / range tiles ("+1.9% vs 50.0% goal" style).
  let deltaText: string | null = null
  if (isRatio && value != null && fullGoal != null) {
    const diff = value - fullGoal
    const sign = diff >= 0 ? '+' : '−'
    const absStr =
      format === '%'
        ? `${Math.abs(diff).toFixed(1)}%`
        : formatValue(Math.abs(diff), format)
    deltaText = `${sign}${absStr} vs ${formatValue(fullGoal, format)} goal`
  }

  return (
    <div className={`bg-ink rounded-lg p-3 ${minH} flex flex-col relative`}>
      {achieved && (
        <div className="absolute top-1 right-2 text-[10px] font-bold text-good">
          Achieved!
        </div>
      )}
      <div className="flex items-center gap-0.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          {label}
        </div>
        {desc && <InfoIcon text={desc} />}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`${valueTextSize} ${valueColor}`}>
          {formatValue(value, format)}
        </div>
      </div>

      {/* Footer: progress bar + pace/goal split for sum KPIs, simple
          delta line for %/range KPIs. Stays at the bottom regardless of
          which variant is rendered. */}
      {isRatio ? (
        <div className={`text-xs ${paceTextColor}`}>
          {deltaText ?? (fullGoal == null ? 'No goal set' : '—')}
        </div>
      ) : (
        <div>
          <div className="h-[3px] bg-line rounded-full overflow-hidden mb-1">
            <div
              className={`h-full ${barColor}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className={paceTextColor}>
              {paceGoal == null
                ? 'No goal set'
                : `Pace: ${formatValue(paceGoal, format)}`}
            </span>
            <span className="text-mute">
              {fullGoal == null ? '' : `Goal: ${formatValue(fullGoal, format)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
