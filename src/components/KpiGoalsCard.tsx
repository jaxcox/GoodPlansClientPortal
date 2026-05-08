import { CATEGORIES, KPIS } from '../lib/kpis'
import type { KpiAggregation, KpiCategory, KpiFormat } from '../lib/kpis'
import type { Client } from '../lib/types'
import { NumberField } from './NumberField'

type Props = {
  client: Client
  goals: Record<string, number>
  onChange: (next: Record<string, number>) => void
}

type Row = {
  id: string
  label: string
  format: KpiFormat
  hint: string
}

/** Per-KPI hint text — answers "what number am I supposed to type here?". */
function goalHint(format: KpiFormat, aggregation: KpiAggregation): string {
  // Sum: total per month — the dashboard prorates to weeks.
  if (aggregation === 'sum') {
    return format === '$' ? 'Monthly $ target' : 'Monthly target'
  }
  // Last: snapshot KPIs (pipeline, accounts receivable). Target is the
  // value you want the snapshot at, any given week.
  if (aggregation === 'last') {
    return format === '$' ? 'Target $ at any point' : 'Target value at any point'
  }
  // Avg / derived: targets are entered as-is, no proration.
  if (format === '%') return 'Target percent'
  return 'Target value'
}

function customKpiHint(format: KpiFormat): string {
  if (format === '%') return 'Target percent'
  if (format === '$') return 'Target value'
  return 'Target value'
}

const numberFieldFormat: Record<KpiFormat, 'dollars' | 'percent' | 'count'> =
  {
    $: 'dollars',
    '%': 'percent',
    '#': 'count',
  }

export function KpiGoalsCard({ client, goals, onChange }: Props) {
  // Group by category, in the order categories should render
  const grouped: Map<KpiCategory, Row[]> = new Map()
  const standardByCategory: Map<KpiCategory, Row[]> = new Map()
  for (const k of KPIS) {
    if (k.always) continue
    if (Number(client.kpis[k.id]) !== 1) continue
    const list = standardByCategory.get(k.category) ?? []
    list.push({
      id: k.id,
      label: k.label,
      format: k.format,
      hint: goalHint(k.format, k.aggregation),
    })
    standardByCategory.set(k.category, list)
  }
  for (const c of client.custom_kpis ?? []) {
    if (c.active === false) continue
    const list = grouped.get(c.category) ?? []
    list.push({
      id: c.id,
      label: c.name,
      format: c.format,
      hint: customKpiHint(c.format),
    })
    grouped.set(c.category, list)
  }
  // Merge: standard first, then custom, per category
  for (const cat of CATEGORIES) {
    const std = standardByCategory.get(cat) ?? []
    const custom = grouped.get(cat) ?? []
    if (std.length || custom.length) grouped.set(cat, [...std, ...custom])
    else grouped.delete(cat)
  }

  const totalRows = Array.from(grouped.values()).reduce(
    (n, list) => n + list.length,
    0
  )

  if (totalRows === 0) {
    return (
      <div className="text-mute text-xs leading-relaxed">
        No active KPIs to set goals for. Toggle some on under{' '}
        <strong className="text-white">Settings → Active KPIs</strong>, then
        come back here to set their targets.
      </div>
    )
  }

  const setGoal = (id: string, n: number | undefined) => {
    const next = { ...goals }
    if (n === undefined) delete next[id]
    else next[id] = n
    onChange(next)
  }

  return (
    <div className="space-y-5">
      <p className="text-[11px] text-mute leading-relaxed">
        Each KPI's hint below tells you exactly what number to type.{' '}
        <strong className="text-white">Monthly</strong> targets get pro-rated
        to weekly on the dashboard;{' '}
        <strong className="text-white">target percent</strong> and{' '}
        <strong className="text-white">target value at any point</strong> are
        used as-is. Leave blank if there's no goal.
      </p>
      {CATEGORIES.map((cat) => {
        const rows = grouped.get(cat)
        if (!rows || rows.length === 0) return null
        return (
          <div key={cat}>
            <div className="text-[10px] font-bold text-accent uppercase tracking-wider pb-1 mb-2 border-b border-line">
              {cat}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {rows.map((row) => (
                <div key={row.id}>
                  <div className="flex items-baseline justify-between mb-1 gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-white">
                      {row.label}
                    </div>
                    <div className="text-[10px] text-mute italic whitespace-nowrap">
                      {row.hint}
                    </div>
                  </div>
                  <NumberField
                    value={goals[row.id]}
                    onChange={(n) => setGoal(row.id, n)}
                    format={numberFieldFormat[row.format]}
                    max={row.format === '%' ? 100 : null}
                    ariaLabel={`${row.hint} for ${row.label}`}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
