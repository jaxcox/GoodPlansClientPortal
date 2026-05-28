import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emptyKpiDefaults, toggleableByCategory } from '../lib/kpis'
import { useKpiToggle } from '../lib/useKpiToggle'
import { useFocusTrap } from '../lib/useFocusTrap'
import type { Industry } from '../lib/types'
import { Toggle } from './Toggle'

type Props = {
  open: boolean
  coachId: string
  onClose: () => void
  onCreated: (industry: Industry) => void
}

export function IndustryQuickAddModal({
  open,
  coachId,
  onClose,
  onCreated,
}: Props) {
  const [name, setName] = useState('')
  const [defaults, setDefaults] = useState<Record<string, number>>(
    emptyKpiDefaults()
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setDefaults(emptyKpiDefaults())
      setError(null)
      setSubmitting(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const { onToggle, feedback } = useKpiToggle(defaults, setDefaults)
  const groups = toggleableByCategory()
  const activeCount = Object.values(defaults).filter(
    (v) => Number(v) === 1
  ).length

  // Keep useFocusTrap above the early return so hook order stays
  // stable when open flips. The hook is a no-op when active=false.
  const trapRef = useFocusTrap(open)

  if (!open) return null

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Industry name is required.')
      return
    }
    setSubmitting(true)
    const { data, error: saveErr } = await supabase
      .from('industries')
      .insert({ coach_id: coachId, name: name.trim(), kpi_defaults: defaults })
      .select()
      .single()
    setSubmitting(false)
    if (saveErr) {
      setError(saveErr.message)
      return
    }
    onCreated(data as Industry)
  }

  return (
    // z-60 sits above ClientFormModal's z-50 so this stacks cleanly on top.
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Quick add industry"
        className="bg-surface-1 border border-line rounded-xl p-5 w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-white text-base font-bold">New Industry</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-white text-xl leading-none px-2 hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
              Industry Name *
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
              <label className="block text-xs font-semibold uppercase tracking-wider text-white">
                KPI Defaults for New Clients
              </label>
              <span className="text-xs text-white font-bold">
                {activeCount} active
              </span>
            </div>
            <p className="text-xs text-white mb-3 leading-relaxed">
              Income, COGS, Gross Profit, and GP Margin are always on.
            </p>
            <div className="bg-surface-2 rounded p-3 space-y-3">
              {groups.map((group) => (
                <div key={group.category}>
                  <div className="text-xs font-bold text-white uppercase tracking-wider mb-1.5">
                    {group.category}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1.5">
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
              {feedback && (
                <div className="text-xs text-white bg-accent/10 border border-accent/40 rounded px-3 py-2">
                  {feedback}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div role="alert" aria-live="assertive" className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-transparent text-white border border-mute px-4 py-1.5 rounded text-xs font-semibold hover:bg-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="bg-accent text-black font-bold px-4 py-1.5 rounded text-xs hover:brightness-95 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
