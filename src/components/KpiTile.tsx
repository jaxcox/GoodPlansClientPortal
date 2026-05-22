import { InfoIcon } from './InfoIcon'
import type { KpiFormat, KpiDirection } from '../lib/kpis'
import { ProgressRing, computeRingStatus, computeBand } from './ProgressRing'

type Props = {
  label: string
  /** Optional KPI description for the InfoIcon. */
  desc?: string
  format: KpiFormat
  direction: KpiDirection
  /** Current period's value. null when not entered / not derivable. */
  value: number | null
  /** Period goal. null when no goal set. */
  goal: number | null
  /** Optional week-over-week delta. null when no prior-week entry exists. */
  delta?: number | null
  /** Range KPI (Accounts Receivable): on-target when within ±10% of goal,
   *  regardless of direction. */
  range?: boolean
  /** Hide the "% of goal" indicator in the footer (right side of the
   *  goal row). Used for custom KPIs where the % comparison reads
   *  weirdly (e.g. "Goal: 4.8 reviews · 98%"). */
  hideGoalPct?: boolean
  /** Suppress the goal line entirely — title + value + (optional delta)
   *  only. Used for "awareness-only" tiles like Weekly Expenses where
   *  the coach doesn't want to set a per-week target. */
  hideGoal?: boolean
  /** Tile visualization: 'number' (default) shows the big number inline;
   *  'ring' wraps the number in a circular progress ring that fills from
   *  red → yellow → green based on actual/goal. Used on Financials
   *  dashboard tiles. */
  view?: 'number' | 'ring'
}

// Tile-format helpers ---------------------------------------------------------

export function formatValue(n: number | null, format: KpiFormat): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (format === '$') {
    if (Math.abs(n) >= 100000) {
      return `$${Math.round(n).toLocaleString('en-US')}`
    }
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  if (format === '%') {
    return `${n.toFixed(1)}%`
  }
  // Count (#): show decimals when the number has a fractional part so the
  // displayed goal matches the math (e.g. 7.5 estimates instead of "7" or
  // "8" with a misleading percentage).
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })
}

export function formatDelta(n: number, format: KpiFormat): string {
  const sign = n > 0 ? '▲' : '▼'
  const abs = Math.abs(n)
  return `${sign} ${formatValue(abs, format)}`
}

/** "Achieved!" / on-track determination per the doc 03 color rules. */
function isOnTrack(
  value: number | null,
  goal: number | null,
  direction: KpiDirection,
  range: boolean
): boolean | null {
  if (goal == null || goal === 0) return null
  if (value == null) return null
  if (range) {
    const band = goal * 0.1
    return Math.abs(value - goal) <= band
  }
  return direction === 'lo' ? value <= goal : value >= goal
}

/** Percent of goal — only meaningful for non-range KPIs with a goal. */
function pctOfGoal(value: number | null, goal: number | null): number | null {
  if (!goal || value == null) return null
  return (value / goal) * 100
}

// Component -------------------------------------------------------------------

export function KpiTile({
  label,
  desc,
  format,
  direction,
  value,
  goal,
  delta,
  range = false,
  hideGoalPct = false,
  hideGoal = false,
  view = 'number',
}: Props) {
  const effectiveGoal = goal
  const onTrack = isOnTrack(value, effectiveGoal, direction, range)
  const pct = pctOfGoal(value, effectiveGoal)
  const ring =
    view === 'ring'
      ? computeRingStatus({ value, goal: effectiveGoal, direction, range })
      : null

  // Footer goal text shifts color with on-track status — green when at
  // goal or better, red when behind. White when no goal/value yet.
  const footerColor =
    onTrack == null ? 'text-white' : onTrack ? 'text-good' : 'text-bad'

  // Delta arrow color: directional. Higher-better KPIs going up is good
  // (green); wrong way is bad (red). Inverted KPIs flip. Ring view uses
  // black inside the cream ring since the ring color carries status.
  const deltaColor = (() => {
    if (view === 'ring') return 'text-black'
    if (delta == null || delta === 0) return 'text-white'
    const isGood = direction === 'lo' ? delta < 0 : delta > 0
    return isGood ? 'text-good' : 'text-bad'
  })()

  // Ring view: no dark card wrapper. Modeled after the Apple Card payment
  // ring — title above, big value inside the ring, goal caption below.
  if (ring) {
    return (
      <div className="relative flex flex-col items-center text-center px-2 py-3">
        {!range && onTrack === true && (
          <div className="absolute top-0 right-2 text-[10px] font-bold text-good">
            Achieved!
          </div>
        )}
        <div className="text-xs font-semibold uppercase tracking-wider text-black mb-2 flex items-center justify-center gap-1.5">
          <span>{label}</span>
          {desc && <InfoIcon text={desc} />}
        </div>
        <ProgressRing
          progress={ring.progress}
          color={ring.color}
          size={240}
          strokeWidth={20}
        >
          <div className="flex flex-col items-center justify-center max-w-[180px]">
            <div className="text-3xl font-bold text-black leading-none">
              {formatValue(value, format)}
            </div>
            <div className="text-xs text-black mt-1">
              {effectiveGoal == null ? (
                <span>No goal set</span>
              ) : range ? (
                <span>
                  Goal: {formatValue(effectiveGoal, format)} (±10%)
                </span>
              ) : format === '%' ? (
                <span>Goal: {effectiveGoal.toFixed(1)}%</span>
              ) : (
                <span>Goal: {formatValue(effectiveGoal, format)}</span>
              )}
            </div>
          </div>
        </ProgressRing>
      </div>
    )
  }

  // Suppress unused-state warnings — derived values kept for future
  // re-use even though the current number-view layout doesn't render
  // an explicit goal-pct or "Achieved!" badge.
  void footerColor
  void pct
  void hideGoalPct

  // Value-text color from the same three-tone band the rings + primary
  // tiles use. Defaults to white when there's no goal / value yet.
  const band = computeBand({
    value,
    goal: effectiveGoal,
    direction,
    range,
  })
  const valueColor =
    band === 'green'
      ? 'text-good'
      : band === 'yellow'
        ? 'text-accent'
        : band === 'red'
          ? 'text-bad'
          : 'text-white'

  // Number view: title in the top-left corner, value (band-colored)
  // + optional delta arrow + goal caption stacked centered below.
  // Matches the visual rhythm of the primary FinancialsRowTile so the
  // whole dashboard reads consistently.
  return (
    <div className="bg-ink rounded-lg p-3 min-h-[110px] flex flex-col">
      <div className="flex items-center gap-0.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          {label}
        </div>
        {desc && <InfoIcon text={desc} />}
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-lg font-bold leading-none ${valueColor}`}>
          {formatValue(value, format)}
        </div>
        {!hideGoal && (
          <div className="text-sm text-white mt-1">
            {effectiveGoal == null ? (
              <span>No goal set</span>
            ) : range ? (
              <span>Goal: {formatValue(effectiveGoal, format)} (±10%)</span>
            ) : format === '%' ? (
              <span>Goal: {effectiveGoal.toFixed(1)}%</span>
            ) : (
              <span>Goal: {formatValue(effectiveGoal, format)}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
