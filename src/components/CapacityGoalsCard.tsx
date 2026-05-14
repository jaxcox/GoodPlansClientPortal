import type { CapacityGroup, CapacityGroupGoal } from '../lib/types'
import { methodMeta } from '../lib/capacity'
import { NumberField } from './NumberField'

type Props = {
  /** Capacity groups defined on the client record. Read-only here — to
   *  add / edit / remove a group, the coach goes to Settings → Utilization. */
  groups: CapacityGroup[]
  /** Per-group goals (utilization %, plus labor-only hours + efficiency). */
  goals: Record<string, CapacityGroupGoal>
  onChange: (next: Record<string, CapacityGroupGoal>) => void
}

// Per-group goal editor for the Budget & Goals page. Each capacity group
// row exposes its utilization %, and labor-method groups additionally
// expose Labor Hours and (when not hidden) Labor Efficiency goals. Group
// setup itself (employees, hours, method) is managed on Settings; this
// card is goals-only.
export function CapacityGoalsCard({ groups, goals, onChange }: Props) {
  const patchGoal = (id: string, patch: Partial<CapacityGroupGoal>) => {
    const existing = goals[id] ?? { target: 0, format: '%' as const }
    const next = { ...goals, [id]: { ...existing, ...patch } }
    // If everything is empty/zero, remove the row entirely so the budget
    // stays clean.
    const g = next[id]
    if (
      (g.target == null || g.target === 0) &&
      g.laborHoursGoal == null &&
      g.laborEfficiencyGoal == null
    ) {
      delete next[id]
    }
    onChange(next)
  }

  return (
    <div className="space-y-3">
      {groups.length === 0 ? (
        <div className="bg-ink border border-line rounded-lg p-5 text-white text-xs">
          No capacity groups yet. Add them in{' '}
          <strong>Settings → Utilization</strong>, then come back here to
          set their goals.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 items-start">
          {groups.map((g) => {
            const meta = methodMeta(g.method)
            const goal = goals[g.id]
            const showEfficiency =
              g.method === 'labor' && !g.hideLaborEfficiency
            const showLaborHours = g.method === 'labor'
            return (
              <div
                key={g.id}
                className="bg-ink border border-line rounded-lg p-4 space-y-3"
              >
                <div className="text-white text-sm font-bold">
                  {g.name || '(unnamed group)'}
                  {meta && (
                    <span className="text-white text-xs font-normal ml-2">
                      {meta.label}
                    </span>
                  )}
                </div>
                <GoalField
                  label="Utilization Goal"
                  value={goal?.target}
                  format="percent"
                  onChange={(n) => patchGoal(g.id, { target: n ?? 0 })}
                />
                {showLaborHours && (
                  <GoalField
                    label="Labor Hours Goal"
                    value={goal?.laborHoursGoal}
                    format="count"
                    onChange={(n) =>
                      patchGoal(g.id, { laborHoursGoal: n ?? undefined })
                    }
                  />
                )}
                {showEfficiency && (
                  <GoalField
                    label="Labor Efficiency Goal"
                    value={goal?.laborEfficiencyGoal}
                    format="percent"
                    // Efficiency can legitimately exceed 100% (overtime /
                    // multi-billing), so don't cap input.
                    max={null}
                    onChange={(n) =>
                      patchGoal(g.id, {
                        laborEfficiencyGoal: n ?? undefined,
                      })
                    }
                  />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function GoalField({
  label,
  value,
  format,
  max,
  onChange,
}: {
  label: string
  value: number | undefined
  format: 'count' | 'percent'
  /** Override the NumberField default. `null` = unbounded (used for
   *  Labor Efficiency, which can exceed 100% during overtime). */
  max?: number | null
  onChange: (n: number | undefined) => void
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <NumberField
        value={value}
        onChange={onChange}
        format={format}
        max={max}
        ariaLabel={label}
      />
    </div>
  )
}
