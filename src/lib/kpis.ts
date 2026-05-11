// =============================================================================
// KPI Registry — the single source of truth for every standard KPI in the portal.
// Custom KPIs (defined per-client) follow the same shape but live on the client
// record rather than here. Industry KPI defaults are stored as { [kpi.id]: 1|0 }.
//
// Reflects the rebuild planned changes from the docs:
//   - Doc 04 PC #2: efficiency moved from Team to Operations, becomes auto
//   - Doc 04 PC #6: legacy capacity fields dropped (employeeUtilization KPI removed)
//   - Doc 04 PC #9: auto-derived KPIs are first-class toggles with their own goals
//   - Doc 04 PC #11: contractsWonDollars + estimatesWonDollars split; rename
//                    revenuePerNewClient → contractValuePerNewClient (with new formula)
//   - Doc 08 PC: closeRate aggregates as `derived` instead of `avg`
// =============================================================================

export type KpiCategory =
  | 'Financials'
  | 'Marketing'
  | 'Sales'
  | 'Operations'
  | 'Team'
  | 'Overall Company'

export type KpiFormat = '#' | '$' | '%'
export type KpiAggregation = 'sum' | 'avg' | 'last' | 'derived'
export type KpiDirection = 'hi' | 'lo' // higher is better / lower is better

export type KpiDef = {
  id: string
  label: string
  desc?: string
  category: KpiCategory
  format: KpiFormat
  aggregation: KpiAggregation
  /** Direction: 'lo' = lower-is-better (color logic flips). Default 'hi'. */
  direction?: KpiDirection
  /** Always rendered regardless of toggle state. (Revenue/COGS/GP/GP%.) */
  always?: boolean
  /** Calculated, not entered. Still toggleable, still has goal field. */
  auto?: boolean
  /** Range KPI: green when within ±10% of goal (only Accounts Receivable today). */
  range?: boolean
  /** Hidden from dashboard tiles even when enabled. (COGS — entry-only.) */
  hideTile?: boolean
  /** For auto KPIs: which inputs are required. Toggling auto on auto-enables these;
   * toggling an input off cascades with confirmation. */
  dependsOn?: string[]
  /** Mutually-exclusive KPIs. Turning this one on force-turns the listed
   * ones off (no cascade-confirm — the user is intentionally swapping).
   * Used for picks like Contracts Won $ vs Estimates Won $: a coach
   * tracks one or the other depending on the client's industry. */
  excludes?: string[]
  /** Special role: when on, renders one tile per capacityGroup. */
  isCapacityFlag?: boolean
}

