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
      className={`bg-surface-2 rounded-lg p-3 border ${
        month.isPast
          ? 'border-line opacity-60'
          : month.isAdjusted
            ? 'border-accent'
            : 'border-line'
      }`}
    >
      <div className="flex justify-between items-baseline mb-2">
        <div className="text-white text-sm font-bold">
          {label}
          {month.isPast && ' ✓'}
        </div>
        {month.isAdjusted && !month.isPast && (
          <div className="text-white text-xs font-semibold uppercase tracking-wider">
            Adjusted
          </div>
        )}
      </div>
      <Row label="Income" value={formatDollars(month.revenue)} bold />
      <hr className="border-line my-2" />
      <Row
        label="Gross Profit"
        value={formatDollars(month.grossProfit)}
        sub={`(${month.gpPct.toFixed(1)}%)`}
        bold
      />
      <hr className="border-line my-2" />
      <Row
        label="Cost of Goods"
        value={formatDollars(month.cogs)}
        sub={`(${(100 - month.gpPct).toFixed(1)}%)`}
      />
      <hr className="border-line my-2" />
      <Row label="Expenses" value={formatDollars(month.expenses)} />
      <Row
        label="Net Profit"
        value={formatDollars(month.netProfit)}
        sub={`(${month.netProfitPct.toFixed(1)}%)`}
        bold
      />
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
    <div className="flex justify-between items-baseline text-xs text-white leading-snug">
      <div>{label}</div>
      <div className={bold ? 'font-bold' : ''}>
        {value}
        {sub && <span className="ml-1 text-white">{sub}</span>}
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
