import type { BudgetView } from '../lib/budget'

type Props = {
  view: BudgetView | null
  /** True when YTD actuals exist (any non-zero values). Banners hide when there's
   *  nothing to compare actuals against. */
  hasYtdActuals: boolean
}

/** Two banners that appear under the YTD Actuals card when actuals exist:
 *  Revenue and Gross Profit, each comparing actual-to-date to the planned-to-date
 *  budget. Red when behind, green when on or above plan.
 *
 *  Doc 05 spec: the GP banner adds a note when behind that the remaining
 *  monthly goals have been adjusted to close the gap (computeBudgetView in
 *  lib/budget.ts owns the auto-adjust math).
 */
export function BudgetStatusBanners({ view, hasYtdActuals }: Props) {
  if (!view || !hasYtdActuals) return null

  const revenueBehind = view.revenueGap < -0.5
  const gpBehind = view.gpGap < -0.5

  return (
    <div className="space-y-2">
      <Banner
        kind={revenueBehind ? 'behind' : 'on'}
        label="Revenue"
        planned={view.ytdRevenuePlanned}
        actual={view.ytdRevenueActual}
        gap={view.revenueGap}
      />
      <Banner
        kind={gpBehind ? 'behind' : 'on'}
        label="Gross Profit"
        planned={view.ytdGpPlanned}
        actual={view.ytdGpActual}
        gap={view.gpGap}
        adjustedNote={
          gpBehind
            ? 'Remaining monthly goals adjusted to close this GP gap.'
            : null
        }
      />
    </div>
  )
}

function Banner({
  kind,
  label,
  planned,
  actual,
  gap,
  adjustedNote,
}: {
  kind: 'behind' | 'on'
  label: string
  planned: number
  actual: number
  gap: number
  adjustedNote?: string | null
}) {
  const isBehind = kind === 'behind'
  return (
    <div
      className={`flex gap-3 items-start rounded p-3 border ${
        isBehind
          ? 'bg-bad/10 border-bad'
          : 'bg-good/10 border-good'
      }`}
    >
      <div
        className={`text-base font-bold leading-none ${
          isBehind ? 'text-white' : 'text-white'
        }`}
        aria-hidden="true"
      >
        {isBehind ? '!' : '✓'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-bold">
          {label} — {isBehind ? 'Behind Budget' : 'On Track'}
        </div>
        <div className="text-white text-xs mt-0.5">
          Planned to date: {formatDollars(planned)} · Actual:{' '}
          {formatDollars(actual)} ·{' '}
          <span className="font-semibold">
            {gap >= 0 ? '+' : ''}
            {formatDollars(gap)}
          </span>
        </div>
        {adjustedNote && (
          <div className="text-white text-xs italic mt-1">{adjustedNote}</div>
        )}
      </div>
    </div>
  )
}

function formatDollars(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}${Math.abs(n).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })}`
}
