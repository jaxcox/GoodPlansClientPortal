import {
  CAPACITY_METHODS,
  methodMeta,
  newCapacityGroup,
  newDepartment,
  newEmployee,
  totalCapacityHours,
  totalHeadcountCapacityHours,
  totalRevenueCapacity,
  type CapacityMethodMeta,
} from '../lib/capacity'
import type {
  CapacityDepartment,
  CapacityEmployee,
  CapacityGroup,
  CapacityMethod,
} from '../lib/types'
import { NumberField } from './NumberField'

type Props = {
  groups: CapacityGroup[]
  onChange: (next: CapacityGroup[]) => void
  coachView: boolean
}

export function CapacityGroupsCard({ groups, onChange, coachView }: Props) {
  // Read-only client view ----------------------------------------------------
  if (!coachView) {
    if (groups.length === 0) {
      return (
        <div className="text-white text-xs">
          No capacity tracking set up yet.
        </div>
      )
    }
    return (
      <div className="space-y-3">
        {groups.map((g) => (
          <ReadOnlyGroup key={g.id} group={g} />
        ))}
      </div>
    )
  }

  // ----- Coach edit view ----------------------------------------------------
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
        `Remove the "${label}" group? Historical data on weekly entries for this group is preserved, but the group will no longer be tracked.`
      )
    )
      return
    onChange(groups.filter((x) => x.id !== id))
  }

  const addGroup = () => {
    // No method preselected — coach picks via the per-group dropdown
    // (project rule: every pick list defaults to "— Pick one —").
    onChange([...groups, newCapacityGroup()])
  }

  return (
    <div className="space-y-4">
      {/* Section header lives outside the cards, on the page background. */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-ink">
          Capacity &amp; Utilization Tracking
        </h2>
        <button
          type="button"
          onClick={addGroup}
          className="bg-accent text-black font-bold px-3 py-1.5 rounded text-xs hover:brightness-95 whitespace-nowrap"
        >
          + Add Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="bg-ink border border-line rounded-lg p-5 text-white text-xs text-center">
          No capacity groups yet. Click <strong>+ Add Group</strong> to start.
        </div>
      ) : (
        <div className="space-y-4">
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
    </div>
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
    <div className="bg-ink border border-line rounded-lg p-5 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:max-w-md">
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

      {group.method ? (
        <MethodBody group={group} onChange={onChange} />
      ) : (
        <div className="bg-surface-2 rounded p-3 text-white text-xs text-center">
          Pick a tracking method above to continue.
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onRemove}
          className="bg-transparent text-white border border-bad-soft text-xs font-bold px-3 py-1 rounded hover:bg-bad/10"
        >
          Remove Group
        </button>
      </div>
    </div>
  )
}

function MethodBody({
  group,
  onChange,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  switch (group.method) {
    case 'manual':
      return <ManualBody group={group} onChange={onChange} />
    case 'slots':
      return <SlotsBody group={group} onChange={onChange} />
    case 'labor':
      return (
        <EmployeesBody
          group={group}
          method="labor"
          onChange={onChange}
        />
      )
    case 'revenue':
      return (
        <EmployeesBody
          group={group}
          method="revenue"
          onChange={onChange}
        />
      )
    case 'headcount':
      return <HeadcountBody group={group} onChange={onChange} />
    default:
      return null
  }
}

// ---- Manual % --------------------------------------------------------------

function ManualBody({
  group,
  onChange,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  return (
    <FieldGroup label="Utilization">
      <div className="w-28">
        <NumberField
          value={group.staticUtilPct}
          onChange={(n) => onChange({ staticUtilPct: n })}
          format="percent"
          ariaLabel="Static utilization percent"
        />
      </div>
    </FieldGroup>
  )
}

// ---- Time Slots ------------------------------------------------------------

function SlotsBody({
  group,
  onChange,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  const value = group.slotDurationMinutes ?? 30
  return (
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
              value === m
                ? 'bg-accent text-black'
                : 'bg-transparent text-white hover:bg-white/10'
            }`}
          >
            {m} min
          </button>
        ))}
      </div>
    </FieldGroup>
  )
}

// ---- Labor Hours / Revenue (employees table) -------------------------------

function EmployeesBody({
  group,
  method,
  onChange,
}: {
  group: CapacityGroup
  method: 'labor' | 'revenue'
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  const employees = group.employees ?? []

  const updateEmployee = (id: string, patch: Partial<CapacityEmployee>) => {
    onChange({
      employees: employees.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      ),
    })
  }
  const removeEmployee = (id: string) => {
    onChange({ employees: employees.filter((e) => e.id !== id) })
  }
  const addEmployeeRow = () => {
    onChange({ employees: [...employees, newEmployee(method)] })
  }

  return (
    <div>
      <div className="flex justify-end mb-2">
        <button
          type="button"
          onClick={addEmployeeRow}
          className="bg-accent text-black font-bold px-3 py-1 rounded text-xs hover:brightness-95"
        >
          + Add
        </button>
      </div>

      {employees.length === 0 ? (
        <div className="bg-surface-2 rounded p-3 text-white text-xs text-center">
          No rows yet — click + Add to start.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div
            className={`space-y-1.5 ${
              method === 'labor' ? 'min-w-[540px]' : 'min-w-[440px]'
            }`}
          >
            <RowHeader method={method} />
            {employees.map((e) => (
              <EmployeeRow
                key={e.id}
                method={method}
                employee={e}
                onChange={(patch) => updateEmployee(e.id, patch)}
                onRemove={() => removeEmployee(e.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RowHeader({ method }: { method: 'labor' | 'revenue' }) {
  if (method === 'labor') {
    return (
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-white">
        <div>Name</div>
        <div>Role</div>
        <div>Maximum Capacity</div>
        <div>Working Hrs/Wk</div>
        <div className="w-6" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[2fr_1fr_2fr_auto] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-white">
      <div>Name</div>
      <div>Role</div>
      <div>Maximum Capacity</div>
      <div className="w-6" />
    </div>
  )
}

function EmployeeRow({
  method,
  employee,
  onChange,
  onRemove,
}: {
  method: 'labor' | 'revenue'
  employee: CapacityEmployee
  onChange: (patch: Partial<CapacityEmployee>) => void
  onRemove: () => void
}) {
  const textCell =
    'bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-2 py-2 focus:outline-none focus:border-accent'
  if (method === 'labor') {
    return (
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 items-center">
        <input
          type="text"
          value={employee.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
          className={textCell}
        />
        <input
          type="text"
          value={employee.role}
          onChange={(e) => onChange({ role: e.target.value })}
          placeholder="Role"
          className={textCell}
        />
        <NumberField
          value={employee.capacityHoursPerWeek}
          onChange={(n) => onChange({ capacityHoursPerWeek: n })}
          format="count"
          ariaLabel="Capacity hours per week"
        />
        <NumberField
          value={employee.weeklyWorkingHours}
          onChange={(n) => onChange({ weeklyWorkingHours: n })}
          format="count"
          ariaLabel="Working hours per week"
        />
        <RemoveX onClick={onRemove} />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[2fr_1fr_2fr_auto] gap-2 items-center">
      <input
        type="text"
        value={employee.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Name"
        className={textCell}
      />
      <input
        type="text"
        value={employee.role}
        onChange={(e) => onChange({ role: e.target.value })}
        placeholder="Role"
        className={textCell}
      />
      <NumberField
        value={employee.revenueCapacityPerWeek}
        onChange={(n) => onChange({ revenueCapacityPerWeek: n })}
        format="dollars"
        max={null}
        ariaLabel="Weekly dollar capacity"
      />
      <RemoveX onClick={onRemove} />
    </div>
  )
}

function RemoveX({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Remove row"
      className="text-white text-base leading-none w-6 hover:bg-bad/10 rounded"
    >
      ×
    </button>
  )
}

// ---- Headcount -------------------------------------------------------------

function HeadcountBody({
  group,
  onChange,
}: {
  group: CapacityGroup
  onChange: (patch: Partial<CapacityGroup>) => void
}) {
  const departments = group.departments ?? []

  const updateDept = (id: string, patch: Partial<CapacityDepartment>) => {
    onChange({
      departments: departments.map((d) =>
        d.id === id ? { ...d, ...patch } : d
      ),
    })
  }
  const removeDept = (id: string) => {
    onChange({ departments: departments.filter((d) => d.id !== id) })
  }
  const addDept = () => {
    onChange({ departments: [...departments, newDepartment()] })
  }

  return (
    <div className="space-y-3">
      <FieldGroup label="Hours/Week per FTE">
        <div className="w-28">
          <NumberField
            value={group.weeklyHoursPerFTE}
            onChange={(n) => onChange({ weeklyHoursPerFTE: n })}
            format="count"
            ariaLabel="Hours per week per full-time employee"
          />
        </div>
      </FieldGroup>

      <div>
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={addDept}
            className="bg-accent text-black font-bold px-3 py-1 rounded text-xs hover:brightness-95"
          >
            + Add
          </button>
        </div>

        {departments.length === 0 ? (
          <div className="bg-surface-2 rounded p-3 text-white text-xs text-center">
            No departments yet — click + Add to start.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="space-y-1.5 min-w-[440px]">
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-white">
              <div>Department</div>
              <div>Full Time #</div>
              <div>Part Time #</div>
              <div className="w-6" />
            </div>
            {departments.map((d) => (
              <div
                key={d.id}
                className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 items-center"
              >
                <input
                  type="text"
                  value={d.name}
                  onChange={(e) => updateDept(d.id, { name: e.target.value })}
                  placeholder="Department"
                  className="bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-2 py-2 focus:outline-none focus:border-accent"
                />
                <NumberField
                  value={d.fullTimeCount}
                  onChange={(n) =>
                    updateDept(d.id, { fullTimeCount: n ?? 0 })
                  }
                  format="count"
                  ariaLabel="Full-time count"
                />
                <NumberField
                  value={d.partTimeCount}
                  onChange={(n) =>
                    updateDept(d.id, { partTimeCount: n ?? 0 })
                  }
                  format="count"
                  ariaLabel="Part-time count"
                />
                <RemoveX onClick={() => removeDept(d.id)} />
              </div>
            ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Read-only display for client view
// =============================================================================

function ReadOnlyGroup({ group }: { group: CapacityGroup }) {
  const meta = methodMeta(group.method)
  const titleFallback = meta?.label ? `Untitled (${meta.label})` : 'Untitled'
  return (
    <div className="bg-surface-2 border-[0.5px] border-accent rounded p-3">
      <div className="flex justify-between items-baseline mb-1.5">
        <div className="text-white text-sm font-semibold">
          {group.name || titleFallback}
        </div>
        {meta && (
          <div className="text-xs text-white font-bold uppercase tracking-wider">
            {meta.short}
          </div>
        )}
      </div>
      {meta ? (
        <ReadOnlySummary group={group} meta={meta} />
      ) : (
        <div className="text-white text-xs italic">
          Tracking method not yet picked.
        </div>
      )}
    </div>
  )
}

function ReadOnlySummary({
  group,
  meta,
}: {
  group: CapacityGroup
  meta: CapacityMethodMeta
}) {
  if (meta.value === 'manual') {
    return (
      <div className="text-white text-xs">
        Static utilization: <strong className="text-white">{group.staticUtilPct ?? '—'}%</strong>
      </div>
    )
  }
  if (meta.value === 'slots') {
    return (
      <div className="text-white text-xs">
        Slot duration: <strong className="text-white">{group.slotDurationMinutes ?? 30} min</strong>
      </div>
    )
  }
  if (meta.value === 'labor') {
    return (
      <div className="text-white text-xs">
        {group.employees?.length ?? 0} {(group.employees?.length ?? 0) === 1 ? 'person' : 'people'} ·{' '}
        <strong className="text-white">{totalCapacityHours(group)} hrs/wk</strong>{' '}
        capacity
      </div>
    )
  }
  if (meta.value === 'revenue') {
    return (
      <div className="text-white text-xs">
        {group.employees?.length ?? 0} {(group.employees?.length ?? 0) === 1 ? 'person' : 'people'} ·{' '}
        <strong className="text-white">
          {formatDollars(totalRevenueCapacity(group))}/wk
        </strong>{' '}
        capacity
      </div>
    )
  }
  // headcount
  return (
    <div className="text-white text-xs">
      {group.departments?.length ?? 0} dept ·{' '}
      <strong className="text-white">{group.weeklyHoursPerFTE ?? 0} hrs/FTE</strong> ·{' '}
      <strong className="text-white">
        {totalHeadcountCapacityHours(group)} hrs/wk
      </strong>{' '}
      capacity
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

function formatDollars(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}
