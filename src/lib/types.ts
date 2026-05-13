import type { KpiCategory, KpiFormat, KpiDirection } from './kpis'

export type UserRole = 'super_admin' | 'coach' | 'client'

export type CustomKpi = {
  id: string
  name: string
  category: KpiCategory
  format: KpiFormat
  direction: KpiDirection
  /** When false, the KPI is hidden from dashboard tiles but its definition
   * and any historical data are preserved. Mirrors how standard KPI toggles
   * behave (Doc 04 PC #15). New custom KPIs default to true. */
  active: boolean
}

// =============================================================================
// Capacity Groups
// =============================================================================
// One client can have multiple capacity groups; each group uses ONE tracking
// method. The "By Working Hours" method from the original prototype is dropped
// per Doc 04 PC #4 — its math is covered by Labor Hours + Efficiency.

export type CapacityMethod =
  | 'manual'
  | 'slots'
  | 'labor'
  | 'revenue'
  | 'headcount'

export type CapacityEmployee = {
  id: string
  name: string
  role: string
  /** 'labor' method: target produced-hours capacity per week. */
  capacityHoursPerWeek?: number
  /** 'labor' method: actual scheduled time per week — drives Labor Efficiency
   * (produced ÷ working) per Doc 04 PC #1–#2. */
  weeklyWorkingHours?: number
  /** 'revenue' method: revenue capacity per week (in dollars). */
  revenueCapacityPerWeek?: number
}

export type CapacityDepartment = {
  id: string
  name: string
  fullTimeCount: number
  partTimeCount: number
}

/** Per-group label describing what the "By Dollars" method is actually
 *  measuring — e.g. "Estimates Written", "Sales", "Contracts Won". Free
 *  text. Only meaningful when method === 'revenue'; ignored for other
 *  methods. Optional for backward compatibility with existing data. */
export type CapacityMeasurable = string

export type CapacityGroup = {
  id: string
  name: string
  /** Optional so newly-added groups can default to "— Pick one —" until the
   * coach explicitly chooses a tracking method. */
  method?: CapacityMethod
  /** Free-text label for what's being measured — e.g. "Estimates Written",
   * "Sales", "Contracts Won", "Appointment slots." */
  measurable?: CapacityMeasurable
  /** Single weekly max capacity entered directly by the coach. Unit is
   * method-specific:
   *   - labor / headcount: hours per week
   *   - revenue: dollars per week
   *   - slots: number of slots per week
   *   - manual: not used (the entered % IS the utilization)
   * Replaces the previous per-employee / per-department tables. */
  maxCapacityPerWeek?: number
  /** Total scheduled working hours per week for the group — labor method
   * only. Drives Labor Efficiency (produced ÷ working × 100). */
  workingHoursPerWeek?: number
  /** Per-group preference: when true, the Labor Efficiency tile is
   *  hidden from the dashboard for this group even if working hours are
   *  defined. Defaults to false (shown). Labor method only. */
  hideLaborEfficiency?: boolean
  /** 'manual' method: single static utilization %. */
  staticUtilPct?: number
  /** 'slots' method: 30 or 60 minutes per slot (informational). */
  slotDurationMinutes?: 30 | 60
  /** @deprecated Legacy per-FTE hours — superseded by maxCapacityPerWeek.
   *  Kept on the type so old DB rows still parse. */
  weeklyHoursPerFTE?: number
  /** @deprecated Per-employee tracking — superseded by maxCapacityPerWeek
   *  + workingHoursPerWeek. Kept on the type so old DB rows still parse. */
  employees?: CapacityEmployee[]
  /** @deprecated Per-department tracking — superseded by maxCapacityPerWeek.
   *  Kept on the type so old DB rows still parse. */
  departments?: CapacityDepartment[]
}

export type Coach = {
  id: string
  brand_name: string
  brand_logo_url: string | null
  brand_primary_color: string | null
  brand_footer_text: string | null
  support_email: string | null
  from_email: string | null
  created_at: string
  updated_at: string
}

export type Profile = {
  id: string
  role: UserRole
  coach_id: string | null
  client_id: string | null
  display_name: string | null
  created_at: string
}

