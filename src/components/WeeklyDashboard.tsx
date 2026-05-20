import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, KPIS } from '../lib/kpis'
import type { KpiCategory, KpiDef } from '../lib/kpis'
import type {
  Budget,
  CapacityGroup,
  CapacityGroupGoal,
  Client,
  CustomKpi,
  WeeklyEntry,
} from '../lib/types'
import { computeBudgetView, emptyMonthArray } from '../lib/budget'
import type { MonthlyGoal } from '../lib/budget'
import {
  actualValue,
  monthShareFractions,
  visibleTileKpis,
  weeklyGoal,
} from '../lib/dashboardGoals'
import { groupMaxCapacity, groupWorkingHours } from '../lib/capacity'
import {
  dateFromIso,
  formatWeekShort,
  isoDate,
  mostRecentCompletedWeekStart,
  shiftWeek,
} from '../lib/week'
import {
  KpiTile,
  formatValue as formatKpiValue,
  formatDelta as formatKpiDelta,
} from './KpiTile'
import { computeRingStatus, computeBand } from './ProgressRing'
import { CoachNoteBlock } from './CoachNoteBlock'
import { InfoIcon } from './InfoIcon'
import { CumulativeKpiGrid } from './CumulativeKpiGrid'
import {
  entryInPeriod,
  periodLabel,
  ytdActualsContribution,
} from '../lib/cumulative'

/** Per-tile description for each Utilization card on the dashboard.
 *  Method-neutral — works for hours, time slots, dollars, headcount, etc.
 *  The section-level description (UTILIZATION_DESC) covers the broader
 *  feature on Settings / B&G. */
export const TEAM_CAPACITY_DESC =
  'Capacity is the maximum the team can produce in a week without overworking or working overtime.'

/** Section-level description for Settings → Utilization and Budget &
 *  Goals → Utilization Goals. Frames utilization as the measurement and
 *  capacity as the baseline you compare against. */
export const UTILIZATION_DESC =
  "Tracks what share of the team's available capacity was used each week. Capacity is the baseline — define each team's employees, method, and capacity below. The dashboard then shows each team's actual use against a weekly goal."

// =============================================================================
// Phase 5b — Weekly Dashboard
// =============================================================================
// Shows the most recent weekly entry as a grid of KPI tiles, color-coded
// against weekly goals (annual-target × season_pct × 7/days-in-month for
// sum/$ KPIs; pass-through for %/avg/last). Categories: Financials →
// Marketing → Sales (with Pipeline subsection) → Operations → Team →
// Overall Company. Custom KPIs render in their assigned categories.
// Capacity groups render as tiles in Team.
//
// Mode pills (Weekly / MTD / QTD / YTD) are rendered as a visual element
// only — Weekly is the active mode; clicking another pill does nothing
// for now (Phase 6 wires up MTD/QTD/YTD cumulative views).
// =============================================================================

type Props = {
  clientId: string
  coachView: boolean
}

type Mode = 'weekly' | 'mtd' | 'qtd' | 'ytd'

