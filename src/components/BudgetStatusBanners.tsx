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
        label="Income"
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
      className={`rounded-lg p-3 ring-2 ${
        isBehind ? 'bg-yellow-50 ring-accent' : 'bg-green-50 ring-good'
      }`}
    >
      <div className="text-black text-sm font-bold">
        {label} — {isBehind ? 'Behind Budget' : 'On Track'}
      </div>
      <div className="text-black text-xs mt-0.5">
        Planned to date: {formatDollars(planned)} · Actual:{' '}
        {formatDollars(actual)} ·{' '}
        <span className="font-semibold">
          {gap >= 0 ? '+' : ''}
          {formatDollars(gap)}
        </span>
      </div>
      {adjustedNote && (
        <div className="text-black text-xs italic mt-1">{adjustedNote}</div>
      )}
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
