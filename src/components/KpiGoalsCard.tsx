import { CATEGORIES, KPIS } from '../lib/kpis'
import type { KpiCategory, KpiFormat } from '../lib/kpis'
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
}

const numberFieldFormat: Record<KpiFormat, 'dollars' | 'percent' | 'count'> =
  {
    $: 'dollars',
    '%': 'percent',
    '#': 'count',
  }

export function KpiGoalsCard({ client, goals, onChange }: Props) {
  // Active toggleable standard KPIs (the always-on Financials are derived
  // from Annual Targets, so they don't appear here)
  const standardRows: Row[] = KPIS.filter(
    (k) => !k.always && Number(client.kpis[k.id]) === 1
  ).map((k) => ({ id: k.id, label: k.label, format: k.format }))

  const customRows: Row[] = (client.custom_kpis ?? [])
    .filter((c) => c.active !== false)
    .map((c) => ({ id: c.id, label: c.name, format: c.format }))

  // Group by category, in the order categories should render
  const grouped: Map<KpiCategory, Row[]> = new Map()
  const standardByCategory: Map<KpiCategory, Row[]> = new Map()
  for (const k of KPIS) {
    if (k.always) continue
    if (Number(client.kpis[k.id]) !== 1) continue
    const list = standardByCategory.get(k.category) ?? []
    list.push({ id: k.id, label: k.label, format: k.format })
    standardByCategory.set(k.category, list)
  }
  for (const c of client.custom_kpis ?? []) {
    if (c.active === false) continue
    const list = grouped.get(c.category) ?? []
    list.push({ id: c.id, label: c.name, format: c.format })
    grouped.set(c.category, list)
  }
  // Merge: standard first, then custom, per category
  for (const cat of CATEGORIES) {
    const std = standardByCategory.get(cat) ?? []
    const custom = grouped.get(cat) ?? []
    if (std.length || custom.length) grouped.set(cat, [...std, ...custom])
    else grouped.delete(cat)
  }

  if (standardRows.length === 0 && customRows.length === 0) {
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
        Annual or weekly target for each KPI. Empty = no goal set yet — the
        dashboard will render the tile in neutral gray.
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
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
                    {row.label}
                  </div>
                  <NumberField
                    value={goals[row.id]}
                    onChange={(n) => setGoal(row.id, n)}
                    format={numberFieldFormat[row.format]}
                    max={row.format === '%' ? 100 : null}
                    ariaLabel={`Goal for ${row.label}`}
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
