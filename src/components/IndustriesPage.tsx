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

export function IndustriesPage() {
  const { coach } = useAuth()
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [industries, setIndustries] = useState<Industry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clientCounts, setClientCounts] = useState<Record<string, number>>({})

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
      <div className="flex justify-between items-start mb-1">
        <div>
          <h1 className="text-ink text-base font-bold">Custom Industries</h1>
          <p className="text-black text-xs">
            Define industries and their default Key Performance Indicator sets for new clients.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMode({ kind: 'edit', industry: null })}
          className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95"
        >
          + New Industry
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3 my-3">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {industries === null ? (
          <Loading />
        ) : industries.length === 0 ? (
          <Empty />
        ) : (
          industries.map((ind) => (
            <IndustryCard
              key={ind.id}
              industry={ind}
              clientCount={clientCounts[ind.id] ?? 0}
              onEdit={() => setMode({ kind: 'edit', industry: ind })}
              onDeleted={refresh}
            />
          ))
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

function Empty() {
  return (
    <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
      <div className="text-2xl mb-2">🏭</div>
      <div className="text-white font-bold text-sm mb-1">
        No custom industries yet
      </div>
      <div className="text-white text-xs">
        Add one to set default Key Performance Indicators for new clients in that industry.
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

  const activeKpis = useMemo(
    () =>
      Object.entries(industry.kpi_defaults || {})
        .filter(([, v]) => Number(v) === 1)
        .map(([id]) => findKpi(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x)),
    [industry.kpi_defaults]
  )

  const byCategory = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const k of activeKpis) {
      if (!map.has(k.category)) map.set(k.category, [])
      map.get(k.category)!.push(k.label)
    }
    return Array.from(map.entries())
  }, [activeKpis])

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
    <div className="bg-ink border border-line rounded-lg p-4 flex justify-between items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-white font-bold text-sm mb-1">{industry.name}</div>
        <div className="text-white text-[11px] mb-2">
          {activeKpis.length} Key Performance Indicator{activeKpis.length === 1 ? '' : 's'} active by default
          {clientCount > 0 && ` · ${clientCount} client${clientCount === 1 ? '' : 's'}`}
        </div>
        {byCategory.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {byCategory.map(([cat, labels]) => (
              <span
                key={cat}
                className="bg-line text-white rounded px-2 py-0.5 text-[10px] font-semibold"
              >
                {cat}: {labels.join(', ')}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onEdit}
          className="bg-accent text-black text-[11px] font-bold px-3 py-1.5 rounded hover:brightness-95"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="bg-transparent text-white border border-bad-soft text-[11px] font-bold px-3 py-1.5 rounded hover:bg-bad/10 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
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
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-ink text-base font-bold">
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
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-white mb-1">
            Industry Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full bg-surface-2 border border-line rounded text-white text-sm px-3 py-2 focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-white">
              Key Performance Indicator Defaults for New Clients
            </div>
            <div className="text-[10px] text-white font-bold">
              {activeCount} active
            </div>
          </div>
          <p className="text-[11px] text-white mb-3 leading-relaxed">
            Revenue, COGS, Gross Profit, and GP Margin are always on for every
            client. Toggle the rest to set this industry's defaults.
          </p>

          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.category}>
                <div className="text-[10px] font-bold text-white uppercase tracking-wider pb-1 mb-2 border-b border-line">
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
            <div className="mt-3 text-[11px] text-white bg-accent/10 border border-accent/40 rounded px-3 py-2">
              {feedback}
            </div>
          )}
        </div>

        {error && (
          <div className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
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
            {submitting ? 'Saving…' : 'Save Industry'}
          </button>
        </div>
      </div>
    </section>
  )
}
