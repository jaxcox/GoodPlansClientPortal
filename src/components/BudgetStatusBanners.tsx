import type { BudgetView } from '../lib/budget'

type Props = {
  view: BudgetView | null
  /** True when YTD actuals exist (any non-zero values). Banners hide when there's
   *  nothing to compare actuals against. */
  hasYtdActuals: boolean
  /** Compact mode for the YTD Actuals card header — single-line pills, smaller
   *  padding, no planned/actual breakdown. */
  compact?: boolean
}

/** Income + Gross Profit status compared to plan-to-date. Default layout is
 *  two stacked banners; `compact` shrinks them to single-line pills suitable
 *  for the top-right of a card header.
 *
 *  Doc 05 spec: the GP banner adds a note when behind that the remaining
 *  monthly goals have been adjusted to close the gap (computeBudgetView in
 *  lib/budget.ts owns the auto-adjust math).
 */
export function BudgetStatusBanners({
  view,
  hasYtdActuals,
  compact = false,
}: Props) {
  if (!view || !hasYtdActuals) return null

  const revenueBehind = view.revenueGap < -0.5
  const gpBehind = view.gpGap < -0.5

  if (compact) {
    return (
      <div className="space-y-1">
        <CompactPill
          kind={revenueBehind ? 'behind' : 'on'}
          label="Income"
          gap={view.revenueGap}
        />
        <CompactPill
          kind={gpBehind ? 'behind' : 'on'}
          label="Gross Profit"
          gap={view.gpGap}
        />
        {gpBehind && (
          <div className="text-white text-xs italic">
            Remaining monthly goals adjusted to close this GP gap.
          </div>
        )}
      </div>
    )
  }

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

function CompactPill({
  kind,
  label,
  gap,
}: {
  kind: 'behind' | 'on'
  label: string
  gap: number
}) {
  const isBehind = kind === 'behind'
  return (
    <div
      className={`rounded px-2 py-1 ring-2 text-xs whitespace-nowrap ${
        isBehind ? 'bg-yellow-50 ring-accent' : 'bg-green-50 ring-good'
      }`}
    >
      <span className="text-black font-bold">{label}: </span>
      <span className="text-black">
        {isBehind ? 'Behind Budget' : 'On Track'}{' '}
      </span>
      <span className="text-black font-bold">
        {gap >= 0 ? '+' : ''}
        {formatDollars(gap)}
      </span>
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
