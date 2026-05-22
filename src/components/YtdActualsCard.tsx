// =============================================================================
// YTD Actuals card
// =============================================================================
// Lifted out of Budget & Goals (2026-05-22) so it could live on Settings
// instead — coach edits the pre-coaching monthly actuals there; clients
// see a read-only summary. The card is collapsed by default since most
// of the time it's reference data that doesn't change once entered.
//
// Two view modes:
//   - Editable (coach): bulk single-total OR month-by-month entry; same
//     UI as the old B&G card.
//   - Read-only (client): just the thru-month label + the bottom-line
//     totals (Income / COGS / GP $ / GP% / Expenses / NP $ / NP%).
//
// Save plumbing is the caller's job — SettingsPage threads the state +
// setters in, runs its own onSave that PATCHes the ytd_* columns on the
// budgets row. No fetch/save happens inside this component.
//
// Why a fresh file instead of an extract+re-export from BudgetGoalsPage:
// most of the helpers below (Labeled, DerivedBox, HeaderCell, etc.) also
// live in BudgetGoalsPage where they're used by the main targets card.
// Duplicating the small ones is cheaper than the import gymnastics it
// would otherwise need.

import { useState } from 'react'
import {
  MONTH_LABELS,
  distributeAcrossMonths,
  emptyMonthArray,
  sumMonthsThru,
  type BudgetView,
  type SeasonType,
} from '../lib/budget'
import { Card } from './Card'
import { NumberField } from './NumberField'

type Props = {
  ytdThruMonth: number | null
  setYtdThruMonth: (n: number | null) => void
  revenueByMonth: (number | null)[]
  setRevenueByMonth: (arr: (number | null)[]) => void
  cogsByMonth: (number | null)[]
  setCogsByMonth: (arr: (number | null)[]) => void
  expensesByMonth: (number | null)[]
  setExpensesByMonth: (arr: (number | null)[]) => void
  seasonType: SeasonType
  seasonPct: number[]
  /** Budget engine view — drives the "Behind Budget / On Track" status
   *  line under Income / GP. May be null when there's no budget row yet. */
  view: BudgetView | null
  hasYtdActuals: boolean
  /** When true, render read-only summary instead of the edit form. */
  readOnly?: boolean
  /** Hide the Card chrome (used by the SettingsPage layout where the
   *  card sits in a column that already has its own wrapper). Defaults
   *  to false — caller renders inside a Card. */
}

export function YtdActualsCard(props: Props) {
  return (
    <Card title="YTD Actuals" id="settings:ytd-actuals">
      <Body {...props} />
    </Card>
  )
}

function Body({ readOnly, ...props }: Props) {
  if (readOnly) return <ReadOnlyView {...props} />
  return <EditableView {...props} />
}

// =============================================================================
// Read-only summary (client view)
// =============================================================================

function ReadOnlyView({
  ytdThruMonth,
  revenueByMonth,
  cogsByMonth,
  expensesByMonth,
}: Omit<Props, 'readOnly'>) {
  if (ytdThruMonth === null) {
    return (
      <div className="text-white text-xs">No YTD actuals captured yet.</div>
    )
  }
  const revenueTotal = sumMonthsThru(revenueByMonth, ytdThruMonth)
  const cogsTotal = sumMonthsThru(cogsByMonth, ytdThruMonth)
  const expensesTotal = sumMonthsThru(expensesByMonth, ytdThruMonth)
  const gp = revenueTotal - cogsTotal
  const np = gp - expensesTotal
  const gpPct = revenueTotal > 0 ? (gp / revenueTotal) * 100 : null
  const npPct = revenueTotal > 0 ? (np / revenueTotal) * 100 : null
  return (
    <div className="space-y-3">
      <div className="text-white text-xs">
        Captured through{' '}
        <strong>{MONTH_LABELS[ytdThruMonth] ?? '—'}</strong>.
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        <ReadOnlyRow label="Income" value={formatDollars(revenueTotal)} />
        <ReadOnlyRow
          label="Cost of Goods Sold"
          value={formatDollars(cogsTotal)}
        />
        <ReadOnlyRow label="Gross Profit $" value={formatDollars(gp)} />
        <ReadOnlyRow
          label="Gross Profit %"
          value={gpPct === null ? '—' : `${gpPct.toFixed(1)}%`}
        />
        <ReadOnlyRow label="Expenses" value={formatDollars(expensesTotal)} />
        <ReadOnlyRow label="Net Profit $" value={formatDollars(np)} />
        <ReadOnlyRow
          label="Net Profit %"
          value={npPct === null ? '—' : `${npPct.toFixed(1)}%`}
        />
      </div>
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </div>
      <div className="bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm px-3 py-2 min-h-[40px] flex items-center">
        {value}
      </div>
    </div>
  )
}

