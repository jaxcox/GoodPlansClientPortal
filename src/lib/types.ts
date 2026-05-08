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

export type CapacityGroup = {
  id: string
  name: string
  method: CapacityMethod
  /** 'manual' method: single static utilization % stored once in Settings
   * (Doc 04 PC #3 — no longer a weekly entry input). */
  staticUtilPct?: number
  /** 'slots' method: 30 or 60 minutes per slot. */
  slotDurationMinutes?: 30 | 60
  /** 'headcount' method: hours/week per FTE. */
  weeklyHoursPerFTE?: number
  /** 'labor' or 'revenue' methods. */
  employees?: CapacityEmployee[]
  /** 'headcount' method. */
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
  shared_folder_link: string | null
  invite_code: string | null
  invite_code_expires_at: string | null
  reset_code: string | null
  reset_code_expires_at: string | null
  activated: boolean
  archived: boolean
  kpis: Record<string, number>
  custom_kpis: CustomKpi[]
  capacity_groups: CapacityGroup[]
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