export const KPIS: KpiDef[] = [
  // ----- Financials -----
  {
    id: 'revenue',
    label: 'Income',
    desc: 'Total sales this week',
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    always: true,
  },
  {
    id: 'cogs',
    label: 'COGS',
    desc: 'Direct production costs',
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    always: true,
    direction: 'lo',
    hideTile: true,
  },
  {
    id: 'grossProfit',
    label: 'Gross Profit',
    desc: 'Revenue minus COGS',
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    always: true,
    auto: true,
    dependsOn: ['revenue', 'cogs'],
  },
  {
    id: 'grossMargin',
    label: 'Gross Profit Margin',
    desc: 'Gross Profit ÷ Revenue',
    category: 'Financials',
    format: '%',
    aggregation: 'derived',
    always: true,
    auto: true,
    dependsOn: ['revenue', 'cogs'],
  },
  {
    id: 'accountsReceivable',
    label: 'Accounts Receivable',
    desc: 'Target range ±10%',
    category: 'Financials',
    format: '$',
    aggregation: 'last',
    range: true,
  },

  // ----- Marketing -----
  {
    id: 'leads',
    label: 'Leads Generated',
    desc: 'New prospects this week',
    category: 'Marketing',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'newClients',
    label: 'New Clients',
    desc: 'New clients this week',
    category: 'Marketing',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'conversionRate',
    label: 'Leads Conversion Rate',
    desc: 'New Clients ÷ Leads',
    category: 'Marketing',
    format: '%',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['leads', 'newClients'],
  },

  // ----- Sales -----
  // Display order: Estimates Written $, # of Estimates Written,
  // Average Estimate Value, Estimates Won $, Contracts Won $ (parallel slot),
  // Sales Close Rate, then pipeline and transaction metrics.
  {
    id: 'proposalsDollars',
    label: 'Estimates Written ($)',
    desc: 'Total estimates written this week',
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
  },
  {
    id: 'estimatesWritten',
    label: '# of Estimates Written',
    desc: 'Number of estimates written this week',
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'avgEstimateValue',
    label: 'Average Estimate Value',
    desc: 'Estimates Written $ ÷ # of Estimates',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['proposalsDollars', 'estimatesWritten'],
  },
  {
    id: 'estimatesWonDollars',
    label: 'Estimates Won ($)',
    desc: 'Dollar value of estimates won',
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
    excludes: ['contractsWonDollars'],
  },
  {
    id: 'contractsWonDollars',
    label: 'Contracts Won ($)',
    desc: 'Dollar value of contracts won',
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
    excludes: ['estimatesWonDollars'],
  },
  {
    id: 'closeRate',
    label: 'Sales Close Rate',
    desc: 'Contracts $ ÷ Estimates Written $',
    category: 'Sales',
    format: '%',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['contractsWonDollars', 'proposalsDollars'],
  },
  {
    id: 'pipelineValue',
    label: 'Pipeline Value',
    desc: 'Open deals — total value',
    category: 'Sales',
    format: '$',
    aggregation: 'last',
  },
  {
    id: 'pipelineDeals',
    label: 'Pipeline Deals',
    desc: 'Open deals — count',
    category: 'Sales',
    format: '#',
    aggregation: 'last',
  },
  {
    id: 'avgPipelineDeal',
    label: 'Avg Deal in Pipeline',
    desc: 'Pipeline Value ÷ Pipeline Deals',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['pipelineValue', 'pipelineDeals'],
  },
  {
    id: 'transactions',
    label: '# of Transactions',
    desc: 'Total sales transactions',
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'avgTransactionValue',
    label: 'Avg Transaction Value',
    desc: 'Revenue ÷ Transactions',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['transactions'],
  },
  {
    id: 'contractValuePerNewClient',
    label: 'Contract Value per New Client',
    desc: 'Contracts Won $ ÷ New Clients',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['contractsWonDollars', 'newClients'],
  },

  // ----- Operations -----
  {
    id: 'jobsCompleted',
    label: 'Jobs Completed',
    desc: 'Jobs finished this week',
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'onTimeDelivery',
    label: 'On-Time Delivery',
    desc: 'Percent of jobs on schedule',
    category: 'Operations',
    format: '%',
    aggregation: 'avg',
  },
  {
    id: 'avgRepairOrder',
    label: 'Avg Repair Order',
    desc: 'Revenue ÷ Jobs Completed',
    category: 'Operations',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['jobsCompleted'],
  },
  {
    id: 'efficiency',
    label: 'Labor Efficiency',
    desc: 'Produced hours ÷ Working hours',
    category: 'Operations',
    format: '%',
    aggregation: 'avg',
    auto: true,
    dependsOn: ['laborHoursCompleted'],
  },
  {
    id: 'warrantyReturns',
    label: 'Warranty / Returns',
    desc: 'Returns and warranty claims',
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
    direction: 'lo',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    desc: 'Cancelled / not rescheduled',
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
    direction: 'lo',
  },

  // ----- Team -----
  {
    id: 'laborHoursCompleted',
    label: 'Labor Hours Completed',
    desc: 'Hours produced this week',
    category: 'Team',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'teamCapacity',
    label: 'Team Capacity',
    desc: 'Track utilization by employee or team — defined in Capacity Groups',
    category: 'Team',
    format: '%',
    aggregation: 'avg',
    isCapacityFlag: true,
  },
]

export const CATEGORIES: KpiCategory[] = [
  'Financials',
  'Marketing',
  'Sales',
  'Operations',
  'Team',
  'Overall Company',
]

/** KPI ids whose tiles are NOT shown on the dashboard even when enabled. */
export const HIDE_TILE_IDS = KPIS.filter((k) => k.hideTile).map((k) => k.id)

/** Lookup helper. */
export function findKpi(id: string): KpiDef | undefined {
  return KPIS.find((k) => k.id === id)
}

/**
 * KPIs eligible to appear in the Active-KPIs / Industry-defaults toggle list.
 * Excludes always-on KPIs (Revenue, COGS, GP, GP%) — those are guaranteed and
 * not shown. Auto-derived KPIs ARE included per Doc 04 PC #9.
 */
export function toggleableKpis(): KpiDef[] {
  return KPIS.filter((k) => !k.always)
}

/** Toggleable KPIs grouped by category, in the order categories should render. */
export function toggleableByCategory(): Array<{
  category: KpiCategory
  kpis: KpiDef[]
}> {
  const visible: KpiCategory[] = ['Marketing', 'Sales', 'Operations', 'Team']
  return visible
    .map((category) => ({
      category,
      kpis: toggleableKpis().filter((k) => k.category === category),
    }))
    .filter((g) => g.kpis.length > 0)
}