// =============================================================================
// Editable form (coach view) — lifted from BudgetGoalsPage's YtdActualsBody
// =============================================================================

function EditableView({
  ytdThruMonth,
  setYtdThruMonth,
  revenueByMonth,
  setRevenueByMonth,
  cogsByMonth,
  setCogsByMonth,
  expensesByMonth,
  setExpensesByMonth,
  seasonType,
  seasonPct,
  view,
  hasYtdActuals,
}: Omit<Props, 'readOnly'>) {
  const [entryMode, setEntryMode] = useState<'bulk' | 'monthly'>('bulk')
  const enabled = ytdThruMonth !== null
  const revenueTotal = sumMonthsThru(revenueByMonth, ytdThruMonth)
  const cogsTotal = sumMonthsThru(cogsByMonth, ytdThruMonth)
  const expensesTotal = sumMonthsThru(expensesByMonth, ytdThruMonth)

  const onThruMonthChange = (raw: string) => {
    if (raw === '' || raw === 'none') {
      setYtdThruMonth(null)
      setRevenueByMonth(emptyMonthArray())
      setCogsByMonth(emptyMonthArray())
      setExpensesByMonth(emptyMonthArray())
      return
    }
    const next = Number(raw)
    setYtdThruMonth(next)
    if (revenueByMonth.some((v, i) => i > next && v != null)) {
      setRevenueByMonth(
        revenueByMonth.map((v, i) => (i > next ? null : v))
      )
    }
    if (cogsByMonth.some((v, i) => i > next && v != null)) {
      setCogsByMonth(cogsByMonth.map((v, i) => (i > next ? null : v)))
    }
    if (expensesByMonth.some((v, i) => i > next && v != null)) {
      setExpensesByMonth(
        expensesByMonth.map((v, i) => (i > next ? null : v))
      )
    }
  }

  const setBulkRevenue = (n: number | undefined) => {
    if (ytdThruMonth === null) return
    if (n === undefined) {
      setRevenueByMonth(emptyMonthArray())
      return
    }
    setRevenueByMonth(
      distributeAcrossMonths(n, ytdThruMonth, seasonType, seasonPct)
    )
  }
  const setBulkCogs = (n: number | undefined) => {
    if (ytdThruMonth === null) return
    if (n === undefined) {
      setCogsByMonth(emptyMonthArray())
      return
    }
    setCogsByMonth(
      distributeAcrossMonths(n, ytdThruMonth, seasonType, seasonPct)
    )
  }
  const setBulkExpenses = (n: number | undefined) => {
    if (ytdThruMonth === null) return
    if (n === undefined) {
      setExpensesByMonth(emptyMonthArray())
      return
    }
    setExpensesByMonth(
      distributeAcrossMonths(n, ytdThruMonth, seasonType, seasonPct)
    )
  }

  const setMonthValue = (
    which: 'revenue' | 'cogs' | 'expenses',
    idx: number,
    value: number | undefined
  ) => {
    const arr =
      which === 'revenue'
        ? revenueByMonth
        : which === 'cogs'
          ? cogsByMonth
          : expensesByMonth
    const next = [...arr]
    next[idx] = value ?? null
    if (which === 'revenue') setRevenueByMonth(next)
    else if (which === 'cogs') setCogsByMonth(next)
    else setExpensesByMonth(next)
  }

  return (
    <div className="space-y-4">
      <Labeled label="Most Recent Closed Month">
        <select
          value={ytdThruMonth ?? 'none'}
          onChange={(e) => onThruMonthChange(e.target.value)}
          className="select-yellow w-48 bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
        >
          <option value="none">— Pick one —</option>
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
      </Labeled>

      {enabled && (
        <>
          <Labeled label="Enter Actuals">
            <div className="inline-flex border border-line rounded overflow-hidden">
              <ModeButton
                active={entryMode === 'bulk'}
                onClick={() => setEntryMode('bulk')}
              >
                Single total
              </ModeButton>
              <ModeButton
                active={entryMode === 'monthly'}
                onClick={() => setEntryMode('monthly')}
              >
                Month-by-month
              </ModeButton>
            </div>
          </Labeled>

          {entryMode === 'bulk' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Income">
                  <NumberField
                    tone="light"
                    value={revenueTotal === 0 ? undefined : revenueTotal}
                    onChange={setBulkRevenue}
                    format="dollars"
                    max={null}
                    ariaLabel="YTD income total"
                  />
                  {view && hasYtdActuals && (
                    <StatusLine
                      behind={view.revenueGap < -0.5}
                      gap={view.revenueGap}
                    />
                  )}
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Gross Profit $">
                  <DerivedBox value={formatDollars(revenueTotal - cogsTotal)} />
                  {view && hasYtdActuals && (
                    <>
                      <StatusLine
                        behind={view.gpGap < -0.5}
                        gap={view.gpGap}
                      />
                      {view.gpGap < -0.5 && (
                        <div className="text-xs text-white italic mt-1">
                          Remaining monthly goals adjusted to close this GP
                          gap.
                        </div>
                      )}
                    </>
                  )}
                </Labeled>
                <Labeled label="Gross Profit %">
                  <DerivedBox
                    value={
                      revenueTotal > 0
                        ? `${(((revenueTotal - cogsTotal) / revenueTotal) * 100).toFixed(1)}%`
                        : '—'
                    }
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Cost of Goods Sold">
                  <NumberField
                    tone="light"
                    value={cogsTotal === 0 ? undefined : cogsTotal}
                    onChange={setBulkCogs}
                    format="dollars"
                    max={null}
                    ariaLabel="YTD cost of goods sold total"
                  />
                </Labeled>
                <Labeled label="Cost of Goods Sold %">
                  <DerivedBox
                    value={
                      revenueTotal > 0
                        ? `${((cogsTotal / revenueTotal) * 100).toFixed(1)}%`
                        : '—'
                    }
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Expenses">
                  <NumberField
                    tone="light"
                    value={expensesTotal === 0 ? undefined : expensesTotal}
                    onChange={setBulkExpenses}
                    format="dollars"
                    max={null}
                    ariaLabel="YTD expenses total"
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Net Profit $">
                  <DerivedBox
                    value={formatDollars(
                      revenueTotal - cogsTotal - expensesTotal
                    )}
                  />
                </Labeled>
                <Labeled label="Net Profit %">
                  <DerivedBox
                    value={
                      revenueTotal > 0
                        ? `${(((revenueTotal - cogsTotal - expensesTotal) / revenueTotal) * 100).toFixed(1)}%`
                        : '—'
                    }
                  />
                </Labeled>
              </div>
            </div>
          ) : (
            <div className="bg-[#0a0a0a] border border-line rounded p-3 overflow-x-auto">
              <div className="grid grid-cols-[0.6fr_1.1fr_1.1fr_1.1fr_1.1fr_1fr_0.6fr] gap-x-3 gap-y-1.5 items-center min-w-[640px]">
                <HeaderCell>Month</HeaderCell>
                <HeaderCell>Income</HeaderCell>
                <HeaderCell>Cost of Goods Sold</HeaderCell>
                <HeaderCell>Gross Profit</HeaderCell>
                <HeaderCell>Expenses</HeaderCell>
                <HeaderCell>Net Profit</HeaderCell>
                <HeaderCell>NP %</HeaderCell>
                {MONTH_LABELS.slice(0, ytdThruMonth + 1).map((m, i) => (
                  <FragmentRow
                    key={m}
                    month={m}
                    revenue={revenueByMonth[i] ?? undefined}
                    cogs={cogsByMonth[i] ?? undefined}
                    expenses={expensesByMonth[i] ?? undefined}
                    onRevenueChange={(n) => setMonthValue('revenue', i, n)}
                    onCogsChange={(n) => setMonthValue('cogs', i, n)}
                    onExpensesChange={(n) => setMonthValue('expenses', i, n)}
                  />
                ))}
                <DerivedTotal>Total</DerivedTotal>
                <DerivedTotal>{formatDollars(revenueTotal)}</DerivedTotal>
                <DerivedTotal>{formatDollars(cogsTotal)}</DerivedTotal>
                <DerivedTotal>
                  {formatDollars(revenueTotal - cogsTotal)}
                </DerivedTotal>
                <DerivedTotal>{formatDollars(expensesTotal)}</DerivedTotal>
                <DerivedTotal>
                  {formatDollars(revenueTotal - cogsTotal - expensesTotal)}
                </DerivedTotal>
                <DerivedTotal>
                  {revenueTotal > 0
                    ? `${(((revenueTotal - cogsTotal - expensesTotal) / revenueTotal) * 100).toFixed(1)}%`
                    : '—'}
                </DerivedTotal>
              </div>
            </div>
          )}

          <div className="text-xs text-white italic pt-2">
            Numbers are rounded to whole dollars; per-month figures may differ
            from totals by a dollar or two.
          </div>
        </>
      )}
    </div>
  )
}