export function WeeklyDashboard({ clientId, coachView }: Props) {
  const [client, setClient] = useState<Client | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [entries, setEntries] = useState<WeeklyEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('weekly')

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    const year = new Date().getFullYear()
    const [cRes, bRes, eRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
      supabase
        .from('budgets')
        .select('*')
        .eq('client_id', clientId)
        .eq('year', year)
        .maybeSingle(),
      supabase
        .from('weekly_entries')
        .select('*')
        .eq('client_id', clientId)
        .order('week_start_date', { ascending: false })
        .limit(60),
    ])
    if (cRes.error) {
      setError(cRes.error.message)
      setLoading(false)
      return
    }
    setClient(cRes.data as Client | null)
    setBudget((bRes.data as Budget | null) ?? null)
    setEntries(((eRes.data as WeeklyEntry[] | null) ?? []) as WeeklyEntry[])
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [clientId])

  // Pick the entry to display: prefer the current Sunday's entry; fall
  // back to the most recent entry by date.
  const { displayedEntry, isCurrentWeek, mostRecentDateIso } = useMemo(() => {
    if (entries.length === 0)
      return {
        displayedEntry: null as WeeklyEntry | null,
        isCurrentWeek: false,
        mostRecentDateIso: null as string | null,
      }
    const currentSunIso = isoDate(mostRecentCompletedWeekStart())
    const current = entries.find((e) => e.week_start_date === currentSunIso)
    const mostRecent = entries[0]
    return {
      displayedEntry: current ?? mostRecent,
      isCurrentWeek: !!current,
      mostRecentDateIso: mostRecent?.week_start_date ?? null,
    }
  }, [entries])

  // Prior-week entry for week-over-week deltas: exactly 7 days before the
  // displayed entry. Null when no such row exists.
  const priorEntry = useMemo(() => {
    if (!displayedEntry) return null
    const prevIso = isoDate(
      shiftWeek(dateFromIso(displayedEntry.week_start_date), -1)
    )
    return entries.find((e) => e.week_start_date === prevIso) ?? null
  }, [entries, displayedEntry])

  // Compute the budget view for the entry's year. Returns null if no
  // budget exists yet. GP% derives from cogs_target_pct (which is what the
  // DB stores — Budget & Goals form just inverts it for display).
  const budgetView = useMemo(() => {
    if (!budget) return null
    const cogsPct =
      budget.cogs_target_pct != null ? Number(budget.cogs_target_pct) : null
    const gpPct = cogsPct != null ? 100 - cogsPct : null
    return computeBudgetView({
      annualRevenue:
        budget.annual_revenue != null ? Number(budget.annual_revenue) : null,
      grossProfitPct: gpPct,
      annualExpenses:
        budget.annual_expenses != null ? Number(budget.annual_expenses) : null,
      seasonType: (budget.season_type ?? 'even') as Budget['season_type'],
      seasonPct: (budget.season_pct as number[] | null) ?? [],
      ytdThruMonth: budget.ytd_thru_month ?? null,
      ytdRevenueByMonth:
        (budget.ytd_revenue_by_month as (number | null)[] | null) ?? null,
      ytdCogsByMonth:
        (budget.ytd_cogs_by_month as (number | null)[] | null) ?? null,
      ytdExpensesByMonth:
        (budget.ytd_expenses_by_month as (number | null)[] | null) ??
        emptyMonthArray(),
    })
  }, [budget])

  // Per-month share fractions summing to 1.0 — same math the budget engine
  // uses internally. Drives every non-financial weekly goal (sum/$ KPIs).
  const monthShares = useMemo(
    () =>
      monthShareFractions(
        (budget?.season_type ?? 'even') as Budget['season_type'],
        (budget?.season_pct as number[] | null) ?? []
      ),
    [budget]
  )

  // Find the MonthlyGoal for whichever month the displayed entry's Sunday
  // belongs to.
  const entryMonthlyGoal: MonthlyGoal | null = useMemo(() => {
    if (!displayedEntry || !budgetView) return null
    const month = dateFromIso(displayedEntry.week_start_date).getMonth()
    return budgetView.months.find((m) => m.monthIdx === month) ?? null
  }, [displayedEntry, budgetView])

  // KPI annual goals — live on the budget, NOT on client.kpis (that's the
  // active-toggle map keyed by KPI id with 0/1 values).
  const kpiGoals = (budget?.goals ?? {}) as Record<string, number>

  // Which KPI ids are currently enabled per client.kpis. Used when picking
  // between mutex partners (e.g. closeRate's won-dollars source) in
  // deriveAnnualGoal.
  const enabledIds = useMemo(() => {
    const out = new Set<string>()
    for (const [id, v] of Object.entries(client?.kpis ?? {})) {
      if (Number(v) === 1) out.add(id)
    }
    return out
  }, [client])

  // Cumulative-mode period anchor. Always today (cumulative dashboards
  // always read "from period start through today"); the mode pill picks
  // which period. Memo so it's stable per render — the dashboard isn't
  // expected to roll over the day boundary mid-session, but recomputing
  // these on every render would also be cheap.
  const today = useMemo(() => new Date(), [])
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth()

  // In-period entries — filtered subset for the active cumulative mode.
  // Empty when mode === 'weekly' (the weekly grid uses a single entry).
  const entriesInPeriod = useMemo(() => {
    if (mode === 'weekly') return []
    return entries.filter((e) =>
      entryInPeriod(e, mode, currentYear, currentMonth, today)
    )
  }, [entries, mode, currentYear, currentMonth, today])

  // ---- Render --------------------------------------------------------------

  if (loading)
    return <div className="text-black text-sm">Loading dashboard…</div>
  if (error)
    return (
      <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3">
        {error}
      </div>
    )
  if (!client) return null

  return (
    <section className="space-y-4 font-acumin">
      <Header
        clientName={client.company_name}
        mode={mode}
        onMode={setMode}
        displayedEntry={displayedEntry}
        isCurrentWeek={isCurrentWeek}
        mostRecentDateIso={mostRecentDateIso}
      />

      {/* Coach Note block at the top — coach edits, client reads. Empty
          on client view if no note exists. Constrained to the width of one
          KPI tile so it doesn't dominate the dashboard. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <CoachNoteBlock
          clientId={clientId}
          note={client.coach_note}
          updatedAt={client.coach_note_updated_at}
          coachView={coachView}
          onSaved={loadAll}
        />
      </div>

      {/* Empty state — no entries at all */}
      {entries.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
          No entries yet. Go to <strong>Weekly Entry</strong> to log your
          first week.
        </div>
      )}

      {/* KPI grid — weekly view uses the displayed entry; cumulative
          views aggregate all in-period entries. */}
      {mode === 'weekly' && displayedEntry && (
        <KpiGrid
          client={client}
          entry={displayedEntry}
          priorEntry={priorEntry}
          monthlyGoal={entryMonthlyGoal}
          monthShares={monthShares}
          kpiGoals={kpiGoals}
          enabledIds={enabledIds}
          annualRevenue={
            budget?.annual_revenue != null
              ? Number(budget.annual_revenue)
              : undefined
          }
          capacityGroupGoals={
            (budget?.capacity_group_goals ?? {}) as Record<
              string,
              CapacityGroupGoal
            >
          }
        />
      )}

      {mode !== 'weekly' && (
        <>
          <div className="text-base font-bold text-black">
            {periodLabel(mode, currentYear, currentMonth)}
          </div>
          {/* QTD onboarding disclaimer — for clients who started mid-
              quarter, the pre-coaching month(s) folded into QTD are
              derived from the YTD actuals, which may have been entered
              as a single total and spread by the seasonality config. */}
          {mode === 'qtd' &&
            ytdActualsContribution(budget, mode, currentYear, currentMonth)
              .monthsCovered.length > 0 && (
              <div className="text-xs text-black italic">
                Earlier months estimated from your YTD actuals.
              </div>
            )}
          {entriesInPeriod.length === 0 &&
          ytdActualsContribution(budget, mode, currentYear, currentMonth)
            .monthsCovered.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
              No entries for this period yet.
            </div>
          ) : (
            <CumulativeKpiGrid
              client={client}
              mode={mode}
              year={currentYear}
              month={currentMonth}
              entriesInPeriod={entriesInPeriod}
              budget={budget}
              monthlyGoals={budgetView?.months ?? null}
              monthShares={monthShares}
              kpiGoals={kpiGoals}
              enabledIds={enabledIds}
              annualRevenue={
                budget?.annual_revenue != null
                  ? Number(budget.annual_revenue)
                  : undefined
              }
              capacityGroupGoals={
                (budget?.capacity_group_goals ?? {}) as Record<
                  string,
                  CapacityGroupGoal
                >
              }
            />
          )}
        </>
      )}

      {/* Notes block for the displayed entry (different from coach notes:
          this is the per-week note typed on Weekly Entry). Weekly mode
          only — cumulative views span multiple weeks. */}
      {mode === 'weekly' && displayedEntry?.notes && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs font-bold uppercase tracking-wider text-black mb-1">
            Notes for {formatWeekShort(dateFromIso(displayedEntry.week_start_date))}
          </div>
          <div className="text-sm text-black whitespace-pre-wrap leading-relaxed">
            {displayedEntry.notes}
          </div>
        </div>
      )}
    </section>
  )
}

