import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import {
  emptyKpiDefaults,
  findKpi,
  toggleableByCategory,
} from '../lib/kpis'
import { useKpiToggle } from '../lib/useKpiToggle'
import type { Industry } from '../lib/types'
import { Toggle } from './Toggle'

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; industry: Industry | null /* null = new */ }

type IndustrySort = 'alpha-asc' | 'alpha-desc' | 'most-clients' | 'newest'

export function IndustriesPage() {
  const { coach } = useAuth()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [industries, setIndustries] = useState<Industry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clientCounts, setClientCounts] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<IndustrySort>('alpha-asc')

  const refresh = async () => {
    const [iRes, cRes] = await Promise.all([
      supabase.from('industries').select('*').order('name'),
      supabase
        .from('clients')
        .select('industry_id')
        .not('industry_id', 'is', null),
    ])
    if (iRes.error) {
      setError(iRes.error.message)
      setIndustries([])
    } else {
      setError(null)
      setIndustries((iRes.data ?? []) as Industry[])
    }
    const counts: Record<string, number> = {}
    for (const row of cRes.data ?? []) {
      const id = (row as { industry_id: string | null }).industry_id
      if (id) counts[id] = (counts[id] ?? 0) + 1
    }
    setClientCounts(counts)
  }

  useEffect(() => {
    refresh()
  }, [])

  const visible = useMemo(() => {
    if (!industries) return null
    const q = search.trim().toLowerCase()
    const filtered = q
      ? industries.filter((i) => i.name.toLowerCase().startsWith(q))
      : industries
    const list = [...filtered]
    switch (sort) {
      case 'alpha-asc':
        return list.sort((a, b) => a.name.localeCompare(b.name))
      case 'alpha-desc':
        return list.sort((a, b) => b.name.localeCompare(a.name))
      case 'most-clients':
        return list.sort(
          (a, b) =>
            (clientCounts[b.id] ?? 0) - (clientCounts[a.id] ?? 0) ||
            a.name.localeCompare(b.name)
        )
      case 'newest':
        return list.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
  }, [industries, search, sort, clientCounts])

  if (!coach) return null

  if (mode.kind === 'edit') {
    return (
      <IndustryEditor
        coachId={coach.id}
        industry={mode.industry}
        onCancel={() => setMode({ kind: 'list' })}
        onSaved={() => {
          setMode({ kind: 'list' })
          refresh()
        }}
      />
    )
  }

  return (
    <section>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-ink text-lg font-bold">Custom Industries</h1>
        <button
          type="button"
          onClick={() => setMode({ kind: 'edit', industry: null })}
          className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95"
        >
          + Add Industry
        </button>
      </div>

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3 my-3"
        >
          {error}
        </div>
      )}

      {industries && industries.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by industry name…"
            className="flex-1 min-w-[12rem] max-w-sm bg-white border border-gray-300 rounded text-black text-xs px-3 py-1.5 focus:outline-none focus:border-gray-400"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as IndustrySort)}
            aria-label="Sort industries"
            className="select-yellow bg-white border border-gray-300 rounded text-black text-xs px-3 py-1.5 focus:outline-none focus:border-gray-400"
          >
            <option value="alpha-asc">Sort: A → Z</option>
            <option value="alpha-desc">Sort: Z → A</option>
            <option value="most-clients">Sort: Most clients first</option>
            <option value="newest">Sort: Newest first</option>
          </select>
        </div>
      )}

      <div className="mt-4">
        {industries === null ? (
          <Loading />
        ) : industries.length === 0 ? (
          <Empty onAdd={() => setMode({ kind: 'edit', industry: null })} />
        ) : visible && visible.length === 0 ? (
          <NoMatches />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {(visible ?? []).map((ind) => (
              <IndustryCard
                key={ind.id}
                industry={ind}
                clientCount={clientCounts[ind.id] ?? 0}
                onEdit={() => setMode({ kind: 'edit', industry: ind })}
                onDeleted={refresh}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function Loading() {
  return (
    <div className="bg-white border border-gray-200 rounded p-6 text-sm text-black">
      Loading…
    </div>
  )
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
      <div className="text-2xl mb-2">🏭</div>
      <div className="text-white font-bold text-sm mb-1">
        No custom industries yet
      </div>
      <div className="text-white text-xs">
        Add one to set default KPIs for new clients in that industry.
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95 mt-4"
      >
        + Add Industry
      </button>
    </div>
  )
}

function NoMatches() {
  return (
    <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
      <div className="text-white font-bold text-sm mb-1">No matches</div>
      <div className="text-white text-xs">
        No industries match that search.
      </div>
    </div>
  )
}

function IndustryCard({
  industry,
  clientCount,
  onEdit,
  onDeleted,
}: {
  industry: Industry
  clientCount: number
  onEdit: () => void
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const activeKpis = useMemo(
    () =>
      Object.entries(industry.kpi_defaults || {})
        .filter(([, v]) => Number(v) === 1)
        .map(([id]) => findKpi(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    [industry.kpi_defaults]
  )

  const onDelete = async () => {
    if (clientCount > 0) {
      alert(
        `Can't delete — ${clientCount} client${clientCount === 1 ? '' : 's'} ${clientCount === 1 ? 'is' : 'are'} using this industry. Reassign them in their Settings first.`
      )
      return
    }
    if (!confirm(`Delete the "${industry.name}" industry? This can't be undone.`)) return
    setBusy(true)
    const { error } = await supabase.from('industries').delete().eq('id', industry.id)
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    onDeleted()
  }

  return (
    <div className="bg-ink border border-line rounded-lg px-3 pt-2 pb-6 relative">
      <div className="flex justify-between items-center gap-3">
        <div className="min-w-0 truncate">
          <span className="text-white font-bold text-base">
            {industry.name}
          </span>
          {clientCount > 0 && (
            <span className="text-white font-normal text-sm ml-2">
              · {clientCount} client{clientCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onEdit}
            className="bg-accent text-black text-xs font-bold px-3 py-1.5 rounded hover:brightness-95"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="bg-transparent text-white border border-bad-soft text-xs font-bold px-3 py-1.5 rounded hover:bg-bad/10 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
      {expanded && activeKpis.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
          {activeKpis.map((k) => (
            <div key={k.id} className="flex items-center gap-2">
              <span className="text-accent font-bold text-xs">✓</span>
              <span className="text-white text-xs">{k.label}</span>
            </div>
          ))}
        </div>
      )}
      {activeKpis.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="absolute bottom-1 left-2 text-white text-lg font-bold leading-none w-5 h-5 flex items-center justify-center rounded hover:bg-white/10"
          aria-label={expanded ? 'Hide KPIs' : 'Show KPIs'}
          title={expanded ? 'Hide KPIs' : 'Show KPIs'}
        >
          {expanded ? '−' : '+'}
        </button>
      )}
    </div>
  )
}

function IndustryEditor({
  coachId,
  industry,
  onCancel,
  onSaved,
}: {
  coachId: string
  industry: Industry | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(industry?.name ?? '')
  const [defaults, setDefaults] = useState<Record<string, number>>(
    () => ({ ...emptyKpiDefaults(), ...(industry?.kpi_defaults ?? {}) })
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = toggleableByCategory()
  const activeCount = Object.values(defaults).filter((v) => Number(v) === 1).length
  const { onToggle, feedback } = useKpiToggle(defaults, setDefaults)

  const onSave = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Industry name is required.')
      return
    }
    setSubmitting(true)
    const payload = {
      coach_id: coachId,
      name: name.trim(),
      kpi_defaults: defaults,
    }
    const op = industry
      ? supabase.from('industries').update(payload).eq('id', industry.id)
      : supabase.from('industries').insert(payload)
    const { error: saveErr } = await op
    setSubmitting(false)
    if (saveErr) {
      setError(saveErr.message)
      return
    }
    onSaved()
  }

  return (
    <section>
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-ink text-lg font-bold">
          {industry ? 'Edit Industry' : 'New Industry'}
        </h1>
        <button
          type="button"
          onClick={onCancel}
          className="bg-transparent text-black border border-gray-300 px-3 py-1.5 rounded text-xs hover:bg-gray-50"
        >
          ← Back
        </button>
      </div>

      <div className="bg-ink border border-line rounded-lg p-5 space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
            Industry Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-white">
              KPI Defaults for New Clients
            </div>
            <div className="text-xs text-white font-bold">
              {activeCount} active
            </div>
          </div>
          <div className="space-y-4">
            {/* Financials section — matches the Settings page treatment.
                Always-on items aren't listed here; the note alone conveys it. */}
            <div>
              <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
                Financials
              </div>
              <div className="text-xs text-white italic">
                These items are always on.
              </div>
            </div>
            {groups.map((group) => (
              <div key={group.category}>
                <div className="text-xs font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
                  {group.category}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {group.kpis.map((k) => (
                    <Toggle
                      key={k.id}
                      checked={Number(defaults[k.id]) === 1}
                      onChange={(on) => onToggle(k.id, on)}
                      label={k.label}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {feedback && (
            <div className="mt-3 text-xs text-white bg-accent/10 border border-accent/40 rounded px-3 py-2">
              {feedback}
            </div>
          )}
        </div>

        {error && (
          <div role="alert" aria-live="assertive" className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="bg-transparent text-white border border-mute px-4 py-1.5 rounded text-xs font-semibold hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={submitting || !name.trim()}
            className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </section>
  )
}
