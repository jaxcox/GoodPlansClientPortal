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
        <div className="text-mute text-xs">
          Your coach hasn't set up capacity tracking for this portal yet.
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
    if (
      !confirm(
        `Remove the "${g.name || methodMeta(g.method).label}" group? Historical data on weekly entries for this group is preserved, but the group will no longer be tracked.`
      )
    )
      return
    onChange(groups.filter((x) => x.id !== id))
  }

  const addGroup = () => {
    // Default to Labor Hours — the most common method. Coach can switch via
    // the per-group method dropdown.
    onChange([...groups, newCapacityGroup('labor')])
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-start gap-3">
        <p className="text-[11px] text-mute leading-relaxed">
          Define teams or departments and how to track their utilization. Goals
          for each capacity group are set in{' '}
          <strong>Budget &amp; Goals</strong>.
        </p>
        <button
          type="button"
          onClick={addGroup}
          className="bg-accent text-black font-bold px-3 py-1.5 rounded text-[11px] hover:brightness-95 whitespace-nowrap shrink-0"
        >
          + Add Group
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="bg-surface-2 rounded p-4 text-mute text-xs text-center">
          No capacity groups yet. Click <strong>+ Add Group</strong> to start.
        </div>
      ) : (
        <div className="space-y-2">
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
  const meta = methodMeta(group.method)
  return (
    <div className="bg-[#0f0f0f] border border-accent/30 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1.2fr] gap-3">
        <FieldGroup label="Department / Team Name">
          <input
            type="text"
            value={group.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="e.g. Production Crew"
            className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
        </FieldGroup>
        <FieldGroup label="Tracking Method">
          <select
            value={group.method}
            onChange={(e) => onMethodChange(e.target.value as CapacityMethod)}
            className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
          >
            {CAPACITY_METHODS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="text-[10px] text-mute mt-1 leading-relaxed">
            {meta.description}
          </div>
        </FieldGroup>
      </div>

      <MethodBody group={group} onChange={onChange} />

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onRemove}
          className="bg-transparent text-bad-soft border border-bad-soft text-[11px] font-bold px-3 py-1 rounded hover:bg-bad/10"
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
    <FieldGroup label="Utilization %">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          step={1}
          value={group.staticUtilPct ?? ''}
          onChange={(e) =>
            onChange({
              staticUtilPct:
                e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          className="w-24 bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
        />
        <span className="text-mute text-xs">
          shown every week until you change it
        </span>
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
      <div className="text-[10px] text-mute mt-1.5">
        Slots filled and total slots are entered each week.
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
  const isLabor = method === 'labor'

  const totalCapacity = isLabor
    ? totalCapacityHours(group)
    : totalRevenueCapacity(group)

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
      <div className="flex justify-between items-end mb-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white">
            {isLabor ? 'Employees' : 'Revenue Earners'}
          </div>
          <div className="text-[11px] text-accent font-semibold">
            {isLabor
              ? `${totalCapacity} hrs/wk capacity`
              : `${formatDollars(totalCapacity)}/wk capacity`}
          </div>
        </div>
        <button
          type="button"
          onClick={addEmployeeRow}
          className="bg-accent text-black font-bold px-3 py-1 rounded text-[11px] hover:brightness-95"
        >
          + Add
        </button>
      </div>

      {employees.length === 0 ? (
        <div className="bg-surface-2 rounded p-3 text-mute text-xs text-center">
          No rows yet — click + Add to start.
        </div>
      ) : (
        <div className="space-y-1.5">
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
      )}
    </div>
  )
}

function RowHeader({ method }: { method: 'labor' | 'revenue' }) {
  if (method === 'labor') {
    return (
      <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-2 px-1 text-[9px] font-semibold uppercase tracking-wider text-mute">
        <div>Name</div>
        <div>Role</div>
        <div>Capacity Hrs/Wk</div>
        <div>Working Hrs/Wk</div>
        <div className="w-6" />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[2fr_1.5fr_1fr_auto] gap-2 px-1 text-[9px] font-semibold uppercase tracking-wider text-mute">
      <div>Name</div>
      <div>Role</div>
      <div>$ Cap/Wk</div>
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
  const cellClass =
    'bg-surface-2 border border-line rounded text-white text-xs px-2 py-1.5 focus:outline-none focus:border-accent'
  if (method === 'labor') {
    return (
      <div className="grid grid-cols-[2fr_1.5fr_1fr_1fr_auto] gap-2 items-center">
        <input
          type="text"
          value={employee.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Name"
          className={cellClass}
        />
        <input
          type="text"
          value={employee.role}
          onChange={(e) => onChange({ role: e.target.value })}
          placeholder="Role"
          className={cellClass}
        />
        <input
          type="number"
          min={0}
          step={1}
          value={employee.capacityHoursPerWeek ?? ''}
          onChange={(e) =>
            onChange({
              capacityHoursPerWeek:
                e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          className={cellClass}
        />
        <input
          type="number"
          min={0}
          step={1}
          value={employee.weeklyWorkingHours ?? ''}
          onChange={(e) =>
            onChange({
              weeklyWorkingHours:
                e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          className={cellClass}
        />
        <RemoveX onClick={onRemove} />
      </div>
    )
  }
  return (
    <div className="grid grid-cols-[2fr_1.5fr_1fr_auto] gap-2 items-center">
      <input
        type="text"
        value={employee.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Name"
        className={cellClass}
      />
      <input
        type="text"
        value={employee.role}
        onChange={(e) => onChange({ role: e.target.value })}
        placeholder="Role"
        className={cellClass}
      />
      <input
        type="number"
        min={0}
        step={100}
        value={employee.revenueCapacityPerWeek ?? ''}
        onChange={(e) =>
          onChange({
            revenueCapacityPerWeek:
              e.target.value === '' ? undefined : Number(e.target.value),
          })
        }
        className={cellClass}
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
      className="text-bad-soft text-base leading-none w-6 hover:bg-bad/10 rounded"
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
        <input
          type="number"
          min={0}
          step={1}
          value={group.weeklyHoursPerFTE ?? ''}
          onChange={(e) =>
            onChange({
              weeklyHoursPerFTE:
                e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          className="w-24 bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
        />
      </FieldGroup>

      <div>
        <div className="flex justify-between items-end mb-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white">
              Departments
            </div>
            <div className="text-[11px] text-accent font-semibold">
              {totalHeadcountCapacityHours(group)} hrs/wk capacity
            </div>
          </div>
          <button
            type="button"
            onClick={addDept}
            className="bg-accent text-black font-bold px-3 py-1 rounded text-[11px] hover:brightness-95"
          >
            + Add
          </button>
        </div>

        {departments.length === 0 ? (
          <div className="bg-surface-2 rounded p-3 text-mute text-xs text-center">
            No departments yet — click + Add to start.
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[2fr_1fr_1fr_auto] gap-2 px-1 text-[9px] font-semibold uppercase tracking-wider text-mute">
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
                  className="bg-surface-2 border border-line rounded text-white text-xs px-2 py-1.5 focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={d.fullTimeCount}
                  onChange={(e) =>
                    updateDept(d.id, { fullTimeCount: Number(e.target.value) })
                  }
                  className="bg-surface-2 border border-line rounded text-white text-xs px-2 py-1.5 focus:outline-none focus:border-accent"
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={d.partTimeCount}
                  onChange={(e) =>
                    updateDept(d.id, { partTimeCount: Number(e.target.value) })
                  }
                  className="bg-surface-2 border border-line rounded text-white text-xs px-2 py-1.5 focus:outline-none focus:border-accent"
                />
                <RemoveX onClick={() => removeDept(d.id)} />
              </div>
            ))}
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
  return (
    <div className="bg-surface-2 rounded p-3">
      <div className="flex justify-between items-baseline mb-1.5">
        <div className="text-white text-sm font-semibold">
          {group.name || `Untitled (${meta.label})`}
        </div>
        <div className="text-[10px] text-accent font-bold uppercase tracking-wider">
          {meta.short}
        </div>
      </div>
      <ReadOnlySummary group={group} meta={meta} />
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
      <div className="text-mute text-xs">
        Static utilization: <strong className="text-white">{group.staticUtilPct ?? '—'}%</strong>
      </div>
    )
  }
  if (meta.value === 'slots') {
    return (
      <div className="text-mute text-xs">
        Slot duration: <strong className="text-white">{group.slotDurationMinutes ?? 30} min</strong>
      </div>
    )
  }
  if (meta.value === 'labor') {
    return (
      <div className="text-mute text-xs">
        {group.employees?.length ?? 0} {(group.employees?.length ?? 0) === 1 ? 'person' : 'people'} ·{' '}
        <strong className="text-white">{totalCapacityHours(group)} hrs/wk</strong>{' '}
        capacity
      </div>
    )
  }
  if (meta.value === 'revenue') {
    return (
      <div className="text-mute text-xs">
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
    <div className="text-mute text-xs">
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
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