// =============================================================================
// Header — title + mode pills + most-recent-entry pill
// =============================================================================

function Header({
  mode,
  onMode,
  displayedEntry,
  isCurrentWeek,
  mostRecentDateIso,
}: {
  clientName: string
  mode: Mode
  onMode: (m: Mode) => void
  displayedEntry: WeeklyEntry | null
  isCurrentWeek: boolean
  mostRecentDateIso: string | null
}) {
  return (
    <div className="sticky top-[48px] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-6 sm:-mt-8 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-lg font-bold text-ink">Performance Dashboard</h1>
        <ModePills mode={mode} onMode={onMode} />
      </div>

      <div className="flex items-center gap-2 flex-wrap text-base">
        {!displayedEntry ? (
          <span className="bg-ink text-white px-3 py-1 rounded font-semibold">
            No entries yet
          </span>
        ) : isCurrentWeek ? (
          <span className="bg-ink text-white px-3 py-1 rounded font-semibold">
            Week of{' '}
            {formatWeekShort(dateFromIso(displayedEntry.week_start_date))}
          </span>
        ) : (
          <span className="bg-bad text-white px-3 py-1 rounded font-semibold">
            Last entry {formatWeekShort(dateFromIso(mostRecentDateIso!))} —
            log this week to update your dashboard
          </span>
        )}
      </div>
    </div>
  )
}

function ModePills({
  mode,
  onMode,
}: {
  mode: Mode
  onMode: (m: Mode) => void
}) {
  const pill = (m: Mode, label: string) => (
    <button
      key={m}
      type="button"
      onClick={() => onMode(m)}
      className={`px-3 py-1.5 rounded text-xs font-bold border ${
        mode === m
          ? 'bg-ink text-accent border-line'
          : 'bg-transparent text-black border-gray-400'
      }`}
    >
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap gap-1">
      {pill('weekly', 'Weekly')}
      {pill('mtd', 'MTD')}
      {pill('qtd', 'QTD')}
      {pill('ytd', 'YTD')}
    </div>
  )
}

