import { useEffect, useState } from 'react'
import { CATEGORIES } from '../lib/kpis'
import type { KpiCategory, KpiFormat, KpiDirection } from '../lib/kpis'
import type { CustomKpi } from '../lib/types'
import { Toggle } from './Toggle'

// =============================================================================
// Custom KPI Creator — single form that adds or edits one custom KPI.
//
// In the new layout, the *list* of existing custom KPIs lives at the bottom
// of the Active KPIs card (rendered by CustomKpisListSection below). This
// component is just the form. It supports two modes:
//   - editing === null  → add mode (button reads "Add", form clears on submit)
//   - editing !== null  → edit mode (button reads "Save", Cancel button shown)
// Persistence is owned by the parent (SettingsPage) so add/edit/delete share
// one supabase call site.
// =============================================================================

const FORMATS: { value: KpiFormat; label: string }[] = [
  { value: '#', label: 'Count' },
  { value: '$', label: 'Dollar' },
  { value: '%', label: 'Percent' },
]

export type CustomKpiFormValues = {
  name: string
  category: KpiCategory
  format: KpiFormat
  direction: KpiDirection
}

type FormProps = {
  editing: CustomKpi | null
  onSubmit: (values: CustomKpiFormValues) => Promise<void>
  onCancel: () => void
}

export function CustomKpiForm({ editing, onSubmit, onCancel }: FormProps) {
  const [name, setName] = useState(editing?.name ?? '')
  const [category, setCategory] = useState<KpiCategory | ''>(
    editing?.category ?? ''
  )
  const [format, setFormat] = useState<KpiFormat | ''>(editing?.format ?? '')
  const [direction, setDirection] = useState<KpiDirection>(
    editing?.direction ?? 'hi'
  )
  const [submitting, setSubmitting] = useState(false)

  // Re-seed when the parent switches between add and edit (or between two
  // different KPIs being edited).
  useEffect(() => {
    setName(editing?.name ?? '')
    setCategory(editing?.category ?? '')
    setFormat(editing?.format ?? '')
    setDirection(editing?.direction ?? 'hi')
  }, [editing?.id])

  const ready = name.trim().length > 0 && category !== '' && format !== ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setSubmitting(true)
    await onSubmit({
      name: name.trim(),
      category: category as KpiCategory,
      format: format as KpiFormat,
      direction,
    })
    setSubmitting(false)
    if (!editing) {
      setName('')
      setCategory('')
      setFormat('')
      setDirection('hi')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FieldGroup label="Indicator Name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. NPS Score"
          className={inputCls}
        />
      </FieldGroup>
      <FieldGroup label="Category">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as KpiCategory | '')}
          className={`select-yellow ${inputCls}`}
        >
          <option value="">— Pick one —</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </FieldGroup>
      <FieldGroup label="Format">
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as KpiFormat | '')}
          className={`select-yellow ${inputCls}`}
        >
          <option value="">— Pick one —</option>
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </FieldGroup>
      <FieldGroup label="Direction">
        <DirectionPicker value={direction} onChange={setDirection} />
      </FieldGroup>
      <div className="flex justify-end gap-2 pt-1">
        {editing && (
          <button
            type="button"
            onClick={onCancel}
            className="bg-transparent text-white border border-mute px-3 py-1.5 rounded text-xs font-semibold hover:bg-white/10"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={submitting || !ready}
          className="bg-accent text-black font-bold px-4 py-2 rounded text-xs hover:brightness-95 disabled:opacity-50"
        >
          {submitting
            ? editing
              ? 'Saving…'
              : 'Adding…'
            : editing
              ? 'Save'
              : 'Add'}
        </button>
      </div>
    </form>
  )
}

// =============================================================================
// Custom KPIs list — rendered as a section at the bottom of Active KPIs.
// Coach view: name + edit + ×. Read-only client view: name only.
// =============================================================================

export function CustomKpisListSection({
  customKpis,
  editingId,
  onEdit,
  onDelete,
  onToggleActive,
  readOnly,
}: {
  customKpis: CustomKpi[]
  editingId?: string | null
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
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
        {customKpis.map((k) => {
          const active = k.active !== false
          return (
            <li
              key={k.id}
              className={`flex items-center gap-3 ${
                editingId === k.id ? 'bg-accent/10 rounded px-2 py-0.5' : ''
              }`}
            >
              {readOnly ? (
                <span className="text-white text-xs">{k.name}</span>
              ) : (
                <>
                  <Toggle
                    checked={active}
                    onChange={(on) => onToggleActive?.(k.id, on)}
                    label={k.name}
                  />
                  <button
                    type="button"
                    onClick={() => onEdit?.(k.id)}
                    className="text-white text-xs underline hover:opacity-80"
                  >
                    edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete?.(k.id)}
                    className="text-white text-base leading-none hover:bg-bad/10 px-1 rounded"
                    aria-label={`Delete ${k.name}`}
                    title={`Delete ${k.name}`}
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
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
