import { CATEGORIES, KPIS, findKpi } from '../lib/kpis'
import type { KpiCategory, KpiFormat } from '../lib/kpis'
import type { Client } from '../lib/types'
import { NumberField } from './NumberField'

// Sum/$ KPI goals are stored as ANNUAL amounts and pro-rated by the dashboard
// using the same season_pct distribution that drives monthly income targets.
// Symmetric with the Income Target (also annual).

type Props = {
  client: Client
  goals: Record<string, number>
  /** Annual income target — needed to derive goals for KPIs whose formula
   *  uses revenue (e.g. Avg Transaction Value, Avg Repair Order). */
  annualRevenue: number | undefined
  onChange: (next: Record<string, number>) => void
}

type Row = {
  id: string
  label: string
  format: KpiFormat
  derived: boolean
}

const numberFieldFormat: Record<KpiFormat, 'dollars' | 'percent' | 'count'> =
  {
    $: 'dollars',
    '%': 'percent',
    '#': 'count',
  }

/** KPIs whose goal can be auto-derived from other KPI goals (or annual
 *  revenue). Marking a KPI here makes its row render as a derived box on
 *  Budget & Goals → KPI Goals; everything else gets a fillable NumberField.
 *
 *  Note: `efficiency` (Labor Efficiency) is `auto` in the KPI registry but
 *  is NOT in this set — its formula (produced ÷ working hours) can't be
 *  computed from other KPI goals, so the coach types a target percent
 *  manually. */
const DERIVABLE_GOAL_IDS = new Set<string>([
  'conversionRate', // newClients / leads
  'avgEstimateValue', // proposalsDollars / estimatesWritten
  'avgPipelineDeal', // pipelineValue / pipelineDeals
  'closeRate', // contractsWonDollars / proposalsDollars
  'avgTransactionValue', // annualRevenue / transactions
  'avgRepairOrder', // annualRevenue / jobsCompleted
  'contractValuePerNewClient', // contractsWonDollars / newClients
])

/** Percent KPIs whose goal can legitimately exceed 100% (so the input
 *  shouldn't clamp at 100). Currently just Labor Efficiency, where
 *  produced ÷ working hours can be > 100% during overtime weeks. */
const PERCENT_GOAL_NO_MAX = new Set<string>(['efficiency'])

function safeDivide(
  num: number | undefined,
  den: number | undefined
): number | null {
  if (!num || !den) return null
  return num / den
}

/** Pick whichever of `contractsWonDollars` / `estimatesWonDollars` is the
 *  currently-active won-dollars KPI for this client, and return its goal.
 *  Goals for the inactive sibling are ignored so stale values from a
 *  previous toggle state don't leak into derived calculations. */
function wonDollarsGoal(
  goals: Record<string, number>,
  visibleStandardIds: Set<string>
): number | undefined {
  if (visibleStandardIds.has('contractsWonDollars'))
    return goals['contractsWonDollars']
  if (visibleStandardIds.has('estimatesWonDollars'))
    return goals['estimatesWonDollars']
  return undefined
}

function deriveGoal(
  kpiId: string,
  goals: Record<string, number>,
  annualRevenue: number | undefined,
  visibleStandardIds: Set<string>
): number | null {
  const g = (id: string) => goals[id]
  switch (kpiId) {
    case 'conversionRate': {
      const r = safeDivide(g('newClients'), g('leads'))
      return r === null ? null : r * 100
    }
    case 'avgEstimateValue':
      return safeDivide(g('proposalsDollars'), g('estimatesWritten'))
    case 'avgPipelineDeal':
      return safeDivide(g('pipelineValue'), g('pipelineDeals'))
    case 'closeRate': {
      const r = safeDivide(
        wonDollarsGoal(goals, visibleStandardIds),
        g('proposalsDollars')
      )
      return r === null ? null : r * 100
    }
    case 'avgTransactionValue':
      return safeDivide(annualRevenue, g('transactions'))
    case 'avgRepairOrder':
      return safeDivide(annualRevenue, g('jobsCompleted'))
    case 'contractValuePerNewClient':
      return safeDivide(
        wonDollarsGoal(goals, visibleStandardIds),
        g('newClients')
      )
    default:
      return null
  }
}

function formatDerived(value: number | null, format: KpiFormat): string {
  if (value === null) return '—'
  if (format === '$')
    return `$${Math.round(value).toLocaleString('en-US')}`
  if (format === '%') return `${value.toFixed(1)}%`
  return Math.round(value).toLocaleString('en-US')
}

