import { methodMeta } from '../lib/capacity'
import type { CapacityGroup, CapacityGroupGoal, Client } from '../lib/types'
import { NumberField } from './NumberField'

type Props = {
  client: Client
  goals: Record<string, CapacityGroupGoal>
  onChange: (next: Record<string, CapacityGroupGoal>) => void
}

/** Per-capacity-group goal inputs. Goal format depends on the group's method:
 *
 *   - Manual %  → no goal field; the static utilization on the group IS the
 *                 displayed value, so a separate "target" doesn't make sense
 *   - By Revenue ($) → weekly $ goal
 *   - All other methods (Slots / Labor Hours / Headcount) → utilization %
 *
 * Doc 04 PC #13: capacity goals live on the budget record (here), not Settings.
 */
export function CapacityGroupGoalsCard({ client, goals, onChange }: Props) {
  const groups = (client.capacity_groups ?? []).filter((g) => g.method)

  if (groups.length === 0) {
    return (
      <div className="text-white text-xs leading-relaxed">
        No capacity groups configured. Add one under{' '}
        <strong>Settings → Capacity &amp; Utilization Tracking</strong> to set
        goals here.
      </div>
    )
  }

  const setGoal = (groupId: string, patch: CapacityGroupGoal | null) => {
    const next = { ...goals }
    if (patch === null) delete next[groupId]
    else next[groupId] = patch
    onChange(next)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-white leading-relaxed">
        Target for each capacity group from Settings. Manual % groups don't
        have a separate goal — their static utilization is the value the
        dashboard shows every week.
      </p>
      {groups.map((g) => (
        <GoalRow
          key={g.id}
          group={g}
          goal={goals[g.id]}
          onChange={(patch) => setGoal(g.id, patch)}
        />
      ))}
    </div>
  )
}

function GoalRow({
  group,
  goal,
  onChange,
}: {
  group: CapacityGroup
  goal: CapacityGroupGoal | undefined
  onChange: (patch: CapacityGroupGoal | null) => void
}) {
  const meta = methodMeta(group.method)
  const name = group.name || (meta?.label ? `Untitled (${meta.label})` : 'Untitled')

  // Manual % → informational only
  if (group.method === 'manual') {
    return (
      <div className="bg-surface-2 border border-line rounded p-3">
        <div className="flex justify-between items-baseline gap-3">
          <div>
            <div className="text-white text-sm font-bold">{name}</div>
            <div className="text-white text-xs">Method: Manual %</div>
          </div>
          <div className="text-white text-sm font-semibold">
            {group.staticUtilPct ?? 0}%{' '}
            <span className="text-white text-xs italic">(static)</span>
          </div>
        </div>
      </div>
    )
  }

  // Revenue → $ weekly goal
  if (group.method === 'revenue') {
    return (
      <div className="bg-surface-2 border border-line rounded p-3">
        <div className="text-white text-sm font-bold mb-2">{name}</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
              Weekly Revenue Goal
            </div>
            <NumberField
              value={goal?.target}
              onChange={(n) =>
                onChange(
                  n === undefined ? null : { target: n, format: '$' }
                )
              }
              format="dollars"
              max={null}
              ariaLabel={`Weekly revenue goal for ${name}`}
            />
          </div>
          <div className="text-white text-xs">
            {meta?.description}
          </div>
        </div>
      </div>
    )
  }

  // Slots / Labor / Headcount → % utilization goal
  return (
    <div className="bg-surface-2 border border-line rounded p-3">
      <div className="text-white text-sm font-bold mb-2">{name}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-white mb-1">
            Utilization Goal
          </div>
          <NumberField
            value={goal?.target}
            onChange={(n) =>
              onChange(n === undefined ? null : { target: n, format: '%' })
            }
            format="percent"
            ariaLabel={`Utilization goal for ${name}`}
          />
        </div>
        <div className="text-white text-xs">{meta?.description}</div>
      </div>
    </div>
  )
}