// =============================================================================
// KPI Grid — all categories, all tiles
// =============================================================================

function KpiGrid({
  client,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  capacityGroupGoals,
}: {
  client: Client
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  capacityGroupGoals: Record<string, CapacityGroupGoal>
}) {
  const visible = visibleTileKpis(client)
  const customKpis = (client.custom_kpis ?? []).filter(
    (c) => c.active !== false
  )

  return (
    <div className="space-y-5">
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat}
          category={cat}
          client={client}
          entry={entry}
          priorEntry={priorEntry}
          monthlyGoal={monthlyGoal}
          monthShares={monthShares}
          kpiGoals={kpiGoals}
          enabledIds={enabledIds}
          annualRevenue={annualRevenue}
          capacityGroupGoals={capacityGroupGoals}
          standardKpis={visible.filter((k) => k.category === cat)}
          customKpis={customKpis.filter((c) => c.category === cat)}
          capacityGroups={
            cat === 'Team' &&
            Number(client.kpis?.capacityUtilization) === 1
              ? client.capacity_groups ?? []
              : []
          }
        />
      ))}
    </div>
  )
}

function CategorySection({
  category,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  capacityGroupGoals,
  client,
  standardKpis,
  customKpis,
  capacityGroups,
}: {
  category: KpiCategory
  client: Client
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  capacityGroupGoals: Record<string, CapacityGroupGoal>
  standardKpis: ReturnType<typeof visibleTileKpis>
  customKpis: CustomKpi[]
  capacityGroups: CapacityGroup[]
}) {
  // Hide categories with nothing in them. Empty Overall Company never
  // renders a header.
  const hasContent =
    standardKpis.length > 0 ||
    customKpis.length > 0 ||
    capacityGroups.length > 0
  if (!hasContent) return null

  // Sales gets a Pipeline subsection — KPIs whose category is 'Sales'
  // AND whose label contains 'Pipeline'. Everything else stays in main.
  // (Per Jackie's spec: dropped the Estimating subsection. The Estimates
  // Written / # of Estimates / Avg Estimate KPIs now flow into main Sales.)
  const pipelineIds = new Set<string>([
    'pipelineValue',
    'pipelineDeals',
    'avgPipelineDeal',
  ])
  // "Primary" KPIs — the true output measures of each department, as
  // opposed to the input drivers. Render in the tall 1/4-width tile at
  // the top of their category.
  const primaryKpiIds = new Set<string>([
    'revenue',
    'grossProfit',
    'newClients',
    'estimatesWonDollars',
    'contractsWonDollars',
    'jobsCompleted',
  ])
  const mainSales =
    category === 'Sales'
      ? standardKpis.filter((k) => !pipelineIds.has(k.id))
      : standardKpis
  const pipelineSales =
    category === 'Sales'
      ? standardKpis.filter((k) => pipelineIds.has(k.id))
      : []

  const renderStandardTile = (kpi: KpiDef) => (
    <StandardTile
      key={kpi.id}
      kpi={kpi}
      entry={entry}
      priorEntry={priorEntry}
      monthlyGoal={monthlyGoal}
      monthShares={monthShares}
      kpiGoals={kpiGoals}
      enabledIds={enabledIds}
      annualRevenue={annualRevenue}
      client={client}
    />
  )

  return (
    <div>
      <div className="text-base font-bold text-ink uppercase tracking-wider pb-1 mb-3 border-b-2 border-accent">
        {category}
      </div>

      {(() => {
        const primaries = mainSales.filter((k) => primaryKpiIds.has(k.id))
        const regulars = mainSales.filter((k) => !primaryKpiIds.has(k.id))
        return (
          <>
            {primaries.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-stretch mb-4">
                {primaries.map((kpi) => (
                  <div key={kpi.id} className="md:col-span-1">
                    <FinancialsRowTile
                      kpi={kpi}
                      entry={entry}
                      priorEntry={priorEntry}
                      monthlyGoal={monthlyGoal}
                      monthShares={monthShares}
                      kpiGoals={kpiGoals}
                      enabledIds={enabledIds}
                      annualRevenue={annualRevenue}
                      client={client}
                      showPacebar
                      compact
                      tall
                    />
                  </div>
                ))}
              </div>
            )}
            {(regulars.length > 0 || customKpis.length > 0) && (
              <TileGrid>
                {regulars.map(renderStandardTile)}
                {customKpis.map((c) => (
                  <CustomTile
                    key={c.id}
                    custom={c}
                    entry={entry}
                    priorEntry={priorEntry}
                    goal={kpiGoals[c.id]}
                  />
                ))}
              </TileGrid>
            )}
          </>
        )
      })()}

      {/* Each capacity group becomes its own subsection within the Team
          category: a sub-heading with the group's name, then a row of
          tiles. Every group gets Capacity Utilization; labor-method
          groups also get Labor Hours Produced + Labor Efficiency. */}
      {capacityGroups.map((g, i) => (
        <div
          key={g.id}
          className={
            i > 0 || mainSales.length > 0 || customKpis.length > 0
              ? 'mt-4'
              : ''
          }
        >
          <div className="text-xs font-bold text-ink uppercase tracking-wider pb-1 mb-2 border-b border-line">
            {g.name || 'Untitled group'}
          </div>
          <TileGrid>
            <CapacityTile
              group={g}
              entry={entry}
              goal={capacityGroupGoals[g.id]}
            />
            {g.method === 'labor' && (
              <>
                <LaborHoursTile
                  group={g}
                  entry={entry}
                  goal={capacityGroupGoals[g.id]?.laborHoursGoal}
                />
                {!g.hideLaborEfficiency && (
                  <LaborEfficiencyTile
                    group={g}
                    entry={entry}
                    goal={capacityGroupGoals[g.id]?.laborEfficiencyGoal}
                  />
                )}
              </>
            )}
          </TileGrid>
        </div>
      ))}

      {pipelineSales.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-ink uppercase tracking-wider pb-1 mb-2 border-b border-line">
            Pipeline
          </div>
          <TileGrid>
            {pipelineSales.map((kpi) => (
              <StandardTile
                key={kpi.id}
                kpi={kpi}
                entry={entry}
                priorEntry={priorEntry}
                monthlyGoal={monthlyGoal}
                monthShares={monthShares}
                kpiGoals={kpiGoals}
                enabledIds={enabledIds}
                annualRevenue={annualRevenue}
                client={client}
              />
            ))}
          </TileGrid>
        </div>
      )}
    </div>
  )
}

