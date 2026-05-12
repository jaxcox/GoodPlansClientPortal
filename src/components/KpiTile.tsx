import { InfoIcon } from './InfoIcon'
import type { KpiFormat, KpiDirection } from '../lib/kpis'

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
}

// Tile-format helpers ---------------------------------------------------------

function formatValue(n: number | null, format: KpiFormat): string {
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

function formatDelta(n: number, format: KpiFormat): string {
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
}: Props) {
  const effectiveGoal = goal
  const onTrack = isOnTrack(value, effectiveGoal, direction, range)
  const pct = pctOfGoal(value, effectiveGoal)

  // Border colors — green when on track, red when behind, neutral gray
  // when no goal exists.
  const borderClass =
    onTrack == null
      ? 'border-line'
      : onTrack
        ? 'border-good'
        : 'border-bad'

  // Footer text color matches the border state, but always white on the
  // "no goal set" case (per the font color rule — no gray text).
  const footerColor =
    onTrack == null ? 'text-white' : onTrack ? 'text-good' : 'text-bad'

  // Delta arrow color: directional. ▲ green for higher-better KPIs going
  // up; red when going the wrong way. Inverted KPIs flip.
  const deltaColor = (() => {
    if (delta == null) return 'text-white'
    if (delta === 0) return 'text-white'
    const isGood = direction === 'lo' ? delta < 0 : delta > 0
    return isGood ? 'text-good' : 'text-bad'
  })()

  return (
    <div
      className={`bg-ink rounded-lg p-3 border ${borderClass} min-h-[110px] flex flex-col relative`}
    >
      {/* "Achieved!" badge — top-right, only for non-range on-track KPIs */}
      {!range && onTrack === true && (
        <div className="absolute top-1 right-2 text-[10px] font-bold text-good">
          Achieved!
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          {label}
        </div>
        {desc && <InfoIcon text={desc} />}
      </div>

      <div className="text-lg font-bold text-white mt-2">
        {formatValue(value, format)}
      </div>

      {delta != null && delta !== 0 && (
        <div className={`text-xs mt-1 ${deltaColor}`}>
          {formatDelta(delta, format)}
        </div>
      )}

      <div className="flex-1" />

      <div className={`border-t border-line pt-2 mt-2 text-xs ${footerColor}`}>
        {effectiveGoal == null ? (
          <span className="text-white">No goal set</span>
        ) : range ? (
          <span>
            {formatValue(value, format)} vs {formatValue(effectiveGoal, format)}{' '}
            (±10%)
          </span>
        ) : format === '%' ? (
          // % KPIs: just show the goal. The actual value is already the
          // big number above, so a "delta vs goal" line reads as if the
          // delta is the actual (e.g. "0% vs 95% goal" looks like actual=0).
          <span>Goal: {effectiveGoal.toFixed(1)}%</span>
        ) : (
          <div className="flex justify-between gap-2">
            <span>Goal: {formatValue(effectiveGoal, format)}</span>
            {!hideGoalPct && pct != null && <span>{Math.round(pct)}%</span>}
          </div>
        )}
      </div>
    </div>
  )
}
