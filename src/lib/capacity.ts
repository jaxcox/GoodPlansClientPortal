import type {
  CapacityGroup,
  CapacityMethod,
  CapacityEmployee,
  CapacityDepartment,
} from './types'

export type CapacityMethodMeta = {
  value: CapacityMethod
  label: string
  short: string
  description: string
  /** Where utilization data comes from each week (just a hint for the UI). */
  source:
    | 'static-config'
    | 'weekly-slots'
    | 'employee-hours'
    | 'employee-revenue'
    | 'departments-and-hours'
}

/**
 * The full set of capacity tracking methods. The "By Working Hours" method
 * from the original prototype is intentionally absent (Doc 04 PC #4) — its
 * math is now covered by Labor Hours + Efficiency.
 */
export const CAPACITY_METHODS: CapacityMethodMeta[] = [
  {
    value: 'manual',
    label: 'Manual %',
    short: 'Manual %',
    description:
      'Set a single utilization % once. The dashboard tile shows that number every week until you change it.',
    source: 'static-config',
  },
  {
    value: 'slots',
    label: 'By Time Slots',
    short: 'Time Slots',
    description:
      'Fillable slots vs available slots — e.g. healthcare appointments. 30- or 60-minute slot duration.',
    source: 'weekly-slots',
  },
  {
    value: 'labor',
    label: 'By Labor Hours',
    short: 'Labor Hours',
    description:
      'Hours produced vs employee capacity. Working Hours per employee drives Labor Efficiency.',
    source: 'employee-hours',
  },
  {
    value: 'revenue',
    label: 'By Dollars',
    short: 'Dollars',
    description:
      'Dollars produced vs dollar capacity per employee or sub-team. Use the "What\'s Being Measured" field on the group to label the dollars (Estimates Written, Sales, Contracts Won, etc.).',
    source: 'employee-revenue',
  },
  {
    value: 'headcount',
    label: 'By Headcount',
    short: 'Headcount',
    description:
      'Hours produced vs (full-time + part-time × hrs/wk). Useful when capacity scales with staffing.',
    source: 'departments-and-hours',
  },
]

export function methodMeta(
  m: CapacityMethod | undefined
): CapacityMethodMeta | null {
  if (!m) return null
  return CAPACITY_METHODS.find((x) => x.value === m) ?? null
}

// -----------------------------------------------------------------------------
// ID + factory helpers — keep ids client-side so reordering / saving doesn't
// require a server roundtrip.
// -----------------------------------------------------------------------------

function rid(prefix: string): string {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return `${prefix}_${arr[0].toString(36)}${arr[1].toString(36).slice(0, 4)}`
}

export function newCapacityGroup(method?: CapacityMethod): CapacityGroup {
  const base: CapacityGroup = {
    id: rid('cg'),
    name: '',
    method,
  }
  switch (method) {
    case 'manual':
      return { ...base, staticUtilPct: 80 }
    case 'slots':
      return { ...base, slotDurationMinutes: 30 }
    case 'labor':
      return { ...base, employees: [] }
    case 'revenue':
      return { ...base, employees: [] }
    case 'headcount':
      return { ...base, weeklyHoursPerFTE: 40, departments: [] }
    default:
      // No method picked yet — render the "Pick one" placeholder until
      // the coach chooses.
      return base
  }
}

export function newEmployee(method: CapacityMethod): CapacityEmployee {
  const e: CapacityEmployee = { id: rid('e'), name: '', role: '' }
  if (method === 'labor') {
    e.capacityHoursPerWeek = 40
    e.weeklyWorkingHours = 40
  } else if (method === 'revenue') {
    e.revenueCapacityPerWeek = 0
  }
  return e
}

export function newDepartment(): CapacityDepartment {
  return { id: rid('d'), name: '', fullTimeCount: 0, partTimeCount: 0 }
}

// -----------------------------------------------------------------------------
// Computed totals — for header summaries on each group
// -----------------------------------------------------------------------------

/** Total weekly capacity for the group, in the unit appropriate to its
 *  method. Prefers the new `maxCapacityPerWeek` field; falls back to the
 *  legacy employee / department tables for groups that haven't migrated
 *  yet. Returns 0 when neither is populated. */
export function groupMaxCapacity(g: CapacityGroup): number {
  if (g.maxCapacityPerWeek != null) return g.maxCapacityPerWeek
  // Legacy fallback by method:
  if (g.method === 'labor') {
    return (g.employees ?? []).reduce(
      (sum, e) => sum + (e.capacityHoursPerWeek ?? 0),
      0
    )
  }
  if (g.method === 'revenue') {
    return (g.employees ?? []).reduce(
      (sum, e) => sum + (e.revenueCapacityPerWeek ?? 0),
      0
    )
  }
  if (g.method === 'headcount') {
    if (!g.departments || !g.weeklyHoursPerFTE) return 0
    return g.departments.reduce(
      (sum, d) =>
        sum +
        (d.fullTimeCount + d.partTimeCount * 0.5) *
          (g.weeklyHoursPerFTE ?? 0),
      0
    )
  }
  return 0
}

/** Total scheduled working hours per week — labor method only. Prefers
 *  the new `workingHoursPerWeek` field; falls back to summing legacy
 *  per-employee `weeklyWorkingHours`. */
export function groupWorkingHours(g: CapacityGroup): number {
  if (g.workingHoursPerWeek != null) return g.workingHoursPerWeek
  if (g.method !== 'labor') return 0
  return (g.employees ?? []).reduce(
    (sum, e) => sum + (e.weeklyWorkingHours ?? 0),
    0
  )
}


