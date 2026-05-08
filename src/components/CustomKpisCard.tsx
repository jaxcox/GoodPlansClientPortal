import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CATEGORIES } from '../lib/kpis'
import type { KpiCategory, KpiFormat, KpiDirection } from '../lib/kpis'
import type { Client, CustomKpi } from '../lib/types'
import { Toggle } from './Toggle'

type Props = {
  client: Client
  coachView: boolean
  onChange: (client: Client) => void
}

const FORMATS: { value: KpiFormat; label: string }[] = [
  { value: '#', label: 'Count' },
  { value: '$', label: 'Dollar' },
  { value: '%', label: 'Percent' },
]

function newCustomId(): string {
  const arr = new Uint32Array(2)
  crypto.getRandomValues(arr)
  return `c_${arr[0].toString(36)}${arr[1].toString(36).slice(0, 4)}`
}

export function CustomKpisCard({ client, coachView, onChange }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const list = client.custom_kpis ?? []

  // ----- Persistence helper ----------------------------------------------
  const persist = async (next: CustomKpi[]) => {
    setError(null)
    const { data, error } = await supabase
      .from('clients')
      .update({ custom_kpis: next })
      .eq('id', client.id)
      .select()
      .single()
    if (error || !data) {
      setError(error?.message ?? 'Save failed')
      return false
    }
    onChange(data as Client)
    return true
  }

  // ----- Operations ------------------------------------------------------
  const addKpi = async (k: Omit<CustomKpi, 'id' | 'active'>) => {
    const next: CustomKpi[] = [
      ...list,
      { ...k, id: newCustomId(), active: true },
    ]
    await persist(next)
  }

  const setActive = async (id: string, active: boolean) => {
    const next = list.map((k) => (k.id === id ? { ...k, active } : k))
    await persist(next)
  }

  const updateKpi = async (id: string, patch: Partial<CustomKpi>) => {
    const next = list.map((k) => (k.id === id ? { ...k, ...patch } : k))
    const ok = await persist(next)
    if (ok) setEditingId(null)
  }

  const deleteKpi = async (id: string) => {
    const k = list.find((x) => x.id === id)
    if (!k) return
    // Phase 3 has no entries data yet, so the cascade copy stays simple.
    // Doc 04 PC #16 will get the entry-count variant when Phase 5 lands.
    if (
      !confirm(
        `Delete "${k.name}"? This custom indicator has no historical data yet, but if you re-add it later, it'll be a new indicator — old values won't return.`
      )
    )
      return
    const next = list.filter((x) => x.id !== id)
    await persist(next)
  }

  // ----- Render ----------------------------------------------------------
  if (!coachView) {
    const activeList = list.filter((k) => k.active !== false)
    if (activeList.length === 0) {
      return (
        <div className="text-white text-xs">
          No custom Key Performance Indicators yet.
        </div>
      )
    }
    return (
      <div className="space-y-1">
        {activeList.map((k) => (
          <ReadOnlyRow key={k.id} kpi={k} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AddRow onAdd={addKpi} />

      {error && (
        <div className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
          {error}
        </div>
      )}

      {list.length === 0 ? (
        <div className="bg-surface-2 rounded p-3 text-white text-xs text-center">
          No custom Key Performance Indicators. Add one above.
        </div>
      ) : (
        <div className="space-y-1.5">
          {list.map((k) =>
            editingId === k.id ? (
              <EditRow
                key={k.id}
                kpi={k}
                onCancel={() => setEditingId(null)}
                onSave={(patch) => updateKpi(k.id, patch)}
              />
            ) : (
              <DisplayRow
                key={k.id}
                kpi={k}
                onEdit={() => setEditingId(k.id)}
                onDelete={() => deleteKpi(k.id)}
                onToggleActive={(on) => setActive(k.id, on)}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Add new KPI form
// =============================================================================

function AddRow({
  onAdd,
}: {
  onAdd: (k: Omit<CustomKpi, 'id' | 'active'>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<KpiCategory | ''>('')
  const [format, setFormat] = useState<KpiFormat | ''>('')
  const [direction, setDirection] = useState<KpiDirection>('hi')
  const [submitting, setSubmitting] = useState(false)

  const ready = name.trim().length > 0 && category !== '' && format !== ''

  const reset = () => {
    setName('')
    setCategory('')
    setFormat('')
    setDirection('hi')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setSubmitting(true)
    await onAdd({
      name: name.trim(),
      category: category as KpiCategory,
      format: format as KpiFormat,
      direction,
    })
    setSubmitting(false)
    reset()
  }

  return (
    <form
      onSubmit={submit}
      className="bg-surface-2 rounded p-3 space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto] gap-2 items-end">
        <FieldGroup label="Indicator Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. NPS Score"
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
        </FieldGroup>
        <FieldGroup label="Category">
          <select
            value={category}
            onChange={(e) =>
              setCategory(e.target.value as KpiCategory | '')
            }
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
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
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          >
            <option value="">— Pick one —</option>
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </FieldGroup>
        <button
          type="submit"
          disabled={submitting || !ready}
          className="bg-accent text-black font-bold px-4 py-2 rounded text-xs hover:brightness-95 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
          Direction
        </div>
        <DirectionPicker value={direction} onChange={setDirection} />
      </div>
    </form>
  )
}

// =============================================================================
// Display row (compact)
// =============================================================================

function DisplayRow({
  kpi,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  kpi: CustomKpi
  onEdit: () => void
  onDelete: () => void
  onToggleActive: (active: boolean) => void
}) {
  const active = kpi.active !== false
  return (
    <div
      className={`bg-surface-2 rounded px-3 py-2.5 flex items-center justify-between gap-3 ${
        active ? '' : 'opacity-60'
      }`}
    >
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <Toggle
          checked={active}
          onChange={onToggleActive}
          label=""
        />
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="flex-1 min-w-0 text-left flex items-center gap-3 hover:opacity-80"
        title="Click to edit"
      >
        <span className="text-white text-sm font-semibold truncate">
          {kpi.name}
        </span>
        <span className="text-white text-xs whitespace-nowrap">
          {kpi.category} · {formatLabel(kpi.format)}
        </span>
      </button>
      <span
        className={`text-xs font-bold whitespace-nowrap ${
          kpi.direction === 'hi' ? 'text-white' : 'text-white'
        }`}
      >
        {kpi.direction === 'hi' ? 'Higher Better' : 'Lower Better'}
      </span>
      <button
        type="button"
        onClick={onDelete}
        className="text-white text-base leading-none hover:bg-bad/10 px-1.5 py-0.5 rounded"
        aria-label={`Delete ${kpi.name}`}
        title={`Delete ${kpi.name}`}
      >
        ×
      </button>
    </div>
  )
}

// =============================================================================
// Edit row (inline form)
// =============================================================================

function EditRow({
  kpi,
  onCancel,
  onSave,
}: {
  kpi: CustomKpi
  onCancel: () => void
  onSave: (patch: Partial<CustomKpi>) => Promise<void>
}) {
  const [name, setName] = useState(kpi.name)
  const [category, setCategory] = useState<KpiCategory>(kpi.category)
  const [format, setFormat] = useState<KpiFormat>(kpi.format)
  const [direction, setDirection] = useState<KpiDirection>(kpi.direction)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    await onSave({
      name: name.trim(),
      category,
      format,
      direction,
    })
    setSubmitting(false)
  }

  return (
    <div className="bg-surface-2 rounded p-3 border border-accent/40 space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr] gap-2">
        <FieldGroup label="Indicator Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
        </FieldGroup>
        <FieldGroup label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as KpiCategory)}
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          >
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
            onChange={(e) => setFormat(e.target.value as KpiFormat)}
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          >
            {FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </FieldGroup>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
          Direction
        </div>
        <DirectionPicker value={direction} onChange={setDirection} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="bg-transparent text-white border border-mute px-3 py-1.5 rounded text-xs font-semibold hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !name.trim()}
          className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Read-only client view
// =============================================================================

function ReadOnlyRow({ kpi }: { kpi: CustomKpi }) {
  return (
    <div className="bg-surface-2 rounded px-3 py-2 flex items-center justify-between gap-3">
      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="text-white text-sm">{kpi.name}</span>
        <span className="text-white text-xs">
          {kpi.category} · {formatLabel(kpi.format)}
        </span>
      </div>
      <span
        className={`text-xs font-bold ${
          kpi.direction === 'hi' ? 'text-white' : 'text-white'
        }`}
      >
        {kpi.direction === 'hi' ? 'Higher Better' : 'Lower Better'}
      </span>
    </div>
  )
}

// =============================================================================
// Helpers
// =============================================================================

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
        tone="good"
        label="Higher is Better"
      />
      <DirectionPill
        active={value === 'lo'}
        onClick={() => onChange('lo')}
        tone="bad"
        label="Lower is Better"
      />
    </div>
  )
}

function DirectionPill({
  active,
  onClick,
  tone,
  label,
}: {
  active: boolean
  onClick: () => void
  tone: 'good' | 'bad'
  label: string
}) {
  const toneClasses = active
    ? tone === 'good'
      ? 'border-good bg-good/15 text-white'
      : 'border-bad-soft bg-bad/15 text-white'
    : 'border-line bg-transparent text-white hover:text-white'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 rounded text-xs font-semibold border ${toneClasses}`}
    >
      {label}
    </button>
  )
}

function formatLabel(f: KpiFormat): string {
  return f === '#' ? 'Count' : f === '$' ? 'Dollar' : 'Percent'
}
