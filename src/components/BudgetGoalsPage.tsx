import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  MONTH_LABELS,
  annualCostOfGoodsDollars,
  annualGrossProfitDollars,
  annualNetProfitDollars,
  annualNetProfitPct,
  computeBudgetView,
  costOfGoodsPct,
  distributeAcrossMonths,
  emptyMonthArray,
  evenSeasonPct,
  looksAutoDistributed,
  sumMonthsThru,
} from '../lib/budget'
import type { Budget, Client, SeasonType } from '../lib/types'
import { NumberField } from './NumberField'
import { KpiGoalsCard } from './KpiGoalsCard'
import { BudgetStatusBanners } from './BudgetStatusBanners'
import { MonthlyFinancialGoalsCard } from './MonthlyFinancialGoalsCard'

type Props = {
  clientId: string
  /** True when a coach is operating on this client's behalf via View Portal. */
  coachView: boolean
  onLeave: () => void
}

export function BudgetGoalsPage({ clientId, onLeave }: Props) {
  const [client, setClient] = useState<Client | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form draft -------------------------------------------------------------
  // The user enters Gross Profit % directly. The database column is still
  // cogs_target_pct (= 100 − GP%) so the math elsewhere doesn't shift.
  const [annualRevenue, setAnnualRevenue] = useState<number | undefined>(
    undefined
  )
  const [grossProfitPct, setGrossProfitPct] = useState<number | undefined>(
    undefined
  )
  const [annualExpenses, setAnnualExpenses] = useState<number | undefined>(
    undefined
  )
  const [seasonType, setSeasonType] = useState<SeasonType>('even')
  const [seasonPct, setSeasonPct] = useState<number[]>(evenSeasonPct())

  // YTD actuals — Doc 08 PC: stored month-by-month, but the default UI is
  // single totals + a thru-month picker; coach can expand the per-month grid.
  const [ytdThruMonth, setYtdThruMonth] = useState<number | null>(null)
  const [ytdRevenueByMonth, setYtdRevenueByMonth] = useState<
    (number | null)[]
  >(emptyMonthArray())
  const [ytdCogsByMonth, setYtdCogsByMonth] = useState<(number | null)[]>(
    emptyMonthArray()
  )
  const [ytdExpensesByMonth, setYtdExpensesByMonth] = useState<
    (number | null)[]
  >(emptyMonthArray())
  // YTD entry method — explicit choice instead of a hybrid "single total +
  // expand for overrides" UI. Defaults from the data: months that look
  // auto-distributed → bulk; mixed values → monthly.
  const [ytdEntryMode, setYtdEntryMode] = useState<'bulk' | 'monthly'>('bulk')

  // Per-KPI goal numbers, keyed by KPI id (or custom KPI id)
  const [kpiGoals, setKpiGoals] = useState<Record<string, number>>({})

  // Tab within the Budget & Goals page
  const [budgetTab, setBudgetTab] = useState<'targets' | 'monthly'>('targets')

  // Save state -------------------------------------------------------------
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const year = new Date().getFullYear()

  const seedDraftFromBudget = (b: Budget | null) => {
    setAnnualRevenue(b?.annual_revenue ?? undefined)
    setGrossProfitPct(
      b?.cogs_target_pct == null ? undefined : 100 - b.cogs_target_pct
    )
    setAnnualExpenses(b?.annual_expenses ?? undefined)
    setSeasonType(b?.season_type ?? 'even')
    setSeasonPct(
      b?.season_type === 'seasonal' && b.season_pct.length === 12
        ? b.season_pct
        : evenSeasonPct()
    )
    setYtdThruMonth(b?.ytd_thru_month ?? null)
    const seededRevenue =
      b?.ytd_revenue_by_month && b.ytd_revenue_by_month.length === 12
        ? b.ytd_revenue_by_month
        : emptyMonthArray()
    const seededCogs =
      b?.ytd_cogs_by_month && b.ytd_cogs_by_month.length === 12
        ? b.ytd_cogs_by_month
        : emptyMonthArray()
    setYtdRevenueByMonth(seededRevenue)
    setYtdCogsByMonth(seededCogs)
    const seededExpenses =
      b?.ytd_expenses_by_month && b.ytd_expenses_by_month.length === 12
        ? b.ytd_expenses_by_month
        : emptyMonthArray()
    setYtdExpensesByMonth(seededExpenses)
    // If either array shows manual overrides, default to monthly entry so the
    // coach can see what's actually stored. Otherwise prefer bulk.
    const looksBulk =
      looksAutoDistributed(seededRevenue, b?.ytd_thru_month ?? null) &&
      looksAutoDistributed(seededCogs, b?.ytd_thru_month ?? null)
    setYtdEntryMode(looksBulk ? 'bulk' : 'monthly')
    setKpiGoals(b?.goals ?? {})
    setSavedAt(null)
    setSaveError(null)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Load client first — we need coach_id for the budget if we have to
      // INSERT a fresh row.
      const { data: clientData, error: clientErr } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle()
      if (cancelled) return
      if (clientErr || !clientData) {
        setLoadError(clientErr?.message ?? 'Client not found')
        return
      }
      setClient(clientData as Client)

      const { data: budgetData, error: budgetErr } = await supabase
        .from('budgets')
        .select('*')
        .eq('client_id', clientId)
        .eq('year', year)
        .maybeSingle()
      if (cancelled) return
      if (budgetErr) {
        setLoadError(budgetErr.message)
        return
      }
      setBudget((budgetData as Budget) ?? null)
      seedDraftFromBudget((budgetData as Budget) ?? null)
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, year])

  // ---- Dirty tracking -----------------------------------------------------
  const draftCogsPct =
    grossProfitPct === undefined ? null : 100 - grossProfitPct

  const isDirty = useMemo(() => {
    const savedRevByMonth =
      budget?.ytd_revenue_by_month && budget.ytd_revenue_by_month.length === 12
        ? budget.ytd_revenue_by_month
        : emptyMonthArray()
    const savedCogsByMonth =
      budget?.ytd_cogs_by_month && budget.ytd_cogs_by_month.length === 12
        ? budget.ytd_cogs_by_month
        : emptyMonthArray()
    const savedExpensesByMonth =
      budget?.ytd_expenses_by_month &&
      budget.ytd_expenses_by_month.length === 12
        ? budget.ytd_expenses_by_month
        : emptyMonthArray()
    return (
      (annualRevenue ?? null) !== (budget?.annual_revenue ?? null) ||
      draftCogsPct !== (budget?.cogs_target_pct ?? null) ||
      (annualExpenses ?? null) !== (budget?.annual_expenses ?? null) ||
      seasonType !== (budget?.season_type ?? 'even') ||
      JSON.stringify(seasonPct) !==
        JSON.stringify(budget?.season_pct ?? evenSeasonPct()) ||
      ytdThruMonth !== (budget?.ytd_thru_month ?? null) ||
      JSON.stringify(ytdRevenueByMonth) !== JSON.stringify(savedRevByMonth) ||
      JSON.stringify(ytdCogsByMonth) !== JSON.stringify(savedCogsByMonth) ||
      JSON.stringify(ytdExpensesByMonth) !==
        JSON.stringify(savedExpensesByMonth) ||
      JSON.stringify(kpiGoals) !== JSON.stringify(budget?.goals ?? {})
    )
  }, [
    budget,
    annualRevenue,
    draftCogsPct,
    annualExpenses,
    seasonType,
    seasonPct,
    ytdThruMonth,
    ytdRevenueByMonth,
    ytdCogsByMonth,
    ytdExpensesByMonth,
    kpiGoals,
  ])

  // Saved-banner clears when dirty + auto-expires after 3 seconds.
  useEffect(() => {
    if (savedAt && isDirty) setSavedAt(null)
  }, [savedAt, isDirty])
  useEffect(() => {
    if (savedAt === null) return
    const t = setTimeout(() => setSavedAt(null), 3000)
    return () => clearTimeout(t)
  }, [savedAt])

  // ---- Derived display ---------------------------------------------------
  const gpDollars = annualGrossProfitDollars(
    annualRevenue ?? null,
    grossProfitPct ?? null
  )
  const cogsDollars = annualCostOfGoodsDollars(
    annualRevenue ?? null,
    grossProfitPct ?? null
  )
  const cogsPct = costOfGoodsPct(grossProfitPct ?? null)
  const npDollars = annualNetProfitDollars(
    gpDollars,
    annualExpenses ?? null
  )
  const npPct = annualNetProfitPct(npDollars, annualRevenue ?? null)
  const seasonalSum = seasonPct.reduce((a, b) => a + (b || 0), 0)

  const view = computeBudgetView({
    annualRevenue: annualRevenue ?? null,
    grossProfitPct: grossProfitPct ?? null,
    annualExpenses: annualExpenses ?? null,
    seasonType,
    seasonPct,
    ytdThruMonth,
    ytdRevenueByMonth,
    ytdCogsByMonth,
    ytdExpensesByMonth,
  })
  const hasYtdActuals =
    ytdThruMonth !== null &&
    (ytdRevenueByMonth.some((v) => Number(v) > 0) ||
      ytdCogsByMonth.some((v) => Number(v) > 0) ||
      ytdExpensesByMonth.some((v) => Number(v) > 0))

  // ---- Handlers ----------------------------------------------------------
  const onSeasonTypeChange = (next: SeasonType) => {
    setSeasonType(next)
    if (next === 'seasonal' && seasonPct.length !== 12) {
      setSeasonPct(evenSeasonPct())
    }
  }

  const setMonthPct = (idx: number, value: number | undefined) => {
    setSeasonPct((prev) => {
      const next = [...prev]
      while (next.length < 12) next.push(0)
      next[idx] = value ?? 0
      return next
    })
  }

  const onCancel = () => {
    if (isDirty && !confirm('Discard your unsaved changes and leave Budget & Goals?'))
      return
    seedDraftFromBudget(budget)
    onLeave()
  }

  const onSave = async () => {
    if (!client) return
    if (!isDirty) return
    setSaveError(null)
    if (
      seasonType === 'seasonal' &&
      Math.abs(seasonalSum - 100) > 0.5
    ) {
      setSaveError(
        `Monthly distribution must sum to 100% (currently ${seasonalSum.toFixed(1)}%).`
      )
      return
    }

    setSaving(true)
    const payload = {
      client_id: client.id,
      coach_id: client.coach_id,
      year,
      annual_revenue: annualRevenue ?? null,
      cogs_target_pct: draftCogsPct,
      season_type: seasonType,
      season_pct: seasonType === 'seasonal' ? seasonPct : [],
      annual_expenses: annualExpenses ?? null,
      ytd_thru_month: ytdThruMonth,
      ytd_revenue_by_month:
        ytdThruMonth === null ? null : ytdRevenueByMonth,
      ytd_cogs_by_month: ytdThruMonth === null ? null : ytdCogsByMonth,
      ytd_expenses_by_month:
        ytdThruMonth === null ? null : ytdExpensesByMonth,
      goals: kpiGoals,
    }

    const op = budget
      ? supabase.from('budgets').update(payload).eq('id', budget.id)
      : supabase.from('budgets').insert(payload)
    const { data, error } = await op.select().single()

    setSaving(false)
    if (error) {
      setSaveError(error.message)
      return
    }
    setBudget(data as Budget)
    seedDraftFromBudget(data as Budget)
    setSavedAt(Date.now())
  }

  if (loadError) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-black">
        Couldn't load: {loadError}
      </div>
    )
  }
  if (!client) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-black">
        Loading…
      </div>
    )
  }

  return (
    <section className="space-y-4">
      {/* Header + Save bar */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Budget &amp; Goals</h1>
          <p className="text-xs text-black mt-0.5">
            Annual targets and how they're spread across the year. {year} budget.
          </p>
        </div>
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
          {saveError}
        </div>
      )}

      {/* Budget tab nav */}
      <div className="flex gap-1 border-b border-gray-300">
        <BudgetTabButton
          active={budgetTab === 'targets'}
          onClick={() => setBudgetTab('targets')}
        >
          Targets &amp; Actuals
        </BudgetTabButton>
        <BudgetTabButton
          active={budgetTab === 'monthly'}
          onClick={() => setBudgetTab('monthly')}
        >
          Monthly Financial Goals
        </BudgetTabButton>
      </div>

      {budgetTab === 'targets' ? (
        <>
      {/* Annual Targets */}
      <Card title="Annual Targets">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Labeled label="Annual Revenue Target">
            <NumberField
              value={annualRevenue}
              onChange={setAnnualRevenue}
              format="dollars"
              max={null}
              ariaLabel="Annual revenue"
            />
          </Labeled>
          <Labeled label="Gross Profit %">
            <NumberField
              value={grossProfitPct}
              onChange={setGrossProfitPct}
              format="percent"
              ariaLabel="Gross profit percent"
            />
          </Labeled>
          <Labeled label="Annual Expenses">
            <NumberField
              value={annualExpenses}
              onChange={setAnnualExpenses}
              format="dollars"
              max={null}
              ariaLabel="Annual operating expenses"
            />
          </Labeled>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-line">
          <Derived
            label="Annual Gross Profit"
            value={gpDollars !== null ? formatDollars(gpDollars) : '—'}
            hint="Revenue × Gross Profit %"
          />
          <Derived
            label="Cost of Goods Sold %"
            value={cogsPct !== null ? `${cogsPct.toFixed(1)}%` : '—'}
            hint="100% − Gross Profit %"
          />
          <Derived
            label="Cost of Goods Sold $"
            value={cogsDollars !== null ? formatDollars(cogsDollars) : '—'}
            hint="Revenue − Gross Profit $"
          />
          <Derived
            label="Annual Net Profit"
            value={npDollars !== null ? formatDollars(npDollars) : '—'}
            hint="Gross Profit − Expenses"
          />
          <Derived
            label="Net Profit %"
            value={npPct !== null ? `${npPct.toFixed(1)}%` : '—'}
            hint="Net Profit ÷ Revenue"
          />
        </div>
        <RoundingNote />
      </Card>

      {/* Monthly Distribution */}
      <Card title="Monthly Distribution">
        <p className="text-xs text-white leading-relaxed">
          How is your annual revenue spread across the year? Pick <em>Even</em>{' '}
          if it's roughly the same every month, or <em>Seasonal</em> to enter
          a per-month percentage.
        </p>
        <div className="inline-flex border border-line rounded overflow-hidden">
          <ModePill
            active={seasonType === 'even'}
            onClick={() => onSeasonTypeChange('even')}
          >
            Even
          </ModePill>
          <ModePill
            active={seasonType === 'seasonal'}
            onClick={() => onSeasonTypeChange('seasonal')}
          >
            Seasonal
          </ModePill>
        </div>

        {seasonType === 'seasonal' && (
          <div>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {MONTH_LABELS.map((m, i) => (
                <Labeled key={m} label={m}>
                  <NumberField
                    value={seasonPct[i] ?? 0}
                    onChange={(n) => setMonthPct(i, n)}
                    format="percent"
                    ariaLabel={`${m} percent of annual`}
                  />
                </Labeled>
              ))}
            </div>
            <SeasonalSum sum={seasonalSum} />
          </div>
        )}
      </Card>

      {/* YTD actuals */}
      <Card title="YTD Actuals">
        <YtdActualsBody
          ytdThruMonth={ytdThruMonth}
          setYtdThruMonth={setYtdThruMonth}
          revenueByMonth={ytdRevenueByMonth}
          setRevenueByMonth={setYtdRevenueByMonth}
          cogsByMonth={ytdCogsByMonth}
          setCogsByMonth={setYtdCogsByMonth}
          expensesByMonth={ytdExpensesByMonth}
          setExpensesByMonth={setYtdExpensesByMonth}
          entryMode={ytdEntryMode}
          setEntryMode={setYtdEntryMode}
          seasonType={seasonType}
          seasonPct={seasonPct}
        />
      </Card>

      {/* Status banners (only when YTD actuals exist + targets are set) */}
      <BudgetStatusBanners view={view} hasYtdActuals={hasYtdActuals} />

      {/* Per-KPI goals */}
      <Card title="Key Performance Indicator Goals">
        <KpiGoalsCard
          client={client}
          goals={kpiGoals}
          onChange={setKpiGoals}
        />
      </Card>

      {/* Capacity goals — Phase 4.5 */}
      <Card title="Capacity Group Goals">
        <PhaseStub
          phase="Phase 4.5"
          summary="Target % or $ per capacity group from Settings."
        />
      </Card>
        </>
      ) : (
        <Card title="Monthly Financial Goals">
          <MonthlyFinancialGoalsCard view={view} />
        </Card>
      )}

      {/* Bottom save */}
      <div className="flex justify-end pt-2">
        <SaveBar
          isDirty={isDirty}
          saving={saving}
          savedAt={savedAt}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>
    </section>
  )
}

