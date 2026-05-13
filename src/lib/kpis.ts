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
    desc: 'Money you actually received. What hit your bank account, regardless of when the sale happened or when you billed for it.',
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    always: true,
  },
  {
    id: 'cogs',
    label: 'COGS',
    desc: 'The direct cost of what you sold. Includes materials, direct labor, or any other cost tied directly to delivering the product or service. Doesn\'t include rent, utilities, marketing, or other overhead.',
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
    desc: 'Income minus COGS. The dollars left after covering the direct cost of what you sold, before paying overhead and other expenses.',
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
    desc: 'Gross Profit ÷ Income, shown as a percent. How much of every dollar of income you keep after covering the direct cost of what you sold.',
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
    desc: 'The total money customers currently owe you for work already done. The portal scores it as on-target when it\'s within ±10% of your goal.',
    category: 'Financials',
    format: '$',
    aggregation: 'last',
    range: true,
  },

  // ----- Marketing -----
  {
    id: 'leads',
    label: 'Leads Generated',
    desc: 'Number of new prospects that came in. People who reached out, filled a form, called, or were introduced. Counts anyone you can reasonably follow up with, even if they don\'t end up buying.',
    category: 'Marketing',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'newClients',
    label: 'New Clients',
    desc: 'Number of new customers. First-time buyers, not existing customers placing repeat orders.',
    category: 'Marketing',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'conversionRate',
    label: 'Leads Conversion Rate',
    desc: 'New Clients ÷ Leads Generated, shown as a percent. How many of the prospects who came in actually became paying customers.',
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
    desc: 'Total dollar value of estimates you put out for prospective customers, whether they accepted or not. A "shots on goal" measure of your sales pipeline.',
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
  },
  {
    id: 'estimatesWritten',
    label: '# of Estimates Written',
    desc: 'Count of estimates you put out. Pair with Estimates Written ($) to see whether activity is being driven by a few big deals or many small ones.',
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'avgEstimateValue',
    label: 'Average Estimate Value',
    desc: 'Estimates Written ($) ÷ # of Estimates Written. The typical size of an estimate you put out.',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['proposalsDollars', 'estimatesWritten'],
  },
  {
    id: 'estimatesWonDollars',
    label: 'Estimates Won ($)',
    desc: 'Total dollar value of estimates customers agreed to. Use this if your business tracks wins at the estimate stage and doesn\'t formalize with contracts.',
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
    excludes: ['contractsWonDollars'],
  },
  {
    id: 'contractsWonDollars',
    label: 'Contracts Won ($)',
    desc: 'Total dollar value of signed contracts. Use this if your business formalizes wins with contracts.',
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
    excludes: ['estimatesWonDollars'],
  },
  {
    id: 'closeRate',
    label: 'Sales Close Rate',
    desc: 'The dollar value of wins divided by the dollar value of estimates you put out, shown as a percent. The share of estimate dollars that turned into actual sales.',
    category: 'Sales',
    format: '%',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['contractsWonDollars', 'proposalsDollars'],
  },
  {
    id: 'pipelineValue',
    label: 'Pipeline Value',
    desc: 'Total dollar value of open deals you\'re still working on. Includes estimates that are out, conversations in progress, and anything not yet won or lost.',
    category: 'Sales',
    format: '$',
    aggregation: 'last',
  },
  {
    id: 'pipelineDeals',
    label: 'Pipeline Deals',
    desc: 'Count of open deals you\'re still working on. Pair with Pipeline Value to see whether you\'re chasing a few big opportunities or many small ones.',
    category: 'Sales',
    format: '#',
    aggregation: 'last',
  },
  {
    id: 'avgPipelineDeal',
    label: 'Avg Deal in Pipeline',
    desc: 'Pipeline Value ÷ Pipeline Deals. The typical size of a deal sitting in your open pipeline.',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['pipelineValue', 'pipelineDeals'],
  },
  {
    id: 'transactions',
    label: '# of Transactions',
    desc: 'Total number of completed sales. Includes closed orders, completed jobs, or rung-up purchases.',
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'avgTransactionValue',
    label: 'Avg Transaction Value',
    desc: 'Income ÷ # of Transactions. The typical size of a completed sale.',
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['transactions'],
  },
  {
    id: 'contractValuePerNewClient',
    label: 'Contract Value per New Client',
    desc: 'The dollar value of wins divided by the number of new clients. The typical first-deal size per newly-signed customer.',
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
    desc: 'Number of jobs, projects, or work orders you finished. Counts each one as it wraps up, regardless of size or duration.',
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'onTimeDelivery',
    label: 'On-Time Delivery',
    desc: 'The percent of jobs you finished by their committed deadline.',
    category: 'Operations',
    format: '%',
    aggregation: 'avg',
  },
  {
    id: 'avgRepairOrder',
    label: 'Average per Job',
    desc: 'Income ÷ Jobs Completed. The typical dollar value of a completed job.',
    category: 'Operations',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['jobsCompleted'],
  },
  {
    id: 'warrantyReturns',
    label: 'Warranty / Returns',
    desc: 'Count of warranty claims, returns, and rework jobs.',
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
    direction: 'lo',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    desc: 'Number of jobs that were cancelled and not rescheduled.',
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
    direction: 'lo',
  },

  // ----- Team -----
  // Master toggle for the capacity-and-efficiency package. When on,
  // Settings exposes the Utilization setup card and the
  // dashboard renders three tile types automatically (Capacity Utilization
  // per group, Labor Hours Produced, Labor Efficiency). When off, no
  // capacity setup is shown and the data stays stored but invisible.
  // isCapacityFlag=true keeps this KPI out of the standard tile pipeline
  // — it's a switch, not a tile.
  {
    id: 'capacityUtilization',
    label: 'Utilization',
    desc: 'Tracks what share of the team\'s available weekly capacity was used. Define teams under Settings → Utilization; the dashboard shows utilization per team against a goal.',
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