export type Client = {
  id: string
  coach_id: string
  auth_user_id: string | null
  industry_id: string | null
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  shared_folder_link: string | null
  invite_code: string | null
  invite_code_expires_at: string | null
  reset_code: string | null
  reset_code_expires_at: string | null
  activated: boolean
  archived: boolean
  /** True when a coach has set a temporary password via the coach-side
   *  Reset Password modal. ClientPortal renders a force-change-password
   *  interstitial until the client picks their own password, at which
   *  point this flips back to false. One-time use enforced at the UI
   *  level — the auth password still works for additional sign-ins, but
   *  the client can't reach any page in the portal until they change it. */
  must_change_password: boolean
  /** Per-client preference. True = send weekly entry reminder emails when
   *  a client misses the prior week. Email job not built yet (Phase 9). */
  weekly_reminder_enabled: boolean
  kpis: Record<string, number>
  custom_kpis: CustomKpi[]
  capacity_groups: CapacityGroup[]
  tracks_ytd_actuals: boolean
  dashboard_order: unknown
  coach_note: string | null
  coach_note_updated_at: string | null
  created_at: string
  updated_at: string
}

export type Industry = {
  id: string
  coach_id: string
  name: string
  kpi_defaults: Record<string, number>
  created_at: string
  updated_at: string
}

// =============================================================================
// Budgets & Goals
// =============================================================================

export type SeasonType = 'even' | 'seasonal'

export type CapacityGroupGoal = {
  /** Utilization target. ± 10% band for the dashboard tile coloring. */
  target: number
  /** '%' = utilization target, '$' = weekly dollar capacity target. */
  format: '%' | '$'
  /** Labor Hours Produced weekly target — labor method only. */
  laborHoursGoal?: number
  /** Labor Efficiency % weekly target — labor method only. */
  laborEfficiencyGoal?: number
}

export type Budget = {
  id: string
  client_id: string
  coach_id: string
  year: number
  annual_revenue: number | null
  cogs_target_pct: number | null
  /** Operating expenses (everything below the Cost of Goods line) for the year. */
  annual_expenses: number | null
  season_type: SeasonType
  /** 12 percentages summing to 100 in 'seasonal' mode; empty array in 'even'. */
  season_pct: number[]
  /** 0–11 (Jan = 0). null = no YTD actuals captured yet. */
  ytd_thru_month: number | null
  ytd_revenue_by_month: (number | null)[] | null
  ytd_cogs_by_month: (number | null)[] | null
  ytd_expenses_by_month: (number | null)[] | null
  /** Per-KPI goal value, keyed by kpi id (standard or custom). */
  goals: Record<string, number>
  /** Keyed by capacity group id. */
  capacity_group_goals: Record<string, CapacityGroupGoal>
  created_at: string
  updated_at: string
}

/** Per-capacity-group weekly actuals. Shape varies by tracking method:
 *  - manual:    { utilizationPct: number }
 *  - slots:     { slotsFilled: number, totalSlots: number }
 *  - labor:     { producedHours: number }       (working hours come from group def)
 *  - revenue:   { revenueProduced: number }
 *  - headcount: { departments: { [deptId]: { hoursWorked: number } } }
 *
 *  Stored as opaque JSON on the row; the WeeklyEntry consumer dispatches by
 *  the group's current method.
 */
export type WeeklyCapacityActual =
  | { utilizationPct: number }
  | { slotsFilled: number; totalSlots: number }
  | { producedHours: number }
  | { revenueProduced: number }
  | { departments: Record<string, { hoursWorked: number }> }

export type WeeklyEntry = {
  id: string
  client_id: string
  coach_id: string
  /** ISO date string (YYYY-MM-DD) for the Sunday of the week. */
  week_start_date: string
  /** Per-KPI actuals (input KPIs only — auto-derived KPIs are computed at
   *  read time from these). Keyed by KPI id (standard or custom). */
  kpi_values: Record<string, number>
  /** Per-capacity-group actuals, keyed by capacity group id. */
  capacity_values: Record<string, WeeklyCapacityActual>
  notes: string | null
  created_at: string
  updated_at: string
}