function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
      {children}
    </div>
  )
}

// =============================================================================
// Individual tile renderers (standard / custom / capacity)
// =============================================================================

/** Financials tile with optional pacebar. Wide (Income, col-span-2)
 *  uses a title-left / value-right horizontal layout. Compact tiles
 *  (col-span-1 like Expenses / AR) stack vertically — title top-left,
 *  value/goal centered below — so long labels like "Accounts
 *  Receivable" with wide dollar values don't crowd the right edge. */
function FinancialsRowTile({
  kpi,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  client,
  showPacebar,
  compact = false,
  lightBgHex,
  tall = false,
}: {
  kpi: KpiDef
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  client: Client
  showPacebar: boolean
  /** When true, use the vertical (stacked) layout. Pass on narrow
   *  col-span-1 tiles. */
  compact?: boolean
  /** Optional light-background hex (e.g. "#f2f2f2"). When set, the tile
   *  paints the bg with this color and switches label / goal text to
   *  black. Used to experiment with a light Income tile while leaving
   *  the rest of the dashboard untouched. */
  lightBgHex?: string
  /** Double-height variant. Min-height bumps from 110px to 220px and
   *  the value text gets bigger to fill the space. Used for primary
   *  KPIs that get a 1/4-page-wide but tall tile. */
  tall?: boolean
}) {
  const groups = client.capacity_groups ?? []
  const value = actualValue(kpi.id, entry, groups)
  const prior = priorEntry ? actualValue(kpi.id, priorEntry, groups) : null
  const delta = value != null && prior != null ? value - prior : null
  const goal = weeklyGoal({
    kpi,
    entry,
    client: {} as Client,
    monthlyGoal,
    monthShares,
    kpiGoals,
    enabledIds,
    annualRevenue,
  })
  const direction = kpi.direction ?? 'hi'
  const range = kpi.range ?? false
  const status = computeRingStatus({ value, goal, direction, range })
  const ratio =
    value != null && goal != null && goal !== 0 ? value / goal : null

  const isLight = !!lightBgHex

  // Result text follows the same three-tone band as the ring: green at
  // goal or better, yellow in the within-10% band, red beyond. When
  // there's no ratio yet, fall back to the body text color so the
  // value stays legible on whichever background the tile is using.
  const resultColor = (() => {
    if (ratio == null) return isLight ? 'text-black' : 'text-white'
    if (range) {
      const dev = Math.abs((value ?? 0) - (goal ?? 0)) / (goal ?? 1)
      if (dev <= 0.1) return 'text-good'
      if (dev <= 0.15) return 'text-accent'
      return 'text-bad'
    }
    if (direction === 'hi') {
      if (ratio >= 1) return 'text-good'
      if (ratio >= 0.9) return 'text-accent'
      return 'text-bad'
    }
    if (ratio <= 1) return 'text-good'
    if (ratio <= 1.1) return 'text-accent'
    return 'text-bad'
  })()

  // Delta arrow color: directional. Higher-better KPIs moving up is
  // green; the wrong way is red. Range KPIs (AR) pick "good" as
  // movement toward goal. Falls back to body text color when there's
  // no movement.
  const deltaColor = (() => {
    if (delta == null || delta === 0) {
      return isLight ? 'text-black' : 'text-white'
    }
    if (range) {
      if (value == null || goal == null) {
        return isLight ? 'text-black' : 'text-white'
      }
      const before = Math.abs((prior ?? 0) - goal)
      const after = Math.abs(value - goal)
      return after < before ? 'text-good' : 'text-bad'
    }
    const isGood = direction === 'lo' ? delta < 0 : delta > 0
    return isGood ? 'text-good' : 'text-bad'
  })()
  const tileStyle = isLight ? { backgroundColor: lightBgHex } : undefined
  const tileBg = isLight ? '' : 'bg-ink'
  const labelText = isLight ? 'text-black' : 'text-white'
  const goalText = isLight ? 'text-black' : 'text-white'
  const pacebarTrack = isLight ? 'bg-[#d9d9d9]' : 'bg-[#3a3a3a]'
  const minH = tall ? 'min-h-[220px]' : 'min-h-[110px]'
  const valueText = tall
    ? 'text-3xl font-semibold leading-none'
    : 'text-lg font-bold leading-none'

  const pacebar = showPacebar ? (
    <div
      className={`mt-3 w-full h-2 rounded-full overflow-hidden ${pacebarTrack}`}
    >
      {status.color && (
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(ratio ?? 0, 1) * 100}%`,
            backgroundColor: status.color.stroke,
          }}
        />
      )}
    </div>
  ) : null

  if (compact) {
    return (
      <div
        className={`rounded-lg p-3 flex flex-col ${minH} ${tileBg}`}
        style={tileStyle}
      >
        <div className="flex items-center gap-0.5">
          <div
            className={`text-xs font-semibold uppercase tracking-wider ${labelText}`}
          >
            {kpi.label}
          </div>
          {kpi.desc && <InfoIcon text={kpi.desc} />}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className={`${valueText} ${resultColor}`}>
            {formatKpiValue(value, kpi.format)}
          </div>
          {delta != null && delta !== 0 && (
            <div className={`text-xs mt-1 ${deltaColor}`}>
              {formatKpiDelta(delta, kpi.format)}
            </div>
          )}
          <div className={`text-base mt-1 ${goalText}`}>
            Goal: {formatKpiValue(goal, kpi.format)}
          </div>
        </div>
        {pacebar}
      </div>
    )
  }

  return (
    <div
      className={`rounded-lg p-3 flex flex-col ${minH} ${tileBg}`}
      style={tileStyle}
    >
      <div className="flex items-start justify-between gap-3 flex-1">
        <div className="flex items-center gap-0.5">
          <div
            className={`text-xs font-semibold uppercase tracking-wider whitespace-nowrap ${labelText}`}
          >
            {kpi.label}
          </div>
          {kpi.desc && <InfoIcon text={kpi.desc} />}
        </div>
        <div className="text-right self-center">
          <div className={`${valueText} ${resultColor}`}>
            {formatKpiValue(value, kpi.format)}
          </div>
          {delta != null && delta !== 0 && (
            <div className={`text-xs mt-1 ${deltaColor}`}>
              {formatKpiDelta(delta, kpi.format)}
            </div>
          )}
          <div className={`text-base mt-1 ${goalText}`}>
            Goal: {formatKpiValue(goal, kpi.format)}
          </div>
        </div>
      </div>
      {pacebar}
    </div>
  )
}

function StandardTile({
  kpi,
  entry,
  priorEntry,
  monthlyGoal,
  monthShares,
  kpiGoals,
  enabledIds,
  annualRevenue,
  client,
}: {
  kpi: KpiDef
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  monthlyGoal: MonthlyGoal | null
  monthShares: number[]
  kpiGoals: Record<string, number>
  enabledIds: Set<string>
  annualRevenue: number | undefined
  client: Client
}) {
  if (!kpi) return null
  const groups = client.capacity_groups ?? []
  const value = actualValue(kpi.id, entry, groups)
  const prior = priorEntry ? actualValue(kpi.id, priorEntry, groups) : null
  const delta =
    value != null && prior != null ? value - prior : null
  const goal = weeklyGoal({
    kpi,
    entry,
    client: {} as Client,
    monthlyGoal,
    monthShares,
    kpiGoals,
    enabledIds,
    annualRevenue,
  })

  // Expenses on the weekly dashboard is "awareness only" — show the
  // value + prior-week delta with no goal line. Coaches set an annual
  // expense target on Budget & Goals but the weekly slice isn't
  // actionable on its own; cumulative views (MTD/QTD/YTD) carry the
  // pace tracking instead.
  const isAwarenessOnly = kpi.id === 'expenses'

  return (
    <KpiTile
      label={kpi.label}
      desc={kpi.desc}
      format={kpi.format}
      direction={kpi.direction ?? 'hi'}
      value={value}
      goal={isAwarenessOnly ? null : goal}
      delta={delta}
      range={kpi.range}
      hideGoal={isAwarenessOnly}
      view="number"
    />
  )
}

function CustomTile({
  custom,
  entry,
  priorEntry,
  goal,
}: {
  custom: CustomKpi
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  goal: number | undefined
}) {
  const value = (entry.kpi_values ?? {})[custom.id] ?? null
  const prior = priorEntry
    ? (priorEntry.kpi_values ?? {})[custom.id] ?? null
    : null
  const delta =
    value != null && prior != null ? Number(value) - Number(prior) : null

  // Custom KPI goals are STATIC — whatever the coach enters in Budget &
  // Goals is the per-period goal as-is. No annual-to-weekly pro-rating
  // (unlike standard sum/$ KPIs).
  const weeklyG = goal != null && goal !== 0 ? goal : null

  return (
    <KpiTile
      label={custom.name}
      format={custom.format}
      direction={custom.direction}
      value={value as number | null}
      goal={weeklyG}
      delta={delta}
      hideGoalPct
    />
  )
}

/** Per-group tile: labor hours produced this week for one labor-method
 *  capacity group. Optional weekly goal — when set, the tile colors
 *  green/red against a ±10% band and shows "Goal: X hrs ±10%". */
function LaborHoursTile({
  group,
  entry,
  goal,
}: {
  group: CapacityGroup
  entry: WeeklyEntry
  goal: number | undefined
}) {
  const cv = (entry.capacity_values ?? {})[group.id] as
    | { producedHours?: number }
    | undefined
  const produced = cv?.producedHours ?? 0
  const value = produced > 0 ? produced : null
  const band = computeBand({
    value,
    goal: goal && goal > 0 ? goal : null,
    direction: 'hi',
    range: true,
  })
  const valueColor =
    band === 'green'
      ? 'text-good'
      : band === 'yellow'
        ? 'text-accent'
        : band === 'red'
          ? 'text-bad'
          : 'text-white'
  return (
    <div className="bg-ink rounded-lg p-3 min-h-[110px] flex flex-col">
      <div className="flex items-center gap-0.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          Labor Hours Produced
        </div>
        <InfoIcon text="Productive labor hours generated by this team this week." />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-lg font-bold leading-none ${valueColor}`}>
          {value != null ? `${value} hrs` : '—'}
        </div>
        <div className="text-sm text-white mt-1">
          {goal && goal > 0 ? `Goal: ${goal} hrs (±10%)` : 'No goal set'}
        </div>
      </div>
    </div>
  )
}

