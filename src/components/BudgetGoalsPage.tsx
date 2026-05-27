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
  emptyMonthArray,
  evenSeasonPct,
} from '../lib/budget'
import type {
  Budget,
  CapacityGroupGoal,
  Client,
  SeasonType,
} from '../lib/types'
import { NumberField } from './NumberField'
import { KpiGoalsCard } from './KpiGoalsCard'
import {
  MonthlyFinancialGoalsCard,
  MonthlyGoalsRemainingTiles,
} from './MonthlyFinancialGoalsCard'
import { useDirtyGuard } from '../lib/dirtyGuard'
import { CapacityGoalsCard } from './CapacityGoalsCard'
import { SaveBar } from './SaveBar'
import { Card } from './Card'

type Props = {
  clientId: string
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

  // YTD actuals data lives on the budget row and is edited on Settings
  // (moved 2026-05-22). B&G still reads it to compute the Monthly
  // Financial Goals view (the per-month catch-up math depends on YTD),
  // but no longer holds local YTD state.

  // Per-KPI goal numbers, keyed by KPI id (or custom KPI id)
  const [kpiGoals, setKpiGoals] = useState<Record<string, number>>({})
  // Per-capacity-group utilization goal (single % per group). Lives on
  // the budget record. Group definitions themselves (employees / method /
  // hours) live on the client record and are managed on Settings.
  const [capacityGroupGoals, setCapacityGroupGoals] = useState<
    Record<string, CapacityGroupGoal>
  >({})

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
    setKpiGoals(b?.goals ?? {})
    setCapacityGroupGoals(b?.capacity_group_goals ?? {})
    setSavedAt(null)
    setSaveError(null)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // Load client first — we need coach_id for the budget if we have to
      // INSERT a fresh row.
      const { data: clientData, error: clientErr } = await supabase
        .from('clients_safe')
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
    return (
      (annualRevenue ?? null) !== (budget?.annual_revenue ?? null) ||
      draftCogsPct !== (budget?.cogs_target_pct ?? null) ||
      (annualExpenses ?? null) !== (budget?.annual_expenses ?? null) ||
      seasonType !== (budget?.season_type ?? 'even') ||
      // Only compare seasonPct when seasonal — when even, the DB stores []
      // but the form holds evenSeasonPct() (12 elements). Those represent
      // the same state, so skip the diff in even mode (otherwise the page
      // is "dirty" the moment it loads on any saved-even budget).
      (seasonType === 'seasonal' &&
        JSON.stringify(seasonPct) !==
          JSON.stringify(budget?.season_pct ?? evenSeasonPct())) ||
      JSON.stringify(kpiGoals) !== JSON.stringify(budget?.goals ?? {}) ||
      JSON.stringify(capacityGroupGoals) !==
        JSON.stringify(budget?.capacity_group_goals ?? {})
    )
  }, [
    budget,
    client,
    annualRevenue,
    draftCogsPct,
    annualExpenses,
    seasonType,
    seasonPct,
    kpiGoals,
    capacityGroupGoals,
  ])

  // Register dirty state with the app-wide leave guard.
  const setGuardDirty = useDirtyGuard(isDirty)

  // Saved-banner clears only when the form becomes dirty again — green
  // "Saved ✓" persists between edits so the user has clear, lasting
  // feedback that their changes were committed.
  useEffect(() => {
    if (savedAt && isDirty) setSavedAt(null)
  }, [savedAt, isDirty])

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

  // YTD inputs come from the budget row directly — they're edited on
  // Settings now, not here. We still need them to compute the Monthly
  // Financial Goals view (catch-up math reads YTD totals).
  const view = computeBudgetView({
    annualRevenue: annualRevenue ?? null,
    grossProfitPct: grossProfitPct ?? null,
    annualExpenses: annualExpenses ?? null,
    seasonType,
    seasonPct,
    ytdThruMonth: budget?.ytd_thru_month ?? null,
    ytdRevenueByMonth:
      (budget?.ytd_revenue_by_month as (number | null)[] | null) ?? null,
    ytdCogsByMonth:
      (budget?.ytd_cogs_by_month as (number | null)[] | null) ?? null,
    ytdExpensesByMonth:
      (budget?.ytd_expenses_by_month as (number | null)[] | null) ??
      emptyMonthArray(),
  })

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
    if (isDirty && !confirm('You have unsaved changes. Leave without saving? Click OK to continue or Cancel to stay.'))
      return
    seedDraftFromBudget(budget)
    // Cancel already confirmed the discard; clear central guard synchronously.
    setGuardDirty(false)
    onLeave()
  }

  const onSave = async () => {
    if (!client) return
    if (!isDirty) {
      // No changes — flash the green confirmation anyway so the click
      // feels acknowledged. Matches SettingsPage / WeeklyEntryPage.
      setSavedAt(Date.now())
      return
    }
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
    // YTD fields aren't included — those are owned by Settings now.
    // B&G writes annual targets, season config, KPI + capacity goals.
    const payload = {
      client_id: client.id,
      coach_id: client.coach_id,
      year,
      annual_revenue: annualRevenue ?? null,
      cogs_target_pct: draftCogsPct,
      season_type: seasonType,
      season_pct: seasonType === 'seasonal' ? seasonPct : [],
      annual_expenses: annualExpenses ?? null,
      goals: kpiGoals,
      capacity_group_goals: capacityGroupGoals,
    }

    const op = budget
      ? supabase.from('budgets').update(payload).eq('id', budget.id)
      : supabase.from('budgets').insert(payload)
    const { data, error } = await op.select().single()

    if (error) {
      setSaving(false)
      setSaveError(error.message)
      return
    }

    setSaving(false)
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
      {/* Sticky header bar: title + Save + tab nav travel together so the
          coach always sees which tab and the save state while scrolling. */}
      <div className="sticky top-[48px] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 pt-2 -mt-6 sm:-mt-8">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <h1 className="text-lg font-bold text-ink">Budget &amp; Goals</h1>
          <SaveBar
            isDirty={isDirty}
            saving={saving}
            savedAt={savedAt}
            onCancel={onCancel}
            onSave={onSave}
          />
        </div>
        {saveError && (
          <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3 mt-2">
            {saveError}
          </div>
        )}
        <div className="flex gap-1 border-b border-gray-300 mt-2">
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
      </div>

      {budgetTab === 'targets' ? (
        <>
      {/* Row 1: 2-col grid.
          Left  → Annual Targets, Monthly Distribution, YTD Actuals (if on)
          Right → KPI Goals (top) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div className="space-y-4">
          <Card title="Financials">
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Income Target">
                  <NumberField tone="light"
                    value={annualRevenue}
                    onChange={setAnnualRevenue}
                    format="dollars"
                    max={null}
                    ariaLabel="Annual income target"
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Gross Profit %">
                  <NumberField tone="light"
                    value={grossProfitPct}
                    onChange={setGrossProfitPct}
                    format="percent"
                    ariaLabel="Gross profit percent"
                  />
                </Labeled>
                <Labeled label="Gross Profit $">
                  <DerivedBox
                    value={gpDollars !== null ? formatDollars(gpDollars) : '—'}
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Cost of Goods Sold %">
                  <DerivedBox
                    value={cogsPct !== null ? `${cogsPct.toFixed(1)}%` : '—'}
                  />
                </Labeled>
                <Labeled label="Cost of Goods Sold $">
                  <DerivedBox
                    value={cogsDollars !== null ? formatDollars(cogsDollars) : '—'}
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Expenses">
                  <NumberField tone="light"
                    value={annualExpenses}
                    onChange={setAnnualExpenses}
                    format="dollars"
                    max={null}
                    ariaLabel="Annual operating expenses"
                  />
                </Labeled>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Labeled label="Net Profit $">
                  <DerivedBox
                    value={npDollars !== null ? formatDollars(npDollars) : '—'}
                  />
                </Labeled>
                <Labeled label="Net Profit %">
                  <DerivedBox
                    value={npPct !== null ? `${npPct.toFixed(1)}%` : '—'}
                  />
                </Labeled>
              </div>
              {Number(client?.kpis?.accountsReceivable) === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Labeled label="Accounts Receivable">
                    <NumberField tone="light"
                      value={kpiGoals.accountsReceivable}
                      onChange={(n) => {
                        const next = { ...kpiGoals }
                        if (n === undefined) delete next.accountsReceivable
                        else next.accountsReceivable = n
                        setKpiGoals(next)
                      }}
                      format="dollars"
                      max={null}
                      ariaLabel="Accounts Receivable goal"
                    />
                  </Labeled>
                </div>
              )}
              {(client?.custom_kpis ?? [])
                .filter(
                  (c) => c.active !== false && c.category === 'Financials'
                )
                .map((c) => (
                  <div
                    key={c.id}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                  >
                    <Labeled label={c.name}>
                      <NumberField
                        tone="light"
                        value={kpiGoals[c.id]}
                        onChange={(n) => {
                          const next = { ...kpiGoals }
                          if (n === undefined) delete next[c.id]
                          else next[c.id] = n
                          setKpiGoals(next)
                        }}
                        format={
                          c.format === '$'
                            ? 'dollars'
                            : c.format === '%'
                              ? 'percent'
                              : 'count'
                        }
                        max={c.format === '%' ? 100 : null}
                        ariaLabel={`${c.name} goal`}
                      />
                    </Labeled>
                  </div>
                ))}
            </div>
            <RoundingNote />
          </Card>

          <Card title="Monthly Distribution">
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
                <div className="grid grid-cols-3 gap-3">
                  {MONTH_LABELS.map((m, i) => (
                    <Labeled key={m} label={m}>
                      <NumberField tone="light"
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

          {/* YTD Actuals moved to Settings 2026-05-22 — the section was
              one-time-per-year setup data, not a working surface, and
              was bogging down the B&G screen. Coach edits in Settings;
              client sees the read-only summary there too. */}
        </div>

        <div className="space-y-4">
          <KpiGoalsCard
            client={client}
            goals={kpiGoals}
            annualRevenue={annualRevenue}
            onChange={setKpiGoals}
          />

          {/* Utilization Goals — compact per-group goal inputs, half the
              right column (≈ 1/4 of the page). The capacity-group
              definitions (method, max capacity, working hours) live on
              Settings → Utilization. Gated on the master toggle so it's
              hidden when capacity tracking is off. */}
          {Number(client?.kpis?.capacityUtilization) === 1 && (
            <CapacityGoalsCard
              groups={client?.capacity_groups ?? []}
              goals={capacityGroupGoals}
              onChange={setCapacityGroupGoals}
            />
          )}

          {/* Custom KPIs — all active custom KPIs except Financials (which
              live on the renamed Financials card in the left column).
              Always the last item in the right column. */}
          {(() => {
            const customs = (client?.custom_kpis ?? []).filter(
              (c) => c.active !== false && c.category !== 'Financials'
            )
            if (customs.length === 0) return null
            return (
              <Card title="Custom KPIs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                  {customs.map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-col h-full justify-end"
                    >
                      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
                        {c.name}
                      </div>
                      <NumberField
                        value={kpiGoals[c.id]}
                        onChange={(n) => {
                          const next = { ...kpiGoals }
                          if (n === undefined) delete next[c.id]
                          else next[c.id] = n
                          setKpiGoals(next)
                        }}
                        format={
                          c.format === '$'
                            ? 'dollars'
                            : c.format === '%'
                              ? 'percent'
                              : 'count'
                        }
                        max={c.format === '%' ? 100 : null}
                        ariaLabel={`${c.name} goal`}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            )
          })()}
        </div>
      </div>
        </>
      ) : (
        <>
          <MonthlyGoalsRemainingTiles view={view} />
          <Card title="Monthly Financial Goals">
            <MonthlyFinancialGoalsCard view={view} />
          </Card>
        </>
      )}

    </section>
  )
}

// =============================================================================
// Helpers
// =============================================================================


/** Read-only display box that mirrors the input field's dimensions but uses
 *  a gray (line) border instead of the yellow (accent) ring on fillable
 *  inputs. Stays dark on the Budget & Goals card so derived values are
 *  visually distinct from the white fillable inputs. */
function DerivedBox({ value }: { value: string }) {
  // min-h matches the NumberField input's 40px natural height so derived
  // boxes line up cleanly with fillable inputs in the same row.
  return (
    <div className="w-full bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm px-3 py-2 min-h-[40px] flex items-center">
      {value}
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
      className={`px-4 py-2 text-base font-bold ${
        active
          ? 'text-black border-b-2 border-accent -mb-px'
          : 'text-black/60 hover:text-black'
      }`}
    >
      {children}
    </button>
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


function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
