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

/** Per-KPI hint text — answers "what number am I supposed to type here?".
 *
 *  Sum/$ KPI goals are stored as ANNUAL amounts and pro-rated by the dashboard
 *  using the same season_pct distribution that drives monthly income targets.
 *  Symmetric with the Income Target (also annual). */
function goalHint(format: KpiFormat, aggregation: KpiAggregation): string {
  // Sum: annual total. Dashboard math: monthly = annual × monthShare,
  // weekly = annual × monthShare × days/30.
  if (aggregation === 'sum') {
    return format === '$' ? 'Annual $ target' : 'Annual target'
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
      <div className="text-white text-xs leading-relaxed">
        No active indicators to set goals for. Toggle some on under{' '}
        <strong className="text-white">
          Settings → Active Key Performance Indicators
        </strong>
        , then come back here to set their targets.
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
      {CATEGORIES.map((cat) => {
        const rows = grouped.get(cat)
        if (!rows || rows.length === 0) return null
        return (
          <div key={cat}>
            <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
              {cat}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
              {rows.map((row) => (
                <div key={row.id}>
                  <div className="flex items-baseline justify-between mb-1 gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-white">
                      {row.label}
                    </div>
                    <div className="text-xs text-white italic whitespace-nowrap">
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
