import { CATEGORIES } from '../lib/kpis'
import type { KpiCategory, KpiFormat, KpiDirection } from '../lib/kpis'
import type { CustomKpi } from '../lib/types'
import { Toggle } from './Toggle'

// =============================================================================
// Custom KPI management — the Custom KPIs Card on Settings holds a grid of
// CustomKpiManageCard panels (one per defined custom KPI). Each panel is
// inline-editable like the Utilization GroupPanel: name input + category /
// format / direction pickers + Remove button. The list of active toggles
// lives in CustomKpisListSection (rendered inside Active KPIs).
//
// Persistence is owned by the parent (SettingsPage) — edits flow up via
// onChange, the page-level Save bar commits them to Supabase.
// =============================================================================

const FORMATS: { value: KpiFormat; label: string }[] = [
  { value: '#', label: 'Count' },
  { value: '$', label: 'Dollar' },
  { value: '%', label: 'Percent' },
]
// =============================================================================
// Custom KPIs list — rendered as a section at the bottom of Active KPIs.
// Coach view: name + active toggle. Read-only client view: name only.
// =============================================================================

/** Active-KPI list of all custom KPIs the coach has defined. Coach view:
 *  each row has an active/inactive Toggle. Read-only client view: each
 *  row shows just a ✓ + name. Belongs in the Active KPIs card alongside
 *  the standard KPI toggles. */
export function CustomKpisListSection({
  customKpis,
  onToggleActive,
  readOnly,
}: {
  customKpis: CustomKpi[]
  onToggleActive?: (id: string, active: boolean) => void
  readOnly?: boolean
}) {
  if (customKpis.length === 0) return null
  return (
    <div>
      <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
        Custom KPIs
      </div>
      <ul className="space-y-1.5">
        {customKpis.map((k) => (
          <li key={k.id} className="flex items-center gap-3">
            {readOnly ? (
              <>
                <span className="text-accent font-bold">✓</span>
                <span className="text-white text-sm">{k.name}</span>
              </>
            ) : (
              <Toggle
                checked={k.active !== false}
                onChange={(on) => onToggleActive?.(k.id, on)}
                label={k.name}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Per-KPI management card rendered inside the Custom KPIs Card on
 *  Settings → Custom KPIs. Inline-editable like the Utilization
 *  GroupPanel — coach edits name / category / format / direction
 *  directly on the card. × in the top-right deletes the KPI. */
export function CustomKpiManageCard({
  customKpi,
  onChange,
  onRemove,
}: {
  customKpi: CustomKpi
  onChange: (patch: Partial<CustomKpi>) => void
  onRemove: () => void
}) {
  return (
    <div className="relative bg-surface-1 border border-line rounded-lg p-4 space-y-3">
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${customKpi.name || 'custom KPI'}`}
        title="Remove KPI"
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-white text-base leading-none rounded hover:bg-bad/10 focus:outline-none focus:bg-bad/10"
      >
        ×
      </button>
      <FieldGroup label="Indicator Name">
        <input
          type="text"
          value={customKpi.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="e.g. NPS Score"
          className={inputCls}
        />
      </FieldGroup>
      <FieldGroup label="Category">
        <select
          value={customKpi.category || ''}
          onChange={(e) =>
            onChange({ category: e.target.value as KpiCategory })
          }
          className={`select-yellow ${inputCls}`}
        >
          <option value="" disabled>
            — Pick one —
          </option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </FieldGroup>
      <FieldGroup label="Format">
        <select
          value={customKpi.format || ''}
          onChange={(e) => onChange({ format: e.target.value as KpiFormat })}
          className={`select-yellow ${inputCls}`}
        >
          <option value="" disabled>
            — Pick one —
          </option>
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </FieldGroup>
      <FieldGroup label="Direction">
        <DirectionPicker
          value={customKpi.direction}
          onChange={(d) => onChange({ direction: d })}
        />
      </FieldGroup>
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

const inputCls =
  'w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent'

function FieldGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </div>
      {children}
    </div>
  )
}

function DirectionPicker({
  value,
  onChange,
}: {
  value: KpiDirection
  onChange: (d: KpiDirection) => void
}) {
  return (
    <div className="flex gap-2">
      <DirectionPill
        active={value === 'hi'}
        onClick={() => onChange('hi')}
        label="Higher Better"
      />
      <DirectionPill
        active={value === 'lo'}
        onClick={() => onChange('lo')}
        label="Lower Better"
      />
    </div>
  )
}

function DirectionPill({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  // Selected: thick yellow→green fill. Unselected: 0.5px yellow outline
  // matching the auto-populated derived boxes elsewhere on the page.
  // Fixed h-8 + box-border keeps both pills the same height despite the
  // border-thickness difference.
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 h-8 flex items-center justify-center rounded text-xs font-bold box-border ${
        active
          ? 'bg-good text-black border-2 border-good'
          : 'bg-transparent text-white border-[0.5px] border-accent hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  )
}

export function newCustomKpiId(): string {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return `c_${arr[0].toString(36)}${arr[1].toString(36).slice(0, 4)}`
}

/** Empty custom KPI with a fresh id. Category / format start unset so the
 *  coach has to pick them; direction defaults to "Higher is better". */
export function newCustomKpi(): CustomKpi {
  return {
    id: newCustomKpiId(),
    name: '',
    // intentionally typed past "" — the select renders "— Pick one —" until
    // the coach chooses one. Save-time validation catches unset values.
    category: '' as KpiCategory,
    format: '' as KpiFormat,
    direction: 'hi',
    active: true,
  }
}
