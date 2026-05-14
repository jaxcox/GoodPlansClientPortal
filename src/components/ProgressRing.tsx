import type { ReactNode } from 'react'

/** Resolved color for the ring's filled arc plus the second-lap overlay
 *  opacity (semi-transparent black laid on top of the overage arc so
 *  the overlap reads as a slightly darker shade). Tuned per color since
 *  red needs more darkening than green / yellow to stay visible. */
export type RingColor = { stroke: string; overlapOpacity: number }

type Props = {
  /** Pixel diameter. */
  size?: number
  /** Stroke width of the ring (background + foreground). */
  strokeWidth?: number
  /** 0–1+. Capped at 1 for the visual fill; values > 1 show as a full ring. */
  progress: number
  /** Resolved color for the filled arc. null = no foreground arc (only
   *  the gray background ring shows). */
  color: RingColor | null
  /** Centered content — typically the formatted KPI value. */
  children: ReactNode
}

/** Empty-state ring color — light gray ring drawn behind any progress
 *  arc. Visible against the page background (#dad7c5). */
const BG_COLOR = '#bdb9a4'

/** Circular progress ring with content centered inside. Used by KpiTile
 *  in 'ring' view to wrap the big number with a fill that shows how
 *  close the actual is to the goal. Foreground color is a continuous
 *  hue gradient resolved by computeRingStatus — red at low progress,
 *  yellow mid, green at goal. */
export function ProgressRing({
  size = 80,
  strokeWidth = 14,
  progress,
  color,
  children,
}: Props) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  // First lap: 0–1 fills the ring. >1 always renders the full ring.
  const firstLap = Math.max(0, Math.min(progress, 1))
  const firstOffset = circumference * (1 - firstLap)
  // Second lap: only for progress > 1, drawn on top of the first ring
  // and tinted darker via a CSS brightness filter so the overlap is
  // visible. Capped at one additional full lap (progress 2.0).
  const secondLap = Math.max(0, Math.min(progress - 1, 1))
  const secondOffset = circumference * (1 - secondLap)
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        {/* Inner fill — cream-colored disk that sits behind the rings,
            visible through the donut hole. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius - strokeWidth / 2}
          fill="#fffbef"
          stroke="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={BG_COLOR}
          strokeWidth={strokeWidth}
        />
        {color !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color.stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={firstOffset}
            strokeLinecap="round"
          />
        )}
        {color !== null && secondLap > 0 && (
          <>
            {/* Second lap drawn on top of the first ring in the same color. */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color.stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={secondOffset}
              strokeLinecap="round"
            />
            {/* Darkening overlay — semi-transparent black on top of the
                second-lap arc so the overlap reads as a visibly darker
                shade of the underlying color. Opacity tuned per color
                (red needs slightly more darkening than green/yellow). */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="black"
              strokeWidth={strokeWidth}
              strokeDasharray={circumference}
              strokeDashoffset={secondOffset}
              strokeLinecap="round"
              opacity={color.overlapOpacity}
            />
          </>
        )}
      </svg>
      <div className="relative z-10 text-center px-1">{children}</div>
    </div>
  )
}

/** Three-tone traffic-light palette. Stroke uses CSS vars so the global
 *  theme stays the source of truth; overlapOpacity tunes how much the
 *  second-lap overlay darkens the overage portion of the ring. */
const COLOR_GREEN: RingColor = {
  stroke: 'var(--color-good)',
  overlapOpacity: 0.06,
}
const COLOR_YELLOW: RingColor = {
  stroke: 'var(--color-accent)',
  overlapOpacity: 0.06,
}
const COLOR_RED: RingColor = {
  stroke: 'var(--color-bad)',
  overlapOpacity: 0.08,
}

/** Compute the ring's progress + color from a tile's value / goal /
 *  direction. Discrete three-tone (green / yellow / red), no blending.
 *  "Within 10%" is always relative to the goal value, so for % KPIs
 *  (GP Margin, NP Margin) a goal of 15% with an actual of 5% reads as
 *  red (33% of goal) — not yellow.
 *
 *  - direction='hi': < 90% of goal = red. 90–100% = yellow. ≥ 100% = green.
 *  - direction='lo' (Expenses): ≤ goal = green. 100–110% = yellow.
 *    > 110% = red.
 *  - range (AR): within ±10% = green. ±10–15% = yellow. > ±15% = red.
 *    Ring is always full for range KPIs. */
/** Returns just the color band identifier (no fill/overlay info). Same
 *  thresholds as `computeRingStatus` — used by surfaces other than the
 *  ring that need the band tag (e.g. History cells, FinancialsRowTile
 *  result text). Null when no goal or no value. */
export function computeBand({
  value,
  goal,
  direction,
  range,
}: {
  value: number | null
  goal: number | null
  direction: 'hi' | 'lo'
  range: boolean
}): 'green' | 'yellow' | 'red' | null {
  if (value == null || goal == null || goal === 0) return null
  if (range) {
    const dev = Math.abs(value - goal) / goal
    if (dev <= 0.1) return 'green'
    if (dev <= 0.15) return 'yellow'
    return 'red'
  }
  const ratio = value / goal
  if (direction === 'hi') {
    if (ratio >= 1) return 'green'
    if (ratio >= 0.9) return 'yellow'
    return 'red'
  }
  if (ratio <= 1) return 'green'
  if (ratio <= 1.1) return 'yellow'
  return 'red'
}

export function computeRingStatus({
  value,
  goal,
  direction,
  range,
}: {
  value: number | null
  goal: number | null
  direction: 'hi' | 'lo'
  range: boolean
}): { progress: number; color: RingColor | null } {
  if (value == null || goal == null || goal === 0) {
    return { progress: 0, color: null }
  }
  if (range) {
    const dev = Math.abs(value - goal) / goal
    if (dev <= 0.1) return { progress: 1, color: COLOR_GREEN }
    if (dev <= 0.15) return { progress: 1, color: COLOR_YELLOW }
    return { progress: 1, color: COLOR_RED }
  }
  const ratio = value / goal
  if (direction === 'hi') {
    // Preserve the raw ratio so the ring can render a second lap when
    // the value exceeds the goal (progress > 1).
    if (ratio >= 1) return { progress: ratio, color: COLOR_GREEN }
    if (ratio >= 0.9) return { progress: ratio, color: COLOR_YELLOW }
    return { progress: ratio, color: COLOR_RED }
  }
  // direction === 'lo' (Expenses). Preserve raw ratio when over goal so
  // the ring renders a second lap (yellow / red) for visible overspend.
  if (ratio <= 1) return { progress: ratio, color: COLOR_GREEN }
  if (ratio <= 1.1) return { progress: ratio, color: COLOR_YELLOW }
  return { progress: ratio, color: COLOR_RED }
}
