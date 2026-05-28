import {
  CAPACITY_METHODS,
  methodMeta,
  newCapacityGroup,
} from '../lib/capacity'
import type {
  CapacityGroup,
  CapacityMethod,
} from '../lib/types'
import { NumberField } from './NumberField'
import { Toggle } from './Toggle'
import { UTILIZATION_DESC } from './WeeklyDashboard'
import { Card } from './Card'

type Props = {
  groups: CapacityGroup[]
  onChange: (next: CapacityGroup[]) => void
}

export function CapacityGroupsCard({
  groups,
  onChange,
}: Props) {
  /** Replace one field on one group. */
  const updateGroup = (id: string, patch: Partial<CapacityGroup>) => {
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)))
  }

  /** Switching a group's tracking method clears method-specific fields and
   * seeds fresh defaults for the new method (preserving the name + id). */
  const changeMethod = (id: string, nextMethod: CapacityMethod) => {
    onChange(
      groups.map((g) => {
        if (g.id !== id) return g
        const fresh = newCapacityGroup(nextMethod)
        return { ...fresh, id: g.id, name: g.name }
      })
    )
  }

  const removeGroup = (id: string) => {
    const g = groups.find((x) => x.id === id)
    if (!g) return
    const label = g.name || methodMeta(g.method)?.label || 'this'
    if (
      !confirm(
        `Remove the "${label}" group? Historical data on weekly entries for this group is preserved, but the group will no longer be tracked. Its goal in Budget & Goals will also need to be cleaned up.`
      )
    )
      return
    onChange(groups.filter((x) => x.id !== id))
  }

  const addGroup = () => {
    // New groups land at the top of the list so the just-added card is
    // immediately visible without scrolling past existing ones.
    // No method preselected — coach picks via the per-group dropdown
    // (project rule: every pick list defaults to "— Pick one —").
    onChange([newCapacityGroup(), ...groups])
  }

  return (
    <Card title="Utilization" info={UTILIZATION_DESC} id="settings:utilization" fit>
      {/* Top + Add Group button hides when empty — the empty state
          below carries the primary action so users don't have to hunt
          for it. */}
      {groups.length > 0 && (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={addGroup}
            className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95 whitespace-nowrap"
          >
            + Add Group
          </button>
        </div>
      )}

      {groups.length === 0 ? (
        <div className="bg-ink border border-dashed border-line rounded p-8 text-center">
          <div className="text-white font-bold text-sm mb-1">
            No capacity groups yet
          </div>
          <div className="text-white text-xs">
            Add one to start tracking team capacity and utilization.
          </div>
          <button
            type="button"
            onClick={addGroup}
            className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95 mt-4 whitespace-nowrap"
          >
            + Add Group
          </button>
        </div>
      ) : (
        <div
          className={`grid gap-4 items-start ${
            groups.length === 1 ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'
          }`}
        >
          {groups.map((g) => (
            <GroupPanel
              key={g.id}
              group={g}
              onChange={(patch) => updateGroup(g.id, patch)}
              onMethodChange={(m) => changeMethod(g.id, m)}
              onRemove={() => removeGroup(g.id)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

// =============================================================================
// One capacity group, in edit mode
// =============================================================================

function GroupPanel({
  group,
  onChange,
  onMethodChange,
  onRemove,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
  onMethodChange: (m: CapacityMethod) => void
  onRemove: () => void
}) {
  return (
    <div className="relative bg-surface-1 border border-line rounded-lg p-4 space-y-4">
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove group"
        title="Remove group"
        className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center text-white text-base leading-none rounded hover:bg-bad/10 focus:outline-none focus:bg-bad/10"
      >
        ×
      </button>
      <div className="space-y-3">
        <FieldGroup label="Department / Team Name">
          <input
            type="text"
            value={group.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Production Crew"
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
        </FieldGroup>
        <FieldGroup label="Tracking Method">
          <select
            value={group.method ?? ''}
            onChange={(e) => onMethodChange(e.target.value as CapacityMethod)}
            className="select-yellow w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          >
            <option value="" disabled>
              — Pick one —
            </option>
            {CAPACITY_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </FieldGroup>
      </div>

      {group.method && (
        <div className="sm:max-w-md">
          <FieldGroup label="What's Being Measured">
            <input
              type="text"
              value={group.measurable ?? ''}
              onChange={(e) => onChange({ measurable: e.target.value })}
              placeholder="e.g. Estimates Written, Production Hours, Appointments"
              className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
            />
          </FieldGroup>
        </div>
      )}

      {!group.method ? (
        <div className="bg-surface-2 rounded p-3 text-white text-xs text-center">
          Pick a tracking method above to continue.
        </div>
      ) : group.method === 'manual' ? (
        <ManualConfig group={group} onChange={onChange} />
      ) : (
        <CapacityFields group={group} onChange={onChange} />
      )}

      {/* Extras: only Labor Hours method produces dashboard tiles beyond
          the implicit Capacity Utilization, so this only renders for
          labor. Sits at the bottom so coaches see what they're getting
          after configuring the group. Labor Efficiency is opt-out via
          the toggle. */}
      {group.method === 'labor' && (
        <ExtrasList
          showEfficiency={!group.hideLaborEfficiency}
          onChangeShowEfficiency={(show) =>
            onChange({ hideLaborEfficiency: !show })
          }
        />
      )}

    </div>
  )
}

/** "Extras" panel — only shown for labor-method groups. Labor Efficiency
 *  is the unique derived metric the method unlocks; it's surfaced as a
 *  toggle so coaches can hide it per-group when they don't want to track
 *  it. Capacity Utilization and per-week hours produced stay implicit. */
function ExtrasList({
  showEfficiency,
  onChangeShowEfficiency,
}: {
  showEfficiency: boolean
  onChangeShowEfficiency: (show: boolean) => void
}) {
  return (
    <div className="bg-surface-2 rounded p-3 sm:max-w-md">
      <div className="text-xs font-semibold uppercase tracking-wider text-white mb-2">
        Extras
      </div>
      <Toggle
        label="Labor Efficiency"
        checked={showEfficiency}
        onChange={onChangeShowEfficiency}
      />
    </div>
  )
}

/** Per-method input unit + NumberField format. */
const METHOD_FIELDS: Record<
  Exclude<CapacityMethod, 'manual'>,
  { unit: string; format: 'count' | 'dollars' | 'percent' }
> = {
  slots: { unit: 'slots', format: 'count' },
  labor: { unit: 'hrs', format: 'count' },
  revenue: { unit: '$', format: 'dollars' },
  headcount: { unit: 'hrs', format: 'count' },
}

/** Legacy compute: pre-fills the new Max Capacity input from old
 *  per-employee / per-department data so groups created before the
 *  simplification still show the correct number on first load. */
function legacyMaxCapacity(g: CapacityGroup): number {
  if (g.method === 'labor') {
    return (g.employees ?? []).reduce(
      (s, e) => s + (e.capacityHoursPerWeek ?? 0),
      0
    )
  }
  if (g.method === 'revenue') {
    return (g.employees ?? []).reduce(
      (s, e) => s + (e.revenueCapacityPerWeek ?? 0),
      0
    )
  }
  if (g.method === 'headcount' && g.weeklyHoursPerFTE) {
    return (g.departments ?? []).reduce(
      (s, d) =>
        s +
        (d.fullTimeCount + d.partTimeCount * 0.5) *
          (g.weeklyHoursPerFTE ?? 0),
      0
    )
  }
  return 0
}

function legacyWorkingHours(g: CapacityGroup): number {
  if (g.method !== 'labor') return 0
  return (g.employees ?? []).reduce(
    (s, e) => s + (e.weeklyWorkingHours ?? 0),
    0
  )
}

/** Method-specific config rendered on every non-manual group card:
 *  Max Capacity + (labor only) Working Hours. Slots also keeps the
 *  30/60 min duration picker as an informational tag. */
function CapacityFields({
  group,
  onChange,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  if (group.method === 'manual' || !group.method) return null
  const meta = METHOD_FIELDS[group.method]
  const maxValue =
    group.maxCapacityPerWeek != null
      ? group.maxCapacityPerWeek
      : legacyMaxCapacity(group) || undefined
  const workingValue =
    group.workingHoursPerWeek != null
      ? group.workingHoursPerWeek
      : legacyWorkingHours(group) || undefined
  return (
    <div className="space-y-3 sm:max-w-md">
      {group.method === 'slots' && (
        <FieldGroup label="Slot Duration">
          <div className="inline-flex border border-line rounded overflow-hidden">
            {[30, 60].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() =>
                  onChange({ slotDurationMinutes: m as 30 | 60 })
                }
                className={`px-4 py-1.5 text-xs font-semibold ${
                  (group.slotDurationMinutes ?? 30) === m
                    ? 'bg-accent text-black'
                    : 'bg-transparent text-white hover:bg-white/10'
                }`}
              >
                {m} min
              </button>
            ))}
          </div>
        </FieldGroup>
      )}
      <FieldGroup label={`Max Capacity (${meta.unit} / week)`}>
        <NumberField
          value={maxValue}
          onChange={(n) => onChange({ maxCapacityPerWeek: n })}
          format={meta.format}
          ariaLabel="Max capacity per week"
        />
      </FieldGroup>
      {group.method === 'labor' && (
        <FieldGroup label="Working Hours / week">
          <NumberField
            value={workingValue}
            onChange={(n) => onChange({ workingHoursPerWeek: n })}
            format="count"
            ariaLabel="Working hours per week"
          />
        </FieldGroup>
      )}
    </div>
  )
}

/** Manual method: one static utilization % stored in Settings, no weekly
 *  entry input. The dashboard tile displays this value every week. */
function ManualConfig({
  group,
  onChange,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  return (
    <div className="sm:max-w-md">
      <FieldGroup label="Static Utilization %">
        <NumberField
          value={group.staticUtilPct}
          onChange={(n) => onChange({ staticUtilPct: n })}
          format="percent"
          ariaLabel="Static utilization percent"
        />
      </FieldGroup>
    </div>
  )
}


// =============================================================================
// Read-only display for client view
// =============================================================================

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