export function KpiGoalsCard({
  client,
  goals,
  annualRevenue,
  onChange,
}: Props) {
  // Build the visible KPI set: explicitly-toggled standard KPIs PLUS any
  // dependencies of toggled-on derived KPIs (so the inputs that drive a
  // derived goal are always reachable even if the dependency isn't itself
  // toggled on in Settings — otherwise the derived box would just read '—'
  // forever with no way to fill the inputs).
  const visibleStandardIds = new Set<string>()
  for (const k of KPIS) {
    if (k.always) continue
    if (Number(client.kpis[k.id]) === 1) visibleStandardIds.add(k.id)
  }
  // Pull in dependencies of any visible derived KPI. If a dependency has
  // a mutex sibling that's already active (e.g. closeRate.dependsOn
  // includes contractsWonDollars, but the client tracks estimatesWonDollars
  // instead), skip pulling it in — the alternative covers for it.
  const ensureDeps = (id: string) => {
    const k = findKpi(id)
    if (!k?.dependsOn) return
    for (const depId of k.dependsOn) {
      const dep = findKpi(depId)
      if (!dep || dep.always) continue
      if (dep.excludes?.some((altId) => visibleStandardIds.has(altId)))
        continue
      if (!visibleStandardIds.has(depId)) {
        visibleStandardIds.add(depId)
        ensureDeps(depId)
      }
    }
  }
  for (const id of [...visibleStandardIds]) ensureDeps(id)

  // Group by category, in the order categories should render
  const grouped: Map<KpiCategory, Row[]> = new Map()
  const standardByCategory: Map<KpiCategory, Row[]> = new Map()
  for (const k of KPIS) {
    if (k.always) continue
    if (!visibleStandardIds.has(k.id)) continue
    const list = standardByCategory.get(k.category) ?? []
    list.push({
      id: k.id,
      label: k.label,
      format: k.format,
      derived: DERIVABLE_GOAL_IDS.has(k.id),
    })
    standardByCategory.set(k.category, list)
  }
  for (const c of client.custom_kpis ?? []) {
    if (c.active === false) continue
    const list = grouped.get(c.category) ?? []
    list.push({
      id: c.id,
      label: c.name,
      format: c.format,
      derived: false,
    })
    grouped.set(c.category, list)
  }
  // Merge: standard first, then custom, per category
  for (const cat of CATEGORIES) {
    const std = standardByCategory.get(cat) ?? []
    const custom = grouped.get(cat) ?? []
    if (std.length || custom.length) grouped.set(cat, [...std, ...custom])
    else grouped.delete(cat)
  }

  const totalRows = Array.from(grouped.values()).reduce(
    (n, list) => n + list.length,
    0
  )

  if (totalRows === 0) {
    return (
      <div className="text-white text-xs leading-relaxed">
        No active KPIs to enter. Toggle some on under{' '}
        <strong className="text-white">Settings → Active KPIs</strong>, then
        come back here to set their targets.
      </div>
    )
  }

  const setGoal = (id: string, n: number | undefined) => {
    const next = { ...goals }
    if (n === undefined) delete next[id]
    else next[id] = n
    onChange(next)
  }

  return (
    <div className="space-y-5">
      {CATEGORIES.map((cat) => {
        const rows = grouped.get(cat)
        if (!rows || rows.length === 0) return null
        return (
          <div key={cat}>
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
              {cat}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col h-full justify-end"
                >
                  <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
                    {row.label}
                  </div>
                  {row.derived ? (
                    <DerivedKpiBox
                      value={formatDerived(
                        deriveGoal(
                          row.id,
                          goals,
                          annualRevenue,
                          visibleStandardIds
                        ),
                        row.format
                      )}
                    />
                  ) : (
                    <NumberField
                      value={goals[row.id]}
                      onChange={(n) => setGoal(row.id, n)}
                      format={numberFieldFormat[row.format]}
                      max={
                        row.format === '%'
                          ? PERCENT_GOAL_NO_MAX.has(row.id)
                            ? null
                            : 100
                          : null
                      }
                      ariaLabel={`Goal for ${row.label}`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Read-only display for auto-derived KPI goals. Same dark surface +
 *  0.5px yellow line as the DerivedBox in BudgetGoalsPage so the visual
 *  treatment for "auto-populated" cells is consistent across the page. */
function DerivedKpiBox({ value }: { value: string }) {
  return (
    <div className="w-full bg-surface-2 border-[0.5px] border-accent rounded text-white text-sm px-3 py-2 min-h-[40px] flex items-center">
      {value}
    </div>
  )
}