/** Build a kpiDefaults object with every toggleable KPI set to off (0). */
export function emptyKpiDefaults(): Record<string, number> {
  const out: Record<string, number> = {}
  toggleableKpis().forEach((k) => {
    out[k.id] = 0
  })
  return out
}

/** All auto-KPIs that depend on `inputId` (excluding always-on KPIs). */
function dependentsOf(inputId: string): KpiDef[] {
  return KPIS.filter(
    (k) => !k.always && k.auto && (k.dependsOn ?? []).includes(inputId)
  )
}

/**
 * Apply a KPI on/off toggle with the dependency-cascade rules from Doc 04 PC #9.
 *
 *   - Turning an auto-KPI ON → auto-enables any of its toggleable inputs that
 *     are currently off. Reports those input labels so the UI can say
 *     "Also enabled: X, Y."
 *   - Turning an input KPI OFF when active auto-KPIs depend on it → returns
 *     `{ requiresConfirm: true, dependents: [...] }`. Caller is expected to
 *     show a confirmation; on confirm, call this again with `confirmed: true`
 *     to actually apply the cascade.
 *   - Turning an auto-KPI OFF → just turns it off; inputs are left alone
 *     (they're real KPIs in their own right).
 *   - Turning an input ON → no cascade.
 */
export type ApplyToggleResult =
  | {
      kind: 'applied'
      defaults: Record<string, number>
      autoEnabled: string[]
      autoDisabled: string[]
    }
  | {
      kind: 'requiresConfirm'
      kpi: KpiDef
      dependents: KpiDef[]
    }

export function applyKpiToggle(
  defaults: Record<string, number>,
  kpiId: string,
  on: boolean,
  opts: { confirmed?: boolean } = {}
): ApplyToggleResult {
  const kpi = findKpi(kpiId)
  if (!kpi) {
    return {
      kind: 'applied',
      defaults,
      autoEnabled: [],
      autoDisabled: [],
    }
  }

  // ----- Turning ON -----
  if (on) {
    const next = { ...defaults, [kpiId]: 1 }
    const autoDisabled: string[] = []

    // Mutex: turn off any excluded siblings. No cascade-confirm — the user
    // is intentionally swapping (e.g. switching Contracts Won → Estimates
    // Won). Any auto-KPIs that pointed at the excluded one are kept on;
    // their formulas should fall back to the now-active alternative.
    for (const exId of kpi.excludes ?? []) {
      if (Number(next[exId]) === 1) {
        next[exId] = 0
        const ex = findKpi(exId)
        if (ex) autoDisabled.push(ex.label)
      }
    }

    const autoEnabled: string[] = []
    if (kpi.auto && kpi.dependsOn) {
      for (const depId of kpi.dependsOn) {
        const dep = findKpi(depId)
        if (!dep || dep.always) continue
        // Skip auto-enabling this dep if a mutex sibling of it is already
        // active — the alternative covers for it (e.g. closeRate's
        // dependsOn includes contractsWonDollars, but if the client is
        // already tracking estimatesWonDollars, leave that on instead).
        if (dep.excludes?.some((altId) => Number(next[altId]) === 1)) continue
        if (Number(next[depId]) !== 1) {
          next[depId] = 1
          autoEnabled.push(dep.label)
        }
      }
    }
    return { kind: 'applied', defaults: next, autoEnabled, autoDisabled }
  }

  // ----- Turning OFF -----
  // Auto-KPIs: just off, no cascade (inputs are independent KPIs).
  if (kpi.auto) {
    return {
      kind: 'applied',
      defaults: { ...defaults, [kpiId]: 0 },
      autoEnabled: [],
      autoDisabled: [],
    }
  }
  // Input KPI: check for active dependents.
  const activeDeps = dependentsOf(kpiId).filter(
    (d) => Number(defaults[d.id]) === 1
  )
  if (activeDeps.length === 0) {
    return {
      kind: 'applied',
      defaults: { ...defaults, [kpiId]: 0 },
      autoEnabled: [],
      autoDisabled: [],
    }
  }
  if (!opts.confirmed) {
    return { kind: 'requiresConfirm', kpi, dependents: activeDeps }
  }
  // Confirmed cascade
  const next = { ...defaults, [kpiId]: 0 }
  for (const d of activeDeps) next[d.id] = 0
  return {
    kind: 'applied',
    defaults: next,
    autoEnabled: [],
    autoDisabled: activeDeps.map((d) => d.label),
  }
}
