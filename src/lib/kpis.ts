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

/** Long-form glossary entry surfaced on the Resources → KPI Glossary
 *  page. Kept separate from the short `desc` (which feeds InfoIcon
 *  tooltips throughout the app) so tooltips stay terse and the glossary
 *  has room for context. Both fields are required when `glossary` is
 *  present; the Resources page renders them as two subsections. */
export type KpiGlossary = {
  /** Plain-language definition. What does this metric capture? */
  whatItMeasures: string
  /** Why the coach or client should care about this KPI / what business
   *  signal it carries. The "why this matters" beat. */
  whyItsImportant: string
}

export type KpiDef = {
  id: string
  label: string
  desc?: string
  /** Long-form glossary entry for the Resources page (optional — falls
   *  back to `desc` when not present). */
  glossary?: KpiGlossary
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
    glossary: {
      whatItMeasures:
        'The money you actually received this period. What hit your bank account, regardless of when the sale happened or when you billed for it.',
      whyItsImportant:
        "This number tells you if you're bringing enough money into the business. It's your indicator that sales and marketing are operating effectively.",
    },
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    always: true,
  },
  {
    id: 'cogs',
    label: 'COGS',
    desc: 'The direct cost of what you sold. Includes materials, direct labor, or any other cost tied directly to delivering the product or service. Doesn\'t include rent, utilities, marketing, or other overhead.',
    glossary: {
      whatItMeasures:
        "The direct cost of what you sold. Materials, direct labor, and anything else tied directly to delivering the product or service. It doesn't include rent, utilities, marketing, or other overhead.",
      whyItsImportant:
        "COGS tells you how much it cost to produce what you sold. Keeping this number in check is essential to protecting your margins. Rising COGS without rising Income means you're paying more to deliver the same work.",
    },
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
    glossary: {
      whatItMeasures:
        'The dollars left after covering the direct cost of what you sold, before paying overhead and other expenses.',
      whyItsImportant:
        'Gross Profit shows how much real money your sales are generating before overhead. This is all the money you have available in which to run your business, pay yourself and be profitable. This is your most important number.',
    },
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
    glossary: {
      whatItMeasures:
        'The percent of every dollar of income you keep after covering the direct cost of what you sold.',
      whyItsImportant:
        'Your margin percentage is a signal that your pricing and COGS are in line. If your margin is too low, you have to sell or produce more and work even harder to be profitable.',
    },
    category: 'Financials',
    format: '%',
    aggregation: 'derived',
    always: true,
    auto: true,
    dependsOn: ['revenue', 'cogs'],
  },
  {
    id: 'expenses',
    label: 'Expenses',
    desc: 'Operating expenses for the week. Everything below the cost-of-goods line: rent, utilities, payroll, marketing, software, etc. The weekly goal pro-rates the annual Expenses target by your seasonal distribution.',
    glossary: {
      whatItMeasures:
        "The cost of running your business that isn't tied directly to delivering what you sold. Things like rent, utilities, payroll, marketing, software, insurance, and other overhead.",
      whyItsImportant:
        'Expenses tell you what it costs just to keep the doors open. Loans and owner distributions are not included in your operating expenses. Divide your expenses by your gross profit dollars and multiply by 100 to see what percentage of your gross profit dollars is going towards just keeping your doors open.',
    },
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    direction: 'lo',
  },
  {
    id: 'netProfit',
    label: 'Net Profit',
    desc: 'Income minus COGS minus Expenses. The dollars left over after covering the cost of what you sold and all operating expenses.',
    glossary: {
      whatItMeasures:
        'The dollars left over after covering the cost of what you sold and all your operating expenses. This is your actual bottom line.',
      whyItsImportant:
        "This number tells you whether your operation is able to sustain itself. It does not necessarily mean that you've put cash in the bank. It does not take into account any loans the business is paying or distributions made to the owner.",
    },
    category: 'Financials',
    format: '$',
    aggregation: 'sum',
    auto: true,
    dependsOn: ['revenue', 'cogs', 'expenses'],
  },
  {
    id: 'netProfitMargin',
    label: 'Net Profit Margin',
    desc: 'Net Profit ÷ Income, shown as a percent. How much of every dollar of income you keep after all costs and expenses.',
    glossary: {
      whatItMeasures:
        'The percent of every dollar of income that ends up as profit after all costs and expenses.',
      whyItsImportant:
        "Net Profit Margin is a signal that your operation as a whole is putting enough to the bottom line. Too high and you may not be investing enough into your business or yourself. Too low and you're at risk of not having enough to build a reserve, pay loan obligations, or pay yourself reasonably.",
    },
    category: 'Financials',
    format: '%',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['revenue', 'cogs', 'expenses'],
  },
  {
    id: 'accountsReceivable',
    label: 'Accounts Receivable',
    desc: 'The total money customers currently owe you for work already done. The portal scores it as on-target when it\'s within ±10% of your goal.',
    glossary: {
      whatItMeasures:
        "The total dollar amount customers currently owe you for work you've already done but haven't been paid for yet.",
      whyItsImportant:
        "Accounts Receivable is money you've earned but haven't received yet. Too high means cash is tied up in unpaid invoices and you may need to tighten collections. Too low can be a signal that sales have slowed or jobs have gotten smaller. The goal is to keep it in a healthy range.",
    },
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
    glossary: {
      whatItMeasures:
        "The number of new prospects that came into your business this period. People who reached out, filled out a form, called, or were introduced. Anyone you can reasonably follow up with counts as a lead, whether or not they end up buying.",
      whyItsImportant:
        'Leads are the top of your funnel. This number tells you whether your marketing and referral activities are filling the funnel at the rate you need.',
    },
    category: 'Marketing',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'newClients',
    label: 'Leads Converted',
    desc: 'Number of new customers. Leads that became paying clients this week. First-time buyers, not existing customers placing repeat orders.',
    glossary: {
      whatItMeasures:
        'The number of leads that became paying customers this period.',
      whyItsImportant:
        'This number shows how effectively your sales process is turning prospects into paying clients.',
    },
    category: 'Marketing',
    format: '#',
    aggregation: 'sum',
  },
  {
    id: 'conversionRate',
    label: 'Leads Conversion Rate',
    desc: 'New Clients ÷ Leads Generated, shown as a percent. How many of the prospects who came in actually became paying customers.',
    glossary: {
      whatItMeasures:
        'The percent of incoming prospects that became paying customers.',
      whyItsImportant:
        'There\'s no real good or bad in this number. A "good" conversion rate is based on your personal data and ensures that you\'re converting enough leads at the right price to be profitable, while keeping marketing spending within budget.',
    },
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
    glossary: {
      whatItMeasures:
        'The total dollar value of all estimates you put in front of prospective customers during the period, whether or not they accepted.',
      whyItsImportant:
        "Estimates Written tells you how active your sales effort is on the front end, before any decision is made. Watching this over time shows whether you're feeding the pipeline at the rate needed to hit your goals.",
    },
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
  },
  {
    id: 'estimatesWritten',
    label: 'Estimates Written (#)',
    desc: 'Count of estimates you put out. Pair with Estimates Written ($) to see whether activity is being driven by a few big deals or many small ones.',
    glossary: {
      whatItMeasures:
        'The count of estimates you put in front of prospective customers during the period.',
      whyItsImportant:
        "This is critical to ensuring you're putting out the volume of estimates needed. You can also use it to calculate Average Estimate Value for more insights into your sales performance.",
    },
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
    // Goal is derived from Estimates Written ($) ÷ Avg Estimate Value.
    dependsOn: ['proposalsDollars', 'avgEstimateValue'],
  },
  {
    id: 'avgEstimateValue',
    label: 'Average Estimate Value',
    desc: 'The average value of all estimates written, whether sold or not.',
    glossary: {
      whatItMeasures:
        'The average dollar value of the estimates you wrote during the period.',
      whyItsImportant:
        "Average Estimate Value tells you the typical size of opportunities you're chasing. Watching this over time helps you spot whether you're moving toward bigger or smaller deals, identify whether marketing is driving the right size business to the door, and make decisions as to the capacity and skills of the team.",
    },
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    // Mutual dependency with the count side: the avg goal is direct,
    // but its actual still derives from these. Listing them keeps the
    // toggle cascade symmetric in both directions.
    dependsOn: ['proposalsDollars', 'estimatesWritten'],
  },
  {
    id: 'estimatesWonDollars',
    label: 'Estimates Won ($)',
    desc: 'Total dollar value of estimates customers agreed to.',
    glossary: {
      whatItMeasures:
        'The total dollar value of estimates customers agreed to during the period.',
      whyItsImportant:
        'Estimates Won ($) tracks how much of your sales activity is converting into actual business. Watching the dollar value of wins tells you whether your sales pipeline is producing the revenue you need to hit your goals.',
    },
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
    excludes: ['contractsWonDollars'],
  },
  {
    id: 'estimatesWonCount',
    label: 'Estimates Won (#)',
    desc: 'Count of estimates customers agreed to this week. Use alongside Estimates Won ($) to see both the dollar value and the number of wins.',
    glossary: {
      whatItMeasures:
        'The number of estimates customers agreed to during the period.',
      whyItsImportant:
        "This is critical to ensuring you're selling the volume of work needed. You can also use it to calculate Avg Estimate Won for more insights into your sales performance.",
    },
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
    excludes: ['contractsWonCount'],
    // Goal is derived from Estimates Won ($) ÷ Avg Estimate Won.
    dependsOn: ['estimatesWonDollars', 'avgEstimateWon'],
  },
  {
    id: 'avgEstimateWon',
    label: 'Avg Estimate Won',
    desc: 'The average dollar value of estimates won.',
    glossary: {
      whatItMeasures:
        'The average dollar value of estimates you won during the period.',
      whyItsImportant:
        "Stack this up against Average Estimate Value to confirm you're winning the size jobs you want to win.",
    },
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['estimatesWonDollars', 'estimatesWonCount'],
  },
  {
    id: 'contractsWonDollars',
    label: 'Contracts Won ($)',
    desc: 'Total dollar value of signed contracts.',
    glossary: {
      whatItMeasures:
        'The total dollar value of signed contracts during the period.',
      whyItsImportant:
        'Contracts Won ($) tracks how much of your sales activity is converting into formally committed business. Watching the dollar value of signed work shows whether your sales team is bringing in the revenue you need to hit your goals, and helps you anticipate the capacity, team skills, and workload required to deliver.',
    },
    category: 'Sales',
    format: '$',
    aggregation: 'sum',
    excludes: ['estimatesWonDollars'],
  },
  {
    id: 'contractsWonCount',
    label: 'Contracts Won (#)',
    desc: 'Count of signed contracts this week. Use alongside Contracts Won ($) to see both the dollar value and the number of wins.',
    glossary: {
      whatItMeasures:
        'The number of contracts signed during the period.',
      whyItsImportant:
        "This is critical to ensuring you're selling the volume of work needed. You can also use it to calculate Avg Contract Won for more insights into your sales performance.",
    },
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
    excludes: ['estimatesWonCount'],
    // Goal is derived from Contracts Won ($) ÷ Avg Contract Won.
    dependsOn: ['contractsWonDollars', 'avgContractWon'],
  },
  {
    id: 'avgContractWon',
    label: 'Avg Contract Won',
    desc: 'The average dollar value of contracts won.',
    glossary: {
      whatItMeasures:
        'The average dollar value of contracts you won during the period.',
      whyItsImportant:
        "Average Contract Won tells you the typical size of a contract you're closing. Use this to confirm you're winning the size deals you want to win, and to make decisions as to the capacity and skills of the team needed to deliver.",
    },
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['contractsWonDollars', 'contractsWonCount'],
  },
  {
    id: 'closeRate',
    label: 'Sales Close Rate',
    desc: 'The dollar value of wins divided by the dollar value of estimates you put out, shown as a percent. The share of estimate dollars that turned into actual sales.',
    glossary: {
      whatItMeasures:
        'The percent of estimate dollars you put out that turned into actual sales.',
      whyItsImportant:
        'Close Rate tells you how efficient your sales process is at turning estimates into actual business. Watching this over time shows whether your selling approach, pricing, and follow-through are working together.',
    },
    category: 'Sales',
    format: '%',
    aggregation: 'derived',
    auto: true,
    // Either mutex partner satisfies the "wins" half of the formula —
    // listing both keeps the toggle cascade aware of either path. The
    // cascade-on path uses mutex-skip to enable only the relevant
    // partner; cascade-off correctly orphans closeRate when both
    // partners are off.
    dependsOn: [
      'contractsWonDollars',
      'estimatesWonDollars',
      'proposalsDollars',
    ],
  },
  {
    id: 'pipelineValue',
    label: 'Pipeline Value',
    desc: 'Total dollar value of open deals you\'re still working on. Includes estimates that are out, conversations in progress, and anything not yet won or lost.',
    glossary: {
      whatItMeasures:
        "The total dollar value of open deals currently in your sales pipeline. Includes estimates that are out, conversations in progress, and anything not yet won or lost.",
      whyItsImportant:
        "Pipeline Value tells you how much potential revenue is in motion right now. A healthy pipeline gives you visibility into upcoming income and signals whether your sales activity is keeping pace with the work you'll need.",
    },
    category: 'Sales',
    format: '$',
    aggregation: 'last',
  },
  {
    id: 'pipelineDeals',
    label: 'Pipeline Deals (#)',
    desc: 'Count of open deals you\'re still working on. Pair with Pipeline Value to see whether you\'re chasing a few big opportunities or many small ones.',
    glossary: {
      whatItMeasures:
        'The number of open deals currently in your sales pipeline.',
      whyItsImportant:
        'This is critical to ensuring you have enough opportunities in motion to hit your sales goals. You can also use it to calculate Avg Deal in Pipeline for more insights into your sales performance.',
    },
    category: 'Sales',
    format: '#',
    aggregation: 'last',
  },
  {
    id: 'avgPipelineDeal',
    label: 'Avg Deal in Pipeline',
    desc: 'The average size of a deal sitting in your open pipeline.',
    glossary: {
      whatItMeasures:
        'The average dollar value of deals currently sitting in your sales pipeline.',
      whyItsImportant:
        "Avg Deal in Pipeline tells you the typical size of an opportunity you're working on. Watching this over time helps you spot whether your pipeline is filling with the size deals you need to hit your goals.",
    },
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['pipelineValue', 'pipelineDeals'],
  },
  {
    id: 'transactions',
    label: 'Transactions (#)',
    desc: 'Total number of completed sales. Includes closed orders, completed jobs, or rung-up purchases.',
    glossary: {
      whatItMeasures:
        'The total number of completed sales during the period. Includes closed orders, completed jobs, or rung-up purchases.',
      whyItsImportant:
        "This is critical to ensuring you're selling the volume of work needed. You can also use it to calculate Average Transaction Value for more insights into your sales performance.",
    },
    category: 'Sales',
    format: '#',
    aggregation: 'sum',
    // Goal is derived from Income ÷ Avg Transaction Value.
    dependsOn: ['avgTransactionValue'],
  },
  {
    id: 'avgTransactionValue',
    label: 'Avg Transaction Value',
    desc: 'The average size of a completed sale.',
    glossary: {
      whatItMeasures:
        'The average dollar value of a completed sale during the period.',
      whyItsImportant:
        'Average Transaction Value tells you the typical size of a sale. Watching this over time shows whether your customers are spending more or less per purchase, which can be an indicator of marketing or product performance.',
    },
    category: 'Sales',
    format: '$',
    aggregation: 'derived',
    auto: true,
    dependsOn: ['transactions'],
  },

  // ----- Operations -----
  {
    id: 'jobsCompleted',
    label: 'Jobs Completed',
    desc: 'Number of jobs completed, regardless of whether or not they\'re paid in full.',
    glossary: {
      whatItMeasures:
        "The number of jobs, projects, or work orders you completed during the period, regardless of whether or not they're paid in full.",
      whyItsImportant:
        "This is critical to ensuring you're producing the volume of work needed. You can also use it to calculate Average per Job for more insights into your operations performance.",
    },
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
    // Goal is derived from Income ÷ Average per Job.
    dependsOn: ['avgRepairOrder'],
  },
  {
    id: 'onTimeDelivery',
    label: 'On-Time Delivery',
    desc: 'The percent of jobs you finished by their committed deadline.',
    glossary: {
      whatItMeasures:
        'The percent of jobs you finished by their committed deadline.',
      whyItsImportant:
        "Keeping a high on time delivery score helps to ensure you stay within budget and protect your gross profit. If work starts to become late, it's a signal that part of your operation upstream needs your attention.",
    },
    category: 'Operations',
    format: '%',
    aggregation: 'avg',
  },
  {
    id: 'avgRepairOrder',
    label: 'Average per Job',
    desc: 'The average dollar value of a completed job.',
    glossary: {
      whatItMeasures:
        'The average dollar value of a completed job during the period.',
      whyItsImportant:
        "Average per Job tells you the typical size of work you're delivering. Use this to confirm you're completing the size jobs you want to take on, and to make decisions as to the capacity and skills of the team needed to deliver.",
    },
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
    glossary: {
      whatItMeasures:
        'The number of warranty claims, returns, or rework jobs during the period.',
      whyItsImportant:
        'Warranty / Returns tells you about the quality of your work. It can also be a signal that part of your operation needs your attention.',
    },
    category: 'Operations',
    format: '#',
    aggregation: 'sum',
    direction: 'lo',
  },
  {
    id: 'cancellations',
    label: 'Cancellations',
    desc: 'Number of jobs that were cancelled and not rescheduled.',
    glossary: {
      whatItMeasures:
        'The number of jobs that were cancelled and not rescheduled during the period.',
      whyItsImportant:
        "Cancellations show how often booked work doesn't get delivered. Watching this number helps you spot patterns in customer behavior, the sales process, or scheduling.",
    },
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
    desc: 'Tracks what share of the team\'s available weekly capacity was used.',
    glossary: {
      whatItMeasures:
        'Utilization tells you how fully your team is being used.',
      whyItsImportant:
        "Tracking utilization shows you when your team is capable of more or they're on the verge of burnout.",
    },
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

/** All KPIs that depend on `inputId` (excluding always-on KPIs).
 *  Used for the disable-cascade: if a coach turns off a KPI that
 *  others derive their goal from, those dependents are at risk of
 *  orphaning. The `auto` flag isn't part of the filter — after the
 *  avg-as-goal-input flip, some dependents (the flipped counts) are
 *  client-entered KPIs whose GOAL is derived but whose actual value
 *  isn't. */
function dependentsOf(inputId: string): KpiDef[] {
  return KPIS.filter(
    (k) => !k.always && (k.dependsOn ?? []).includes(inputId)
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
    // Cascade-on: any KPI with a dependsOn list pulls in those inputs
    // so its goal-derivation works. Not gated on `auto` because the
    // post-flip count KPIs (jobsCompleted etc.) depend on their avg /
    // $ counterparts for goal derivation but aren't auto-computed at
    // entry time.
    if (kpi.dependsOn) {
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
  // Any KPI with active dependents triggers a confirm-cascade. This
  // used to special-case `auto` KPIs to skip the cascade, but after
  // the avg-as-goal-input flip avgs and counts depend on each other
  // (avg's actual needs the count; count's goal needs the avg), so
  // turning either off may orphan the other.
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