// =============================================================================
// Local helpers (kept local to avoid coupling with BudgetGoalsPage's copies)
// =============================================================================

function Labeled({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </div>
      {children}
    </div>
  )
}

function DerivedBox({ value }: { value: string }) {
  return (
    <div className="w-full bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm px-3 py-2 min-h-[40px] flex items-center">
      {value}
    </div>
  )
}

function DerivedCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm px-3 py-1.5">
      {children}
    </div>
  )
}

function DerivedTotal({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm font-semibold px-3 py-1.5 mt-2">
      {children}
    </div>
  )
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wider text-white">
      {children}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-bold ${
        active
          ? 'bg-accent text-black'
          : 'bg-transparent text-white hover:bg-surface-2'
      }`}
    >
      {children}
    </button>
  )
}

function StatusLine({ behind, gap }: { behind: boolean; gap: number }) {
  return (
    <div className="mt-1 text-xs text-white">
      <strong>{behind ? 'Behind Budget' : 'On Track'}</strong>{' '}
      {gap >= 0 ? '+' : ''}
      {formatDollars(gap)}
    </div>
  )
}

function FragmentRow({
  month,
  revenue,
  cogs,
  expenses,
  onRevenueChange,
  onCogsChange,
  onExpensesChange,
}: {
  month: string
  revenue: number | undefined
  cogs: number | undefined
  expenses: number | undefined
  onRevenueChange: (n: number | undefined) => void
  onCogsChange: (n: number | undefined) => void
  onExpensesChange: (n: number | undefined) => void
}) {
  const hasAny =
    revenue !== undefined || cogs !== undefined || expenses !== undefined
  const gpDollars = hasAny ? (revenue ?? 0) - (cogs ?? 0) : null
  const npDollars =
    gpDollars === null ? null : gpDollars - (expenses ?? 0)
  const npPct =
    revenue !== undefined && revenue > 0 && npDollars !== null
      ? (npDollars / revenue) * 100
      : null
  return (
    <>
      <div className="text-white text-sm font-semibold">{month}</div>
      <NumberField
        tone="light"
        value={revenue}
        onChange={onRevenueChange}
        format="dollars"
        max={null}
        ariaLabel={`${month} income`}
      />
      <NumberField
        tone="light"
        value={cogs}
        onChange={onCogsChange}
        format="dollars"
        max={null}
        ariaLabel={`${month} cost of goods sold`}
      />
      <DerivedCell>
        {gpDollars === null ? '—' : formatDollars(gpDollars)}
      </DerivedCell>
      <NumberField
        tone="light"
        value={expenses}
        onChange={onExpensesChange}
        format="dollars"
        max={null}
        ariaLabel={`${month} expenses`}
      />
      <DerivedCell>
        {npDollars === null ? '—' : formatDollars(npDollars)}
      </DerivedCell>
      <DerivedCell>
        {npPct === null ? '—' : `${npPct.toFixed(1)}%`}
      </DerivedCell>
    </>
  )
}

function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
