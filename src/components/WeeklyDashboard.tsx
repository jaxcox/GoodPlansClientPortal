import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type {
  CapacityCell,
  CapacityGroupData,
  CapacitySectionData,
  ReportData,
} from './ReportDocument'
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
  daysInMonth,
  monthShareFractions,
  visibleTileKpis,
  weeklyGoal,
} from '../lib/dashboardGoals'
import { groupMaxCapacity, groupWorkingHours } from '../lib/capacity'
import {
  dateFromIso,
  formatWeekShort,
  isoDate,
  lastCompletedSaturday,
  missedWeeksBetween,
  mostRecentCompletedWeekStart,
  shiftWeek,
  weekStartSunday,
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
import { MissedWeeksPill, WeekOfCalendarPill } from './HeaderPills'
import {
  aggregateCapacityValue,
  aggregateCustomKpi,
  aggregateKpi,
  entryInPeriod,
  getPeriodGoalFull,
  paceFrac,
  periodLabel,
  quarterFromMonth,
  totalWeeksInPeriod,
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
  /** Called when the client taps a missed week in the status pill. The
   *  parent (ClientPortal) switches to the Weekly Entry tab and deep-
   *  links the entry form to that week. Optional — coach view may pass
   *  it through, client view always does. */
  onGoToMissedWeek?: (weekStart: Date) => void
}

type Mode = 'weekly' | 'mtd' | 'qtd' | 'ytd'

export function WeeklyDashboard({ clientId, coachView, onGoToMissedWeek }: Props) {
  const { coach } = useAuth()
  const [client, setClient] = useState<Client | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [entries, setEntries] = useState<WeeklyEntry[]>([])
  /** True while a PDF report is being generated — toggles the Download
   *  button to a "Preparing…" disabled state so a slow click doesn't
   *  double-trigger. */
  const [downloading, setDownloading] = useState(false)
  /** ISO YYYY-MM-DD for every saved entry across the client's history —
   *  used to compute the missed-weeks set for the status pill. Separate
   *  from `entries` (which caps at 60 for tile rendering) so the gap
   *  calculation stays correct past one year of weekly data. Each item
   *  is { startIso, days } so range-aware missed-weeks logic can detect
   *  partial-week coverage on boundary weeks (e.g. Mar 29 + Apr 1 must
   *  both exist for that Sun-Sat week to count as covered). */
  const [savedEntryRanges, setSavedEntryRanges] = useState<
    { startIso: string; days: number }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('weekly')
  /** User-picked week from the dashboard's calendar pill. Null means
   *  "use the smart default" (current week if entered, else most-recent
   *  saved entry). Once the user picks, that selection sticks across
   *  re-fetches until they pick another date. */
  const [pickedWeekStart, setPickedWeekStart] = useState<Date | null>(null)
  /** User-picked period anchor for the cumulative modes (MTD/QTD). The
   *  value is a 0-indexed month inside the current year — for QTD it's
   *  any month inside the target quarter (the period helpers
   *  quarter-bucket the value). Null means "use the current period".
   *  Reset whenever the mode pill changes so switching MTD → QTD starts
   *  fresh on the current quarter instead of carrying the picked month
   *  into a different bucket. */
  const [pickedPeriodMonth, setPickedPeriodMonth] = useState<number | null>(
    null
  )
  /** On-demand cache for a prior-year budget — populated when the
   *  weekly mode displays an entry whose year doesn't match
   *  currentYear. Keeps current-year's `budget` untouched (cumulative
   *  modes always read that one). Holds a single year at a time;
   *  switching between two different prior years would re-fetch — fine
   *  for the rare case it happens. */
  const [otherYearBudget, setOtherYearBudget] = useState<{
    year: number
    data: Budget | null
  } | null>(null)

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    const year = new Date().getFullYear()
    const [cRes, bRes, eRes, allDatesRes] = await Promise.all([
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
      supabase
        .from('weekly_entries')
        .select('week_start_date, days')
        .eq('client_id', clientId),
    ])
    if (cRes.error) {
      setError(cRes.error.message)
      setLoading(false)
      return
    }
    setClient(cRes.data as Client | null)
    setBudget((bRes.data as Budget | null) ?? null)
    setEntries(((eRes.data as WeeklyEntry[] | null) ?? []) as WeeklyEntry[])
    setSavedEntryRanges(
      ((allDatesRes.data ?? []) as {
        week_start_date: string
        days: number
      }[]).map((r) => ({ startIso: r.week_start_date, days: r.days ?? 7 }))
    )
    setLoading(false)
  }

  useEffect(() => {
    loadAll()
  }, [clientId])

  // Period anchor — today is stable per render. Declared up here (vs
  // colocated with the cumulative-mode block below) because the
  // year-boundary weeklyBudget memo references currentYear during
  // render and `const` declarations are in the temporal dead zone
  // until reached.
  const today = useMemo(() => new Date(), [])
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth()

  // Missed weeks — gaps between the client's onboarding week and the
  // current in-progress week with no saved entry. Drives the dashboard's
  // status pill (count + dropdown to deep-link straight into Entry).
  const missedWeeks = useMemo(() => {
    if (!client) return []
    return missedWeeksBetween(new Date(client.created_at), savedEntryRanges)
  }, [client, savedEntryRanges])

  // Resolve which week the dashboard is showing. User pick wins;
  // otherwise default to the most-recent-completed week if entered,
  // else the latest entry on file, else just the most-recent-completed
  // Sunday (so the calendar pill still has a value to display).
  const selectedWeekStart = useMemo<Date>(() => {
    if (pickedWeekStart) return pickedWeekStart
    const fallback = mostRecentCompletedWeekStart()
    if (entries.length === 0) return fallback
    const currentSunIso = isoDate(fallback)
    const current = entries.find((e) => e.week_start_date === currentSunIso)
    if (current) return dateFromIso(current.week_start_date)
    return dateFromIso(entries[0].week_start_date)
  }, [entries, pickedWeekStart])

  // The entry to render — strictly the row matching selectedWeekStart.
  // Null when the picked week has no saved entry (handled by the
  // selected-week empty state below).
  const displayedEntry = useMemo<WeeklyEntry | null>(() => {
    if (entries.length === 0) return null
    return (
      entries.find((e) => e.week_start_date === isoDate(selectedWeekStart)) ??
      null
    )
  }, [entries, selectedWeekStart])

  // Prior-week entry for week-over-week deltas: exactly 7 days before the
  // displayed entry. Null when no such row exists.
  const priorEntry = useMemo(() => {
    if (!displayedEntry) return null
    const prevIso = isoDate(
      shiftWeek(dateFromIso(displayedEntry.week_start_date), -1)
    )
    return entries.find((e) => e.week_start_date === prevIso) ?? null
  }, [entries, displayedEntry])

  // Year the displayed entry belongs to. Drives which budget the
  // weekly tile grid pulls goals from — important for the Dec-side
  // partial of a Dec/Jan boundary week (year N-1) viewed early in
  // year N, and for the rare case a coach scrolls back to view a
  // prior year's regular week.
  const displayedYear = useMemo<number | null>(() => {
    if (!displayedEntry) return null
    return dateFromIso(displayedEntry.week_start_date).getFullYear()
  }, [displayedEntry])

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

  // KPI annual goals — live on the budget, NOT on client.kpis (that's the
  // active-toggle map keyed by KPI id with 0/1 values).
  const kpiGoals = (budget?.goals ?? {}) as Record<string, number>

  // ---- Weekly-mode budget routing --------------------------------------
  // When the displayed week belongs to a prior year (Dec-side partial of
  // a Dec/Jan boundary, or a coach scrolling back to last year), the
  // weekly tile grid needs THAT year's budget for goals + season_pct —
  // current year's budget would color tiles against the wrong numbers.
  // Cumulative modes (MTD/QTD/YTD) always use the current year's budget
  // and aren't touched here.
  useEffect(() => {
    if (displayedYear == null || displayedYear === currentYear) return
    if (otherYearBudget?.year === displayedYear) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase
        .from('budgets')
        .select('*')
        .eq('client_id', clientId)
        .eq('year', displayedYear)
        .maybeSingle()
      if (cancelled) return
      setOtherYearBudget({
        year: displayedYear,
        data: (data as Budget | null) ?? null,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, displayedYear, currentYear, otherYearBudget])

  /** Which budget the weekly tile grid uses — current year's `budget`
   *  when the displayed entry is current-year (typical), the cached
   *  prior-year budget otherwise. Null while a prior-year load is in
   *  flight (the weekly grid handles null goals gracefully). */
  const weeklyBudget = useMemo<Budget | null>(() => {
    if (displayedYear == null || displayedYear === currentYear) return budget
    return otherYearBudget?.year === displayedYear
      ? otherYearBudget.data
      : null
  }, [displayedYear, currentYear, budget, otherYearBudget])

  // Weekly-mode budgetView / monthShares / kpiGoals derived from the
  // (possibly prior-year) weeklyBudget. Mirrors the cumulative versions
  // above but routes through whichever year matches the displayed entry.
  const weeklyBudgetView = useMemo(() => {
    if (!weeklyBudget) return null
    const cogsPct =
      weeklyBudget.cogs_target_pct != null
        ? Number(weeklyBudget.cogs_target_pct)
        : null
    const gpPct = cogsPct != null ? 100 - cogsPct : null
    return computeBudgetView({
      annualRevenue:
        weeklyBudget.annual_revenue != null
          ? Number(weeklyBudget.annual_revenue)
          : null,
      grossProfitPct: gpPct,
      annualExpenses:
        weeklyBudget.annual_expenses != null
          ? Number(weeklyBudget.annual_expenses)
          : null,
      seasonType: (weeklyBudget.season_type ?? 'even') as Budget['season_type'],
      seasonPct: (weeklyBudget.season_pct as number[] | null) ?? [],
      ytdThruMonth: weeklyBudget.ytd_thru_month ?? null,
      ytdRevenueByMonth:
        (weeklyBudget.ytd_revenue_by_month as (number | null)[] | null) ??
        null,
      ytdCogsByMonth:
        (weeklyBudget.ytd_cogs_by_month as (number | null)[] | null) ?? null,
      ytdExpensesByMonth:
        (weeklyBudget.ytd_expenses_by_month as (number | null)[] | null) ??
        emptyMonthArray(),
    })
  }, [weeklyBudget])
  const weeklyMonthShares = useMemo(
    () =>
      monthShareFractions(
        (weeklyBudget?.season_type ?? 'even') as Budget['season_type'],
        (weeklyBudget?.season_pct as number[] | null) ?? []
      ),
    [weeklyBudget]
  )
  const weeklyKpiGoals = (weeklyBudget?.goals ?? {}) as Record<string, number>

  // Find the MonthlyGoal for whichever month the displayed entry's
  // start belongs to. Uses weeklyBudgetView so prior-year entries pull
  // the right year's per-month goals.
  const entryMonthlyGoal: MonthlyGoal | null = useMemo(() => {
    if (!displayedEntry || !weeklyBudgetView) return null
    const month = dateFromIso(displayedEntry.week_start_date).getMonth()
    return weeklyBudgetView.months.find((m) => m.monthIdx === month) ?? null
  }, [displayedEntry, weeklyBudgetView])

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

  // activeMonth drives every cumulative-period calc (entriesInPeriod,
  // periodLabel, ytdActualsContribution, CumulativeKpiGrid). Falls
  // through to currentMonth when the user hasn't picked a past period —
  // the dashboard reads "month-to-date through today" exactly as before.
  // (today/currentYear/currentMonth are declared earlier in the function
  // body because the year-boundary weeklyBudget memo needs them.)
  const activeMonth = pickedPeriodMonth ?? currentMonth
  const isPastPeriod = activeMonth !== currentMonth

  // Reset the picked period whenever the mode pill changes so MTD →
  // QTD lands fresh on the current quarter rather than carrying a
  // picked month into a different bucket.
  useEffect(() => {
    setPickedPeriodMonth(null)
  }, [mode])

  // In-period entries — filtered subset for the active cumulative mode.
  // Empty when mode === 'weekly' (the weekly grid uses a single entry).
  // When a past period is picked, the same helper does the right thing:
  // entryInPeriod's "no future" guard becomes inert since the whole
  // period is already past.
  const entriesInPeriod = useMemo(() => {
    if (mode === 'weekly') return []
    return entries.filter((e) =>
      entryInPeriod(e, mode, currentYear, activeMonth, today)
    )
  }, [entries, mode, currentYear, activeMonth, today])

  // ---- Download Report (PDF) ----------------------------------------------
  // Builds the report data using the same value/goal helpers the on-screen
  // tiles use so the PDF mirrors what the coach sees. Weekly mode uses
  // actualValue + weeklyGoal; cumulative modes (MTD/QTD/YTD) use the
  // aggregate helpers from cumulative.ts. Custom KPIs and capacity-derived
  // tiles still TODO for both branches.

  const reportData = useMemo<ReportData | null>(() => {
    if (!client) return null
    const visible = visibleTileKpis(client)
    const byCategory = new Map<KpiCategory, KpiDef[]>()
    for (const k of visible) {
      const list = byCategory.get(k.category) ?? []
      list.push(k)
      byCategory.set(k.category, list)
    }

    const baseHeader = {
      clientName: client.company_name,
      brandName: coach?.brand_name ?? 'The Good Plans Co',
      coachNote: client.coach_note ?? null,
    }

    const activeCustomKpis = (client.custom_kpis ?? []).filter(
      (c) => c.active !== false
    )
    // Capacity groups render under Team when the Utilization KPI is on.
    // Each group produces one or more rows: utilization, plus Labor
    // Hours / Labor Efficiency for labor-method groups.
    const reportCapacityGroups =
      Number(client.kpis?.capacityUtilization) === 1
        ? client.capacity_groups ?? []
        : []

    if (mode === 'weekly') {
      if (!displayedEntry) return null
      const groups = client.capacity_groups ?? []
      const weeklyEntryStart = dateFromIso(displayedEntry.week_start_date)
      const entryMonth = weeklyEntryStart.getMonth()
      const entryYear = weeklyEntryStart.getFullYear()
      const capacityGroupGoalsArg = (weeklyBudget?.capacity_group_goals ??
        {}) as Record<string, CapacityGroupGoal>
      // Weekly capacity row builder — mirrors CapacityTile / LaborHoursTile
      // / LaborEfficiencyTile so the report values match what's on-screen.
      const weeklyCapacityGroups = (): CapacityGroupData[] => {
        return reportCapacityGroups.map((g) => {
          const cv = (displayedEntry.capacity_values ?? {})[g.id]
          const cap = groupMaxCapacity(g)
          // Utilization cell — value depends on method.
          let utilPct: number | null = null
          let utilValueRaw: number | null = null
          if (g.method === 'manual') {
            const v = cv as { utilizationPct?: number } | undefined
            utilPct = v?.utilizationPct ?? g.staticUtilPct ?? null
          } else if (g.method === 'slots') {
            const v = cv as { slotsFilled?: number } | undefined
            const filled = v?.slotsFilled ?? 0
            utilPct = cap ? (filled / cap) * 100 : null
          } else if (g.method === 'labor') {
            const v = cv as { producedHours?: number } | undefined
            const produced = v?.producedHours ?? 0
            utilPct = cap ? (produced / cap) * 100 : null
          } else if (g.method === 'revenue') {
            const v = cv as { revenueProduced?: number } | undefined
            const produced = v?.revenueProduced ?? 0
            utilValueRaw = produced
            utilPct = cap ? (produced / cap) * 100 : null
          } else if (g.method === 'headcount') {
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
            utilPct = cap ? (totalWorked / cap) * 100 : null
          }
          const gGoal = capacityGroupGoalsArg[g.id]
          const useDollarGoal =
            g.method === 'revenue' && gGoal?.format === '$'
          const utilization: CapacityCell = {
            format: useDollarGoal ? '$' : '%',
            direction: 'hi',
            range: true,
            value: useDollarGoal ? utilValueRaw : utilPct,
            goal: gGoal?.target ?? null,
          }
          // Labor-method extras.
          let laborHours: CapacityCell | null = null
          let laborEfficiency: CapacityCell | null = null
          if (g.method === 'labor') {
            const v = cv as { producedHours?: number } | undefined
            const produced = v?.producedHours ?? 0
            const laborHrsGoal = gGoal?.laborHoursGoal
            laborHours = {
              format: '#',
              direction: 'hi',
              // Labor Hours is hi-direction (more produced = better), not
              // a bidirectional range KPI. Over-producing labor hours is
              // unambiguously good — colors green / yellow / red against
              // ratio, not ±10% of goal.
              range: false,
              value: produced > 0 ? produced : null,
              goal: laborHrsGoal && laborHrsGoal > 0 ? laborHrsGoal : null,
            }
            if (!g.hideLaborEfficiency) {
              const working = groupWorkingHours(g)
              const effPct =
                working > 0 ? (produced / working) * 100 : null
              const laborEffGoal = gGoal?.laborEfficiencyGoal
              laborEfficiency = {
                format: '%',
                direction: 'hi',
                range: true,
                value: effPct,
                goal: laborEffGoal && laborEffGoal > 0 ? laborEffGoal : null,
              }
            }
          }
          return {
            name: g.name || 'Capacity',
            utilization,
            laborHours,
            laborEfficiency,
          }
        })
      }

      const sections = CATEGORIES.map((cat) => {
        const kpis = byCategory.get(cat) ?? []
        const customs = activeCustomKpis.filter((c) => c.category === cat)
        const standardRows = kpis.map((kpi) => {
          const value = actualValue(kpi.id, displayedEntry, groups)
          const goal = weeklyGoal({
            kpi,
            entry: displayedEntry,
            client,
            monthlyGoal: entryMonthlyGoal,
            monthShares: weeklyMonthShares,
            kpiGoals: weeklyKpiGoals,
            enabledIds,
            annualRevenue:
              weeklyBudget?.annual_revenue != null
                ? Number(weeklyBudget.annual_revenue)
                : undefined,
          })
          return {
            label: kpi.label,
            format: kpi.format,
            direction: kpi.direction ?? ('hi' as const),
            range: kpi.range ?? false,
            value,
            goal,
          }
        })
        // Custom KPIs follow the same goal-periodicity rule as standard
        // sum/$ KPIs: $/# stored as annual + pro-rated to the week; %
        // stays flat. Mirrors CustomTile in this file.
        const customRows = customs.map((custom) => {
          const value =
            (displayedEntry.kpi_values ?? {})[custom.id] ?? null
          const rawGoal = weeklyKpiGoals[custom.id]
          let goal: number | null = null
          if (typeof rawGoal === 'number' && Number.isFinite(rawGoal)) {
            if (custom.format === '%') {
              goal = rawGoal
            } else {
              const share = weeklyMonthShares[entryMonth] ?? 1 / 12
              const frac = 7 / daysInMonth(entryYear, entryMonth)
              goal = rawGoal * share * frac
            }
          }
          return {
            label: custom.name,
            format: custom.format,
            direction: custom.direction ?? ('hi' as const),
            range: false,
            value,
            goal,
          }
        })
        return {
          title: cat,
          rows: [...standardRows, ...customRows],
        }
      }).filter((s) => s.rows.length > 0)
      const capacityGroupsData = weeklyCapacityGroups()
      const capacitySection: CapacitySectionData | undefined =
        capacityGroupsData.length > 0
          ? { title: 'Team', groups: capacityGroupsData }
          : undefined
      return {
        ...baseHeader,
        periodLabel: `Week of ${formatWeekShort(
          dateFromIso(displayedEntry.week_start_date)
        )}`,
        sections,
        capacitySection,
      }
    }

    // Cumulative modes (mtd / qtd / ytd) — pace-adjusted goals so the
    // "Goal" column represents "where you should be by today in this
    // period," matching the dashboard's CumulativeTile color anchor.
    const ytd = ytdActualsContribution(budget, mode, currentYear, activeMonth)
    if (
      entriesInPeriod.length === 0 &&
      ytd.monthsCovered.length === 0
    ) {
      return null
    }
    const weeksInPeriod = totalWeeksInPeriod(mode, currentYear, activeMonth)
    const weeksFromEntries = entriesInPeriod.reduce(
      (sum, e) => sum + (e.days ?? 7) / 7,
      0
    )
    const pace = paceFrac(weeksFromEntries + ytd.weeksCovered, weeksInPeriod)
    const annualRevenueArg =
      budget?.annual_revenue != null ? Number(budget.annual_revenue) : undefined

    // sumQuarterShares — mirrors the private helper in CumulativeKpiGrid.
    // Inlined here so the report doesn't depend on internal grid helpers.
    const sumQuarterShares = (month: number): number => {
      const q = Math.floor(month / 3)
      let s = 0
      for (let i = 0; i < 3; i++) s += monthShares[q * 3 + i] ?? 1 / 12
      return s
    }
    const periodShareFor = (month: number): number =>
      mode === 'mtd'
        ? monthShares[month] ?? 1 / 12
        : mode === 'qtd'
          ? sumQuarterShares(month)
          : 1

    // Cumulative capacity group builder — mirrors CumulativeCapacityTile /
    // CumulativeLaborHoursTile / CumulativeLaborEfficiencyTile, returning
    // one CapacityGroupData per group so the PDF's transposed Utilization
    // table can put each group in its own column.
    const cumCapacityGroups = (): CapacityGroupData[] => {
      const capGoals = (budget?.capacity_group_goals ?? {}) as Record<
        string,
        CapacityGroupGoal
      >
      return reportCapacityGroups.map((g) => {
        const cap = groupMaxCapacity(g)
        const cumCap = cap * weeksInPeriod
        let utilValue: number | null
        let utilPct: number | null
        if (g.method === 'manual') {
          const vals: number[] = []
          for (const e of entriesInPeriod) {
            const cv = (e.capacity_values ?? {})[g.id] as
              | { utilizationPct?: number }
              | undefined
            const v = cv?.utilizationPct
            if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
          }
          utilValue = vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0) / vals.length
          utilPct = utilValue
        } else {
          utilValue = aggregateCapacityValue(g, entriesInPeriod)
          utilPct = cumCap > 0 && utilValue != null
            ? (utilValue / cumCap) * 100
            : null
        }
        const gGoal = capGoals[g.id]
        // Utilization cell shape varies with method + goal format. All
        // variants are range KPIs (target band), so paceGoal === goal —
        // pace doesn't scale for range. The Pace column will display the
        // same value as Goal so the column reads "pace = full goal."
        let utilization: CapacityCell
        if (g.method === 'revenue' && gGoal?.format === '$') {
          const periodGoal = gGoal.target * weeksInPeriod
          utilization = {
            format: '$',
            direction: 'hi',
            range: true,
            value: utilValue,
            goal: periodGoal,
            paceGoal: periodGoal,
          }
        } else if (g.method === 'revenue' && gGoal?.format === '%') {
          const periodGoal = (cumCap * gGoal.target) / 100
          utilization = {
            format: '$',
            direction: 'hi',
            range: true,
            value: utilValue,
            goal: periodGoal,
            paceGoal: periodGoal,
          }
        } else if (gGoal?.format === '$') {
          const periodGoal = gGoal.target * weeksInPeriod
          utilization = {
            format: '$',
            direction: 'hi',
            range: true,
            value: utilValue,
            goal: periodGoal,
            paceGoal: periodGoal,
          }
        } else {
          // % utilization goal — doesn't scale with period.
          const periodGoal = gGoal?.target ?? null
          utilization = {
            format: '%',
            direction: 'hi',
            range: true,
            value: utilPct,
            goal: periodGoal,
            paceGoal: periodGoal,
          }
        }
        // Labor-method extras.
        let laborHours: CapacityCell | null = null
        let laborEfficiency: CapacityCell | null = null
        if (g.method === 'labor') {
          let total = 0
          let any = false
          for (const e of entriesInPeriod) {
            const cv = (e.capacity_values ?? {})[g.id] as
              | { producedHours?: number }
              | undefined
            if (
              cv &&
              typeof cv.producedHours === 'number' &&
              Number.isFinite(cv.producedHours)
            ) {
              total += cv.producedHours
              any = true
            }
          }
          const lhrsWeekly = gGoal?.laborHoursGoal
          const fullLhrs =
            lhrsWeekly && lhrsWeekly > 0 ? lhrsWeekly * weeksInPeriod : null
          const paceLhrs = fullLhrs != null ? fullLhrs * pace : null
          laborHours = {
            format: '#',
            direction: 'hi',
            // Hi-direction (see weekly builder). Cumulative Labor Hours
            // pace-colors against produced/paceGoal — over-producing is
            // good, not "out of range." Goal column shows the full
            // period total; Pace shows where you should be by today.
            range: false,
            value: any ? total : null,
            goal: fullLhrs,
            paceGoal: paceLhrs,
          }
          if (!g.hideLaborEfficiency) {
            const working = groupWorkingHours(g)
            const cumWorking = working * weeksInPeriod
            const effPct =
              any && cumWorking > 0 ? (total / cumWorking) * 100 : null
            const leffGoal = gGoal?.laborEfficiencyGoal
            const effPeriodGoal = leffGoal && leffGoal > 0 ? leffGoal : null
            laborEfficiency = {
              format: '%',
              direction: 'hi',
              range: true,
              value: effPct,
              // % efficiency target stays flat across the period; pace
              // doesn't scale for range KPIs.
              goal: effPeriodGoal,
              paceGoal: effPeriodGoal,
            }
          }
        }
        return {
          name: g.name || 'Capacity',
          utilization,
          laborHours,
          laborEfficiency,
        }
      })
    }

    const sections = CATEGORIES.map((cat) => {
      const kpis = byCategory.get(cat) ?? []
      const customs = activeCustomKpis.filter((c) => c.category === cat)
      const standardRows = kpis.map((kpi) => {
        const value = aggregateKpi(kpi, entriesInPeriod, ytd.extra)
        const fullGoal = getPeriodGoalFull({
          kpi,
          mode,
          month: activeMonth,
          monthlyGoals: budgetView?.months ?? null,
          monthShares,
          kpiGoals,
          enabledIds,
          annualRevenue: annualRevenueArg,
        })
        // Pace-scaling rule mirrors CumulativeStandardTile: sum/$ and
        // dollar-derived KPIs scale; ratios / range / per-unit avgs stay
        // flat (a 60% conversion rate is 60% regardless of period). The
        // Pace column shows the scaled goal; non-scaling KPIs render the
        // same value in both Pace and Goal so the column reads as
        // "pace = the goal still applies".
        const scalesWithPace =
          kpi.format !== '%' &&
          !kpi.range &&
          (kpi.aggregation === 'sum' ||
            kpi.id === 'grossProfit' ||
            kpi.id === 'netProfit')
        const paceGoal =
          fullGoal != null && scalesWithPace ? fullGoal * pace : fullGoal
        return {
          label: kpi.label,
          format: kpi.format,
          direction: kpi.direction ?? ('hi' as const),
          range: kpi.range ?? false,
          value,
          goal: fullGoal,
          paceGoal,
        }
      })
      // Custom KPIs — same goal-periodicity rule as standard sum/$ KPIs,
      // plus pace adjustment for the in-flight period. Custom % KPIs
      // don't scale (same flat rate for the period).
      const customRows = customs.map((custom) => {
        const value = aggregateCustomKpi(custom, entriesInPeriod)
        const rawGoal = kpiGoals[custom.id]
        let goal: number | null = null
        let paceGoal: number | null = null
        if (typeof rawGoal === 'number' && Number.isFinite(rawGoal)) {
          if (custom.format === '%') {
            goal = rawGoal
            paceGoal = rawGoal
          } else {
            const fullG = rawGoal * periodShareFor(activeMonth)
            goal = fullG
            paceGoal = fullG * pace
          }
        }
        return {
          label: custom.name,
          format: custom.format,
          direction: custom.direction ?? ('hi' as const),
          range: false,
          value,
          goal,
          paceGoal,
        }
      })
      return {
        title: cat,
        rows: [...standardRows, ...customRows],
      }
    }).filter((s) => s.rows.length > 0)

    const cumCapacityData = cumCapacityGroups()
    const capacitySection: CapacitySectionData | undefined =
      cumCapacityData.length > 0
        ? { title: 'Team', groups: cumCapacityData }
        : undefined

    // Period label: "April 2026" / "Q2 2026" / "2026". The mode pill
    // makes MTD/QTD/YTD framing explicit in the on-screen experience;
    // adding a parenthetical to the PDF would just clutter the header.
    const baseLabel = periodLabel(mode, currentYear, activeMonth)
    const reportPeriodLabel =
      mode === 'ytd' ? baseLabel : `${baseLabel} ${currentYear}`

    return {
      ...baseHeader,
      periodLabel: reportPeriodLabel,
      sections,
      capacitySection,
      // MTD / QTD / YTD reports add a Pace column between Actual and
      // Goal. Weekly omits showPace (defaults to false in the PDF).
      showPace: true,
    }
  }, [
    mode,
    client,
    displayedEntry,
    entryMonthlyGoal,
    weeklyMonthShares,
    weeklyKpiGoals,
    enabledIds,
    weeklyBudget,
    coach,
    budget,
    budgetView,
    entriesInPeriod,
    currentYear,
    activeMonth,
    monthShares,
    kpiGoals,
  ])

  const onDownloadReport = async () => {
    if (!reportData || downloading) return
    setDownloading(true)
    try {
      // Dynamic import so the ~2MB react-pdf bundle only loads when the
      // user actually clicks Download (instead of bloating the main
      // bundle for everyone who just views the dashboard).
      const [{ pdf }, { ReportDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./ReportDocument'),
      ])
      const blob = await pdf(<ReportDocument data={reportData} />).toBlob()
      const safeName = reportData.clientName.replace(/[^a-z0-9]+/gi, '-')
      const safePeriod = reportData.periodLabel.replace(/[^a-z0-9]+/gi, '-')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${safeName}-${safePeriod}-Report.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

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
        mode={mode}
        onMode={setMode}
        selectedWeekStart={selectedWeekStart}
        onPickWeek={(d) => setPickedWeekStart(weekStartSunday(d))}
        missedWeeks={missedWeeks}
        onGoToMissedWeek={onGoToMissedWeek}
        currentYear={currentYear}
        currentMonth={currentMonth}
        activeMonth={activeMonth}
        onPickPeriod={(m) =>
          setPickedPeriodMonth(m === currentMonth ? null : m)
        }
        onDownloadReport={reportData ? onDownloadReport : undefined}
        downloading={downloading}
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

      {/* Empty states — Weekly mode only (MTD/QTD/YTD have their own
          period-scoped empty state that fits the cumulative context):
          - No entries on file at all → first-week prompt
          - Entries exist but the picked week has none → week-specific
            prompt naming the chosen week so the client knows what's
            being shown */}
      {mode === 'weekly' && !displayedEntry && (
        <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
          {entries.length === 0 ? (
            <>
              No entries yet. Go to <strong>Weekly Entry</strong> to log
              your first week.
            </>
          ) : (
            <>
              No entry saved for <strong>{formatWeekShort(selectedWeekStart)}</strong>.
              Go to <strong>Weekly Entry</strong> to add it.
            </>
          )}
        </div>
      )}

      {/* KPI grid — weekly view uses the displayed entry; cumulative
          views aggregate all in-period entries. Weekly mode pulls
          every budget-derived value from weeklyBudget so a prior-year
          entry (e.g. the Dec-side of a Dec/Jan boundary partial viewed
          in early January) colors tiles against THAT year's goals,
          not the current year's. */}
      {mode === 'weekly' && displayedEntry && (
        <KpiGrid
          client={client}
          entry={displayedEntry}
          priorEntry={priorEntry}
          monthlyGoal={entryMonthlyGoal}
          monthShares={weeklyMonthShares}
          kpiGoals={weeklyKpiGoals}
          enabledIds={enabledIds}
          annualRevenue={
            weeklyBudget?.annual_revenue != null
              ? Number(weeklyBudget.annual_revenue)
              : undefined
          }
          capacityGroupGoals={
            (weeklyBudget?.capacity_group_goals ?? {}) as Record<
              string,
              CapacityGroupGoal
            >
          }
        />
      )}

      {mode !== 'weekly' && (
        <>
          {/* QTD onboarding disclaimer — for clients who started mid-
              quarter, the pre-coaching month(s) folded into QTD are
              derived from the YTD actuals, which may have been entered
              as a single total and spread by the seasonality config.
              The picker that names the period now lives in the header
              row above (alongside the mode pills). */}
          {mode === 'qtd' &&
            ytdActualsContribution(budget, mode, currentYear, activeMonth)
              .monthsCovered.length > 0 && (
              <div className="text-xs text-black italic">
                Earlier months estimated from your YTD actuals.
              </div>
            )}
          {entriesInPeriod.length === 0 &&
          ytdActualsContribution(budget, mode, currentYear, activeMonth)
            .monthsCovered.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
              No entries for {periodLabel(mode, currentYear, activeMonth)}
              {isPastPeriod ? '.' : ' yet.'}
            </div>
          ) : (
            <CumulativeKpiGrid
              client={client}
              mode={mode}
              year={currentYear}
              month={activeMonth}
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
  selectedWeekStart,
  onPickWeek,
  missedWeeks,
  onGoToMissedWeek,
  currentYear,
  currentMonth,
  activeMonth,
  onPickPeriod,
  onDownloadReport,
  downloading,
}: {
  mode: Mode
  onMode: (m: Mode) => void
  selectedWeekStart: Date
  onPickWeek: (date: Date) => void
  missedWeeks: Date[]
  onGoToMissedWeek?: (weekStart: Date) => void
  currentYear: number
  currentMonth: number
  activeMonth: number
  onPickPeriod: (month: number) => void
  /** Click-to-download handler. Only provided when the current mode
   *  has a downloadable report. */
  onDownloadReport?: () => void
  downloading: boolean
}) {
  return (
    <div className="sticky top-[48px] z-20 bg-[#dad7c5] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 -mt-6 sm:-mt-8 space-y-3">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-lg font-bold text-ink">Performance Dashboard</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {onDownloadReport && (
            <button
              type="button"
              onClick={onDownloadReport}
              disabled={downloading}
              className="bg-ink text-white text-sm font-semibold px-3 py-1 rounded hover:brightness-110 disabled:opacity-60"
            >
              {downloading ? (
                'Preparing…'
              ) : (
                <>
                  <span className="text-accent">⬇</span> Download Report
                </>
              )}
            </button>
          )}
          <ModePills mode={mode} onMode={onMode} />
        </div>
      </div>

      {/* Pill row, mode-dependent:
          - Weekly: gray "Week of … 📅" pill + (when behind) red
            "Missed weeks (N)" dropdown
          - MTD/QTD: dark dropdown that doubles as the period label —
            picks any prior month/quarter in the current year
          - YTD: static dark year pill (prior years out of scope) */}
      <div className="flex items-center gap-2 flex-wrap text-base">
        {mode === 'weekly' && (
          <>
            <WeekOfCalendarPill
              weekStart={selectedWeekStart}
              onPick={onPickWeek}
            />
            {missedWeeks.length > 0 && (
              <MissedWeeksPill
                missedWeeks={missedWeeks}
                onPick={onGoToMissedWeek}
              />
            )}
          </>
        )}
        {(mode === 'mtd' || mode === 'qtd') && (
          <PeriodPicker
            mode={mode}
            year={currentYear}
            currentMonth={currentMonth}
            activeMonth={activeMonth}
            onPick={onPickPeriod}
          />
        )}
        {mode === 'ytd' && <YearPill year={currentYear} />}
      </div>
    </div>
  )
}

/** Prior-period selector for cumulative modes. Uses the same
 *  label-wraps-invisible-select pattern as WeekOfCalendarPill so both
 *  pill types read identically: dark pill, white text, 📅 emoji on the
 *  right of the words. The select sits absolute-positioned on top of
 *  the label so any tap opens the native dropdown.
 *  - MTD: month dropdown (January … current month)
 *  - QTD: quarter dropdown (Q1 … current quarter)
 *  - YTD / weekly: renders nothing (YTD shows a static year pill;
 *    weekly has its own week-of pill)
 *  For QTD the picked value is the first month of the quarter — the
 *  period helpers bucket it back to a quarter via quarterFromMonth.
 *  Parent maps "picked === current" back to null to resume live
 *  to-date behavior on the current period. */
function PeriodPicker({
  mode,
  year,
  currentMonth,
  activeMonth,
  onPick,
}: {
  mode: Mode
  year: number
  currentMonth: number
  activeMonth: number
  onPick: (month: number) => void
}) {
  if (mode === 'weekly' || mode === 'ytd') return null

  if (mode === 'mtd') {
    const monthName = (m: number) =>
      new Date(year, m, 1).toLocaleDateString('en-US', { month: 'long' })
    const options: number[] = []
    for (let m = 0; m <= currentMonth; m++) options.push(m)
    return (
      <PillSelect
        label={monthName(activeMonth)}
        value={activeMonth}
        onChange={onPick}
        ariaLabel="Pick a month"
        options={options.map((m) => ({ value: m, label: monthName(m) }))}
      />
    )
  }

  // QTD — quarters available up through whichever quarter today falls in.
  const currentQuarter = quarterFromMonth(currentMonth)
  const activeQuarter = quarterFromMonth(activeMonth)
  const qLabel = (q: number) => `Q${q + 1}`
  return (
    <PillSelect
      label={qLabel(activeQuarter)}
      value={activeQuarter * 3}
      onChange={onPick}
      ariaLabel="Pick a quarter"
      options={Array.from({ length: currentQuarter + 1 }, (_, q) => ({
        value: q * 3,
        label: qLabel(q),
      }))}
    />
  )
}

/** Generic dark pill with an emoji-on-the-right calendar icon, an
 *  invisible native <select> overlaid for the dropdown. Matches the
 *  WeekOfCalendarPill visual exactly so the whole header reads as one
 *  family of date controls. */
function PillSelect({
  label,
  value,
  onChange,
  ariaLabel,
  options,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  ariaLabel: string
  options: { value: number; label: string }[]
}) {
  return (
    <label className="bg-ink text-white px-3 py-1 rounded font-semibold inline-flex items-center gap-2 cursor-pointer relative">
      <span>{label}</span>
      <span aria-hidden className="text-sm">📅</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** YTD has no prior-year navigation (out of scope), so it gets a
 *  non-interactive year label styled to match the other dark pills so
 *  the cumulative header row reads consistently across modes. */
function YearPill({ year }: { year: number }) {
  return (
    <span className="bg-ink text-white px-3 py-1 rounded font-semibold">
      {year}
    </span>
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
      className={`px-3 py-1.5 rounded text-sm font-bold border ${
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
                    monthShares={monthShares}
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
      // Two-tone (see ProgressRing.computeBand): ±10% green, else red.
      const dev = Math.abs((value ?? 0) - (goal ?? 0)) / (goal ?? 1)
      return dev <= 0.1 ? 'text-good' : 'text-bad'
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
            className={`text-sm font-semibold uppercase tracking-wider ${labelText}`}
          >
            {kpi.label}
          </div>
          {kpi.desc && <InfoIcon text={kpi.desc} />}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className={`${valueText} ${resultColor}`}>
            {formatKpiValue(value, kpi.format)}
          </div>
          <div className={`text-lg mt-1 ${goalText}`}>
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
            className={`text-sm font-semibold uppercase tracking-wider whitespace-nowrap ${labelText}`}
          >
            {kpi.label}
          </div>
          {kpi.desc && <InfoIcon text={kpi.desc} />}
        </div>
        <div className="text-right self-center">
          <div className={`${valueText} ${resultColor}`}>
            {formatKpiValue(value, kpi.format)}
          </div>
          <div className={`text-lg mt-1 ${goalText}`}>
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
  monthShares,
}: {
  custom: CustomKpi
  entry: WeeklyEntry
  priorEntry: WeeklyEntry | null
  goal: number | undefined
  monthShares: number[]
}) {
  const value = (entry.kpi_values ?? {})[custom.id] ?? null
  const prior = priorEntry
    ? (priorEntry.kpi_values ?? {})[custom.id] ?? null
    : null
  const delta =
    value != null && prior != null ? Number(value) - Number(prior) : null

  // Custom KPI goals follow the same convention as standard sum/$ KPIs:
  // $/# goals are stored as ANNUAL amounts and pro-rated by month
  // share × (7 / days in month). % goals are flat rates and stay
  // as-is across periods.
  let weeklyG: number | null = null
  if (goal != null && goal !== 0) {
    if (custom.format === '%') {
      weeklyG = goal
    } else {
      const start = dateFromIso(entry.week_start_date)
      const month = start.getMonth()
      const year = start.getFullYear()
      const share = monthShares[month] ?? 1 / 12
      const frac = 7 / daysInMonth(year, month)
      weeklyG = goal * share * frac
    }
  }

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
 *  capacity group. Hi-direction (more produced hours = better) — colors
 *  red below 90% of goal, yellow 90–100%, green at-or-above goal. Not
 *  a range KPI; over-producing labor hours is unambiguously good. */
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
    range: false,
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
        <div className="text-sm font-semibold uppercase tracking-wider text-white">
          Labor Hours Produced
        </div>
        <InfoIcon text="Productive labor hours generated by this team this week." />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-xl font-bold leading-none ${valueColor}`}>
          {value != null ? `${Math.round(value)} hrs` : '—'}
        </div>
        <div className="text-base text-white mt-1">
          {goal && goal > 0 ? `Goal: ${Math.round(goal)} hrs` : 'No goal set'}
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
    <div className="bg-ink rounded-lg p-3 min-h-[110px] flex flex-col relative">
      <div className="flex items-center gap-0.5">
        <div className="text-sm font-semibold uppercase tracking-wider text-white">
          Labor Efficiency
        </div>
        <InfoIcon text="How productively the team used their scheduled time this week." />
      </div>
      {/* Value + goal centered (matches every other 2-item tile so the
          % anchors at the same vertical position). Raw "X / Y hrs"
          line is absolute-positioned at the bottom so it doesn't
          shift the centered pair. */}
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-xl font-bold leading-none ${valueColor}`}>
          {pct != null ? `${Math.round(pct)}%` : '—'}
        </div>
        <div className="text-base text-white mt-1">
          {goal && goal > 0 ? `Goal: ${goal}% (±10%)` : 'No goal set'}
        </div>
      </div>
      {pct != null && (
        <div className="absolute bottom-2 left-0 right-0 text-sm text-white text-center">
          {Math.round(produced)} / {Math.round(working)} hrs
        </div>
      )}
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

  // Big number is always the utilization PERCENT (matches the KPI's
  // single name "Utilization" and the parallel Labor Efficiency tile
  // structure). The raw method-specific value (hours / slots / dollars)
  // moves into a sub-line below the goal so the user can still see
  // what was actually entered.
  let actualPct: number | null = null
  let actualDollars: number | null = null
  let rawLine = ''

  if (group.method === 'manual') {
    const v = cv as { utilizationPct?: number } | undefined
    actualPct = v?.utilizationPct ?? group.staticUtilPct ?? null
    // Manual method has no separate raw value — the input IS the %.
  } else if (group.method === 'slots') {
    const v = cv as { slotsFilled?: number } | undefined
    const filled = v?.slotsFilled ?? 0
    actualPct = cap ? (filled / cap) * 100 : null
    rawLine = cap
      ? `${Math.round(filled)} / ${Math.round(cap)} slots`
      : `${Math.round(filled)} slots`
  } else if (group.method === 'labor') {
    const v = cv as { producedHours?: number } | undefined
    const produced = v?.producedHours ?? 0
    actualPct = cap ? (produced / cap) * 100 : null
    rawLine = cap
      ? `${Math.round(produced)} / ${Math.round(cap)} hrs`
      : `${Math.round(produced)} hrs`
  } else if (group.method === 'revenue') {
    const v = cv as { revenueProduced?: number } | undefined
    const produced = v?.revenueProduced ?? 0
    actualDollars = produced
    actualPct = cap ? (produced / cap) * 100 : null
    rawLine = cap
      ? `$${Math.round(produced).toLocaleString()} / $${Math.round(cap).toLocaleString()}`
      : `$${Math.round(produced).toLocaleString()}`
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
    rawLine = cap
      ? `${Math.round(totalWorked)} / ${Math.round(cap)} hrs`
      : `${Math.round(totalWorked)} hrs`
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
    <div className="bg-ink rounded-lg p-3 min-h-[110px] flex flex-col relative">
      <div className="flex items-center gap-0.5">
        <div className="text-sm font-semibold uppercase tracking-wider text-white">
          Utilization
        </div>
        <InfoIcon text={TEAM_CAPACITY_DESC} />
      </div>
      {/* Value + goal centered (matches every other 2-item tile so the
          % anchors at the same vertical position as e.g. Labor Hours).
          Raw line is absolute-positioned at the bottom so it doesn't
          shift the centered pair. */}
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <div className={`text-xl font-bold leading-none ${valueColor}`}>
          {actualPct != null ? `${Math.round(actualPct)}%` : '—'}
        </div>
        <div className="text-base text-white mt-1">{goalLabel}</div>
      </div>
      {rawLine && (
        <div className="absolute bottom-2 left-0 right-0 text-sm text-white text-center">
          {rawLine}
        </div>
      )}
    </div>
  )
}