/** Per-group tile: labor efficiency for one labor-method capacity group.
 *  Formula: this group's produced hours ÷ this group's working hours × 100.
 *  Optional goal — ±10% band coloring. */
function LaborEfficiencyTile({
  group,
  entry,
  goal,
}: {
  group: CapacityGroup
  entry: WeeklyEntry
  goal: number | undefined
}) {
  const cv = (entry.capacity_values ?? {})[group.id] as
    | { producedHours?: number }
    | undefined
  const produced = cv?.producedHours ?? 0
  const working = groupWorkingHours(group)
  const pct = working > 0 ? (produced / working) * 100 : null
  const band = computeBand({
    value: pct,
    goal: goal && goal > 0 ? goal : null,
    direction: 'hi',
    range: true,
  })
  const valueColor =
    band === 'green'
      ? 'text-good'
      : band === 'yellow'
        ? 'text-accent'
        : band === 'red'
          ? 'text-bad'
          : 'text-white'
  return (
    <div className="bg-ink rounded-lg p-3 min-h-[110px] flex flex-col">
      <div className="flex items-center gap-0.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          Labor Efficiency
        </div>
        <InfoIcon text="How productively the team used their scheduled time this week." />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-lg font-bold leading-none ${valueColor}`}>
          {pct != null ? `${pct.toFixed(1)}%` : '—'}
        </div>
        {pct != null && (
          <div className="text-xs text-white mt-1">
            {produced} / {working} hrs
          </div>
        )}
        <div className="text-sm text-white mt-1">
          {goal && goal > 0 ? `Goal: ${goal}% (±10%)` : 'No goal set'}
        </div>
      </div>
    </div>
  )
}

function CapacityTile({
  group,
  entry,
  goal,
}: {
  group: CapacityGroup
  entry: WeeklyEntry
  /** Capacity group goal from budget.capacity_group_goals[group.id]. */
  goal: CapacityGroupGoal | undefined
}) {
  const cv = (entry.capacity_values ?? {})[group.id]
  const cap = groupMaxCapacity(group)

  // Big number is the weekly result (what the coach/client entered on
  // Weekly Entry — produced hours, slots filled, $ produced, etc.).
  // Sub-label is the utilization % derived from that value vs the team's
  // defined capacity.
  //
  // Manual method is the one exception: the input IS already a %, so the
  // big number is the % and there's no separate utilization line.
  let actualPct: number | null = null
  let actualDollars: number | null = null
  let valueText = '—'
  let subLabel = ''

  if (group.method === 'manual') {
    const v = cv as { utilizationPct?: number } | undefined
    actualPct = v?.utilizationPct ?? group.staticUtilPct ?? null
    valueText = actualPct != null ? `${actualPct.toFixed(1)}%` : '—'
  } else if (group.method === 'slots') {
    const v = cv as { slotsFilled?: number } | undefined
    const filled = v?.slotsFilled ?? 0
    actualPct = cap ? (filled / cap) * 100 : null
    valueText = `${filled} slots`
    subLabel = actualPct != null ? `${actualPct.toFixed(1)}% utilization` : ''
  } else if (group.method === 'labor') {
    const v = cv as { producedHours?: number } | undefined
    const produced = v?.producedHours ?? 0
    actualPct = cap ? (produced / cap) * 100 : null
    valueText = `${produced} hrs`
    subLabel = actualPct != null ? `${actualPct.toFixed(1)}% utilization` : ''
  } else if (group.method === 'revenue') {
    const v = cv as { revenueProduced?: number } | undefined
    const produced = v?.revenueProduced ?? 0
    actualDollars = produced
    actualPct = cap ? (produced / cap) * 100 : null
    valueText = `$${produced.toLocaleString()}`
    subLabel = actualPct != null ? `${actualPct.toFixed(1)}% utilization` : ''
  } else if (group.method === 'headcount') {
    const v = cv as
      | {
          hoursWorked?: number
          departments?: Record<string, { hoursWorked: number }>
        }
      | undefined
    const legacy = Object.values(v?.departments ?? {}).reduce(
      (s, d) => s + (d.hoursWorked ?? 0),
      0
    )
    const totalWorked = v?.hoursWorked ?? legacy
    actualPct = cap ? (totalWorked / cap) * 100 : null
    valueText = `${totalWorked} hrs`
    subLabel = actualPct != null ? `${actualPct.toFixed(1)}% utilization` : ''
  }

  // Goal label + band coloring. All capacity goals are range-style
  // (on-target within ±10% of goal). For revenue / $ goals the band is
  // computed against actualDollars, otherwise against actualPct.
  let goalLabel = 'No goal set'
  let bandValue: number | null = null
  let bandGoal: number | null = null
  if (goal) {
    if (group.method === 'revenue') {
      const revCap = groupMaxCapacity(group)
      const targetDollars =
        goal.format === '$' ? goal.target : (revCap * goal.target) / 100
      goalLabel = `Goal: $${Math.round(targetDollars).toLocaleString()} (±10%)`
      bandValue = actualDollars
      bandGoal = targetDollars > 0 ? targetDollars : null
    } else if (goal.format === '$') {
      goalLabel = `Goal: $${goal.target.toLocaleString()} (±10%)`
      bandValue = actualDollars
      bandGoal = goal.target > 0 ? goal.target : null
    } else {
      goalLabel = `Goal: ${goal.target}% (±10%)`
      bandValue = actualPct
      bandGoal = goal.target > 0 ? goal.target : null
    }
  }
  const band = computeBand({
    value: bandValue,
    goal: bandGoal,
    direction: 'hi',
    range: true,
  })
  const valueColor =
    band === 'green'
      ? 'text-good'
      : band === 'yellow'
        ? 'text-accent'
        : band === 'red'
          ? 'text-bad'
          : 'text-white'

  return (
    <div className="bg-ink rounded-lg p-3 min-h-[110px] flex flex-col">
      <div className="flex items-center gap-0.5">
        <div className="text-xs font-semibold uppercase tracking-wider text-white">
          Capacity Utilization
        </div>
        <InfoIcon text={TEAM_CAPACITY_DESC} />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-lg font-bold leading-none ${valueColor}`}>
          {valueText}
        </div>
        {subLabel && (
          <div className="text-xs text-white mt-1">{subLabel}</div>
        )}
        <div className="text-sm text-white mt-1">{goalLabel}</div>
      </div>
    </div>
  )
}
