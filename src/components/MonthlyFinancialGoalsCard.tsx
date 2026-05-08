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

  const anyAdjusted = view.months.some((m) => m.isAdjusted)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="text-white text-xs">
          Remaining income to produce:{' '}
          <strong>{formatDollars(view.remainingRevenue)}</strong> across{' '}
          {view.remainingMonths} month
          {view.remainingMonths === 1 ? '' : 's'}
        </div>
        <div className="text-white text-xs">
          Remaining gross profit:{' '}
          <strong>{formatDollars(view.remainingGrossProfit)}</strong>
        </div>
        <div className="text-white text-xs">
          Remaining net profit:{' '}
          <strong>{formatDollars(view.remainingNetProfit)}</strong>
        </div>
      </div>
      {anyAdjusted && (
        <div className="text-white text-xs italic">
          Future-month targets above the baseline are <strong>adjusted</strong>{' '}
          to close the YTD GP gap.
        </div>
      )}
      <div className="text-white text-xs italic">
        Numbers are rounded to whole dollars; per-month figures may differ
        from totals by a dollar or two.
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {view.months.map((m) => (
          <MonthTile key={m.monthIdx} month={m} />
        ))}
      </div>
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