// =============================================================================
// Helpers
// =============================================================================

function YtdActualsBody({
  ytdThruMonth,
  setYtdThruMonth,
  revenueByMonth,
  setRevenueByMonth,
  cogsByMonth,
  setCogsByMonth,
  expensesByMonth,
  setExpensesByMonth,
  entryMode,
  setEntryMode,
  seasonType,
  seasonPct,
}: {
  ytdThruMonth: number | null
  setYtdThruMonth: (n: number | null) => void
  revenueByMonth: (number | null)[]
  setRevenueByMonth: (arr: (number | null)[]) => void
  cogsByMonth: (number | null)[]
  setCogsByMonth: (arr: (number | null)[]) => void
  expensesByMonth: (number | null)[]
  setExpensesByMonth: (arr: (number | null)[]) => void
  entryMode: 'bulk' | 'monthly'
  setEntryMode: (m: 'bulk' | 'monthly') => void
  seasonType: SeasonType
  seasonPct: number[]
}) {
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
      const trimmed = revenueByMonth.map((v, i) => (i > next ? null : v))
      setRevenueByMonth(trimmed)
    }
    if (cogsByMonth.some((v, i) => i > next && v != null)) {
      const trimmed = cogsByMonth.map((v, i) => (i > next ? null : v))
      setCogsByMonth(trimmed)
    }
    if (expensesByMonth.some((v, i) => i > next && v != null)) {
      const trimmed = expensesByMonth.map((v, i) => (i > next ? null : v))
      setExpensesByMonth(trimmed)
    }
  }

  // Bulk mode handlers — typing a total replaces all months with the
  // auto-distribute. No confirm: bulk is an explicit mode, the coach asked
  // for this behavior by picking it.
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
      <p className="text-xs text-white leading-relaxed">
        Year-to-date actuals from outside the portal — typically used when
        you start coaching a client mid-year. Pick the most recent completed
        month, then choose how to enter the numbers.
      </p>

      <Labeled label="YTD Through">
        <select
          value={ytdThruMonth ?? 'none'}
          onChange={(e) => onThruMonthChange(e.target.value)}
          className="w-48 bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
        >
          <option value="none">— Pick one —</option>
          {MONTH_LABELS.map((m, i) => (
            <option key={m} value={i}>
              End of {m}
            </option>
          ))}
        </select>
      </Labeled>

      {enabled && (
        <>
          <Labeled label="How do you want to enter actuals?">
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
            <div className="text-xs text-white mt-2 leading-relaxed">
              {entryMode === 'bulk'
                ? `Enter one Revenue and one Cost of Goods Sold figure for the whole window. The portal spreads it across ${ytdThruMonth + 1} month${ytdThruMonth === 0 ? '' : 's'} ${seasonType === 'seasonal' ? 'using your seasonal distribution' : 'evenly'}.`
                : `Enter Revenue and Cost of Goods Sold for each of the ${ytdThruMonth + 1} month${ytdThruMonth === 0 ? '' : 's'} individually. The totals at the bottom are computed from your entries.`}
            </div>
          </Labeled>

          {entryMode === 'bulk' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Labeled label="Revenue (YTD total)">
                <NumberField
                  value={revenueTotal === 0 ? undefined : revenueTotal}
                  onChange={setBulkRevenue}
                  format="dollars"
                  max={null}
                  ariaLabel="YTD revenue total"
                />
              </Labeled>
              <Labeled label="Cost of Goods Sold (YTD total)">
                <NumberField
                  value={cogsTotal === 0 ? undefined : cogsTotal}
                  onChange={setBulkCogs}
                  format="dollars"
                  max={null}
                  ariaLabel="YTD cost of goods sold total"
                />
              </Labeled>
              <Labeled label="Expenses (YTD total)">
                <NumberField
                  value={expensesTotal === 0 ? undefined : expensesTotal}
                  onChange={setBulkExpenses}
                  format="dollars"
                  max={null}
                  ariaLabel="YTD expenses total"
                />
              </Labeled>
            </div>
          ) : (
            <div className="bg-[#0a0a0a] border border-line rounded p-3 overflow-x-auto">
              <div className="grid grid-cols-[0.6fr_1.1fr_1.1fr_1.1fr_1.1fr_1fr_0.6fr] gap-x-3 gap-y-1.5 items-center min-w-[640px]">
                <HeaderCell>Month</HeaderCell>
                <HeaderCell>Revenue</HeaderCell>
                <HeaderCell>Cost of Goods Sold</HeaderCell>
                <HeaderCell>Expenses</HeaderCell>
                <HeaderCell>Gross Profit</HeaderCell>
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
                {/* Totals row */}
                <TotalCell>Total</TotalCell>
                <TotalCell>{formatDollars(revenueTotal)}</TotalCell>
                <TotalCell>{formatDollars(cogsTotal)}</TotalCell>
                <TotalCell>{formatDollars(expensesTotal)}</TotalCell>
                <TotalCell>
                  {formatDollars(revenueTotal - cogsTotal)}
                </TotalCell>
                <TotalCell>
                  {formatDollars(revenueTotal - cogsTotal - expensesTotal)}
                </TotalCell>
                <TotalCell>
                  {revenueTotal > 0
                    ? `${(((revenueTotal - cogsTotal - expensesTotal) / revenueTotal) * 100).toFixed(1)}%`
                    : '—'}
                </TotalCell>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-line">
            <Derived
              label="YTD Gross Profit"
              value={formatDollars(revenueTotal - cogsTotal)}
              hint="Revenue − Cost of Goods Sold"
            />
            <Derived
              label="YTD GP Margin"
              value={
                revenueTotal > 0
                  ? `${(((revenueTotal - cogsTotal) / revenueTotal) * 100).toFixed(1)}%`
                  : '—'
              }
              hint="Gross Profit ÷ Revenue"
            />
            <Derived
              label="YTD Net Profit"
              value={formatDollars(
                revenueTotal - cogsTotal - expensesTotal
              )}
              hint="Gross Profit − Expenses"
            />
            <Derived
              label="YTD Net Profit %"
              value={
                revenueTotal > 0
                  ? `${(((revenueTotal - cogsTotal - expensesTotal) / revenueTotal) * 100).toFixed(1)}%`
                  : '—'
              }
              hint="Net Profit ÷ Revenue"
            />
          </div>
          <RoundingNote />
        </>
      )}
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

function TotalCell({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-white font-semibold pt-2 border-t border-line">
      {children}
    </div>
  )
}

function RoundingNote() {
  return (
    <div className="text-xs text-white italic pt-2">
      Numbers are rounded to whole dollars; per-month figures may differ from
      totals by a dollar or two.
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
      className={`px-4 py-1.5 text-xs font-semibold ${
        active
          ? 'bg-accent text-black'
          : 'bg-transparent text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

function BudgetTabButton({
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
      className={`px-4 py-2 text-xs font-bold ${
        active
          ? 'text-black border-b-2 border-accent -mb-px'
          : 'text-black/60 hover:text-black'
      }`}
    >
      {children}
    </button>
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
        value={revenue}
        onChange={onRevenueChange}
        format="dollars"
        max={null}
        ariaLabel={`${month} revenue`}
      />
      <NumberField
        value={cogs}
        onChange={onCogsChange}
        format="dollars"
        max={null}
        ariaLabel={`${month} cost of goods sold`}
      />
      <NumberField
        value={expenses}
        onChange={onExpensesChange}
        format="dollars"
        max={null}
        ariaLabel={`${month} expenses`}
      />
      <div className="text-sm text-white">
        {gpDollars === null ? '—' : formatDollars(gpDollars)}
      </div>
      <div className="text-sm text-white">
        {npDollars === null ? '—' : formatDollars(npDollars)}
      </div>
      <div className="text-sm text-white">
        {npPct === null ? '—' : `${npPct.toFixed(1)}%`}
      </div>
    </>
  )
}

function SaveBar({
  isDirty,
  saving,
  savedAt,
  onCancel,
  onSave,
}: {
  isDirty: boolean
  saving: boolean
  savedAt: number | null
  onCancel: () => void
  onSave: () => void
}) {
  const showSaved = !isDirty && savedAt !== null
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="bg-white text-black border border-gray-300 px-4 py-1.5 rounded text-xs font-semibold hover:bg-gray-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={`px-4 py-1.5 rounded text-xs font-bold ${
          showSaved
            ? 'bg-good text-black hover:brightness-95'
            : 'bg-accent text-black hover:brightness-95'
        } disabled:opacity-60 disabled:cursor-wait`}
      >
        {saving
          ? 'Saving…'
          : showSaved
            ? 'Saved ✓'
            : 'Save Budget & Goals'}
      </button>
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-ink border border-line rounded-lg p-5 space-y-4">
      <h2 className="text-white text-sm font-bold">{title}</h2>
      {children}
    </div>
  )
}

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

function Derived({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint: string
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </div>
      <div className="text-white text-base font-semibold">{value}</div>
      <div className="text-xs text-white italic">{hint}</div>
    </div>
  )
}

function ModePill({
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
      className={`px-4 py-1.5 text-xs font-semibold ${
        active
          ? 'bg-accent text-black'
          : 'bg-transparent text-white hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

function SeasonalSum({ sum }: { sum: number }) {
  const ok = Math.abs(sum - 100) < 0.5
  return (
    <div
      className={`mt-3 text-xs font-semibold ${
        ok ? 'text-white' : 'text-white'
      }`}
    >
      {ok ? '✓ ' : ''}Sum of months: {sum.toFixed(1)}%
      {!ok && ' — must equal 100%'}
    </div>
  )
}

function PhaseStub({
  phase,
  summary,
}: {
  phase: string
  summary: string
}) {
  return (
    <div className="bg-surface-2 border border-line rounded p-4 text-white text-xs leading-relaxed">
      <div className="text-white font-bold uppercase tracking-wider text-xs mb-1">
        {phase}
      </div>
      {summary}
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
