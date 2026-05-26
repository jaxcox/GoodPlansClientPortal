import { InfoIcon } from './InfoIcon'
import { MONTH_LABELS, type BudgetView } from '../lib/budget'

type Props = {
  view: BudgetView | null
}

/** Per-month Revenue / COGS / GP / GP% tiles for the year. Past months
 *  (covered by YTD actuals) are greyed and show actuals. Future months show
 *  the targeted budget — auto-adjusted to close the GP gap when YTD is
 *  behind plan. Doc 05 Card 4. */
export function MonthlyFinancialGoalsCard({ view }: Props) {
  if (!view) {
    return (
      <div className="text-white text-xs leading-relaxed">
        Set <strong>Income Target</strong> and{' '}
        <strong>Gross Profit %</strong> on the Targets tab to see your monthly
        financial goals here.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {view.months.map((m) => (
        <MonthTile key={m.monthIdx} month={m} />
      ))}
    </div>
  )
}

/** Standalone tile row showing remaining income / gross profit / net profit
 *  for the year. Rendered ABOVE the Monthly Financial Goals card so the
 *  card itself stays focused on the per-month grid. Returns null when no
 *  budget view is available yet. */
export function MonthlyGoalsRemainingTiles({ view }: { view: BudgetView | null }) {
  if (!view) return null
  const anyAdjusted = view.months.some((m) => m.isAdjusted)
  // Adjustments fire symmetrically: a negative gpGap means YTD is behind
  // plan (raise future targets); positive means ahead (lower them).
  const aheadOfPlan = view.gpGap > 0

  return (
    <div className="space-y-3 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <RemainingTile
          label="Remaining Income"
          subLabel={
            view.remainingMonths > 0
              ? `${view.remainingMonths} mo`
              : undefined
          }
          value={formatDollars(view.remainingRevenue)}
        />
        <RemainingTile
          label="Remaining Gross Profit"
          value={formatDollars(view.remainingGrossProfit)}
        />
        <RemainingTile
          label="Remaining Net Profit"
          value={formatDollars(view.remainingNetProfit)}
        />
        <InfoIcon text="What's still left for the rest of the year. When YTD is ahead or behind plan, future months adjust so the year still lands on the original annual goal. Numbers are rounded to whole dollars; per-month figures may differ from totals by a dollar or two." />
      </div>
      {anyAdjusted && (
        <div className="text-black text-xs italic">
          {aheadOfPlan
            ? 'YTD is ahead of plan — future-month targets are lowered so the year still lands on the annual Gross Profit goal.'
            : 'YTD is behind plan — future-month targets are raised so the year still lands on the annual Gross Profit goal.'}
        </div>
      )}
    </div>
  )
}

/** Header tile — same geometry as the WeekOfCalendarPill on the Weekly
 *  Dashboard (rounded square, font-semibold, inline-flex). Background is
 *  bg-surface-1 + border-line so the tile reads against the surrounding
 *  page surface; border matches the derived-box treatment rule for
 *  non-fillable values. Yellow · separators between label, optional
 *  sub-label, and value carry the visual rhythm of the row. */
function RemainingTile({
  label,
  subLabel,
  value,
}: {
  label: string
  subLabel?: string
  value: string
}) {
  return (
    <div className="bg-surface-1 border border-line text-white px-3 py-1 rounded font-semibold inline-flex items-center gap-2">
      <span>{label}</span>
      {subLabel && (
        <>
          <span aria-hidden className="text-accent">
            ·
          </span>
          <span>{subLabel}</span>
        </>
      )}
      <span aria-hidden className="text-accent">
        ·
      </span>
      <strong>{value}</strong>
    </div>
  )
}

function MonthTile({
  month,
}: {
  month: BudgetView['months'][number]
}) {
  const label = MONTH_LABELS[month.monthIdx]
  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        month.isPast
          ? 'border-line opacity-60'
          : month.isAdjusted
            ? 'border-accent'
            : 'border-line'
      }`}
    >
      {/* White header — month label */}
      <div className="bg-white px-3 py-2 flex justify-between items-baseline border-b border-line">
        <div className="text-black text-sm font-bold">
          {label}
          {month.isPast && ' ✓'}
        </div>
        {month.isAdjusted && !month.isPast && (
          <div className="text-black text-xs font-semibold uppercase tracking-wider">
            Adjusted
          </div>
        )}
      </div>

      {/* Beige body — financial values */}
      <div className="bg-beige p-3">
        <Row label="Income" value={formatDollars(month.revenue)} bold />
        <hr className="border-black/20 my-2" />
        <Row
          label="Gross Profit"
          value={formatDollars(month.grossProfit)}
          sub={`(${month.gpPct.toFixed(1)}%)`}
          bold
        />
        <hr className="border-black/20 my-2" />
        <Row
          label="Cost of Goods"
          value={formatDollars(month.cogs)}
          sub={`(${(100 - month.gpPct).toFixed(1)}%)`}
        />
        <hr className="border-black/20 my-2" />
        <Row label="Expenses" value={formatDollars(month.expenses)} />
        <hr className="border-black/20 my-2" />
        <Row
          label="Net Profit"
          value={formatDollars(month.netProfit)}
          sub={`(${month.netProfitPct.toFixed(1)}%)`}
          bold
        />
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  sub,
  bold,
}: {
  label: string
  value: string
  sub?: string
  bold?: boolean
}) {
  return (
    <div className="flex justify-between items-baseline text-xs text-black leading-snug">
      <div>{label}</div>
      <div className={bold ? 'font-bold' : ''}>
        {value}
        {sub && <span className="ml-1 text-black">{sub}</span>}
      </div>
    </div>
  )
}

function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
