// =============================================================================
// computeBand — three-tone color band for a KPI's actual vs. goal.
//
// Used by every surface that renders a KPI value next to its goal: weekly
// tiles, cumulative tiles, History grid cells, the PDF report. Same
// thresholds across the board so the dashboard / history / report colors
// line up.
//
//  - direction='hi': < 90% of goal = red. 90–100% = yellow. ≥ 100% = green.
//  - direction='lo' (Expenses): ≤ goal = green. 100–110% = yellow.
//    > 110% = red.
//  - range (AR, Utilization, Labor Efficiency): within ±10% = green, else
//    red. Two-tone — the yellow "close" middle doesn't translate to a
//    bidirectional target where missing by 14% in either direction is just
//    as off as missing by 30%.
// =============================================================================

export type Band = 'green' | 'yellow' | 'red'

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
}): Band | null {
  if (value == null || goal == null || goal === 0) return null
  if (range) {
    return Math.abs(value - goal) / goal <= 0.1 ? 'green' : 'red'
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

/** Resolve a band to the matching CSS color variable. Used by callers
 *  that need to set an inline `backgroundColor` (e.g. the pacebar fill
 *  in FinancialsRowTile) rather than a Tailwind class. */
export function bandColorVar(band: Band): string {
  if (band === 'green') return 'var(--color-good)'
  if (band === 'yellow') return 'var(--color-accent)'
  return 'var(--color-bad)'
}
