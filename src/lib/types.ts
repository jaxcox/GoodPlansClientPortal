export type UserRole = 'super_admin' | 'coach' | 'client'

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
  custom_kpis: unknown[]
  capacity_groups: unknown[]
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
