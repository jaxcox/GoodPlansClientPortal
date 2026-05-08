import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  MONTH_LABELS,
  annualCostOfGoodsDollars,
  annualGrossProfitDollars,
  costOfGoodsPct,
  evenSeasonPct,
} from '../lib/budget'
import type { Budget, Client, SeasonType } from '../lib/types'
import { NumberField } from './NumberField'

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
  const [seasonType, setSeasonType] = useState<SeasonType>('even')
  const [seasonPct, setSeasonPct] = useState<number[]>(evenSeasonPct())

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
    setSeasonType(b?.season_type ?? 'even')
    setSeasonPct(
      b?.season_type === 'seasonal' && b.season_pct.length === 12
        ? b.season_pct
        : evenSeasonPct()
    )
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
    return (
      (annualRevenue ?? null) !== (budget?.annual_revenue ?? null) ||
      draftCogsPct !== (budget?.cogs_target_pct ?? null) ||
      seasonType !== (budget?.season_type ?? 'even') ||
      JSON.stringify(seasonPct) !==
        JSON.stringify(budget?.season_pct ?? evenSeasonPct())
    )
  }, [budget, annualRevenue, draftCogsPct, seasonType, seasonPct])

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
  const seasonalSum = seasonPct.reduce((a, b) => a + (b || 0), 0)

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
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
        Couldn't load: {loadError}
      </div>
    )
  }
  if (!client) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6 text-sm text-gray-500">
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
          <p className="text-xs text-gray-500 mt-0.5">
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

      {/* Annual Targets */}
      <Card title="Annual Targets">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
        </div>
      </Card>

      {/* Monthly Distribution */}
      <Card title="Monthly Distribution">
        <p className="text-[11px] text-mute leading-relaxed">
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

      {/* YTD actuals — Phase 4.3 */}
      <Card title="YTD Actuals">
        <PhaseStub
          phase="Phase 4.3"
          summary="Month-by-month Revenue and Cost of Goods Sold actuals through a chosen month, so QTD math stays accurate when coaching starts mid-quarter (Doc 08 PC)."
        />
      </Card>

      {/* Per-KPI goals — Phase 4.2 */}
      <Card title="KPI Goals">
        <PhaseStub
          phase="Phase 4.2"
          summary="Goal numbers for each active KPI on this client (Marketing, Sales, Operations, Team) — including auto-derived KPIs per Doc 04 PC #14."
        />
      </Card>

      {/* Capacity goals — Phase 4.4 */}
      <Card title="Capacity Group Goals">
        <PhaseStub
          phase="Phase 4.4"
          summary="Target % or $ per capacity group from Settings."
        />
      </Card>

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
        className="bg-white text-gray-700 border border-gray-300 px-4 py-1.5 rounded text-xs font-semibold hover:bg-gray-50"
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-mute mb-1">
        {label}
      </div>
      <div className="text-white text-base font-semibold">{value}</div>
      <div className="text-[10px] text-mute italic">{hint}</div>
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
        ok ? 'text-good' : 'text-bad-soft'
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
    <div className="bg-surface-2 border border-line rounded p-4 text-mute text-xs leading-relaxed">
      <div className="text-accent font-bold uppercase tracking-wider text-[10px] mb-1">
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
