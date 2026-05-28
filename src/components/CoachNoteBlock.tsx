import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Props = {
  clientId: string
  /** Current note body. Null when never set. */
  note: string | null
  updatedAt: string | null
  /** True when a coach is viewing this client's portal — enables edit mode.
   *  False = client-only read view. */
  coachView: boolean
  /** Called after a successful save so the parent re-renders with the
   *  new note + timestamp. */
  onSaved: () => void
}

const SEEN_KEY = (clientId: string) => `coachNoteSeen:${clientId}`

// Coach Notes block on the Weekly Dashboard. Coach writes standing context
// for the client ("focus areas this quarter", "see our last conversation
// about pricing"). Client reads. Single value per client — no history.
// Default collapsed so a long note doesn't push KPI tiles below the fold.
// A "NEW!" badge shows on the collapsed banner the first time the client
// signs in after the coach updates the note; clicking to expand clears
// the badge (stored in localStorage per-device).
export function CoachNoteBlock({
  clientId,
  note,
  updatedAt,
  coachView,
  onSaved,
}: Props) {
  const [collapsed, setCollapsed] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Most recent updated_at value the client has acknowledged (i.e.
   *  expanded after the coach updated it). Loaded from localStorage on
   *  mount; updated when the user opens the note. */
  const [seenAt, setSeenAt] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(SEEN_KEY(clientId))
  })

  // Coach view never shows NEW — the coach is the one who wrote the
  // update. The badge is a signal to the client that the coach refreshed
  // the note since their last visit.
  const isNew =
    !coachView &&
    !!updatedAt &&
    (seenAt == null || new Date(updatedAt) > new Date(seenAt))

  const markSeen = () => {
    if (!updatedAt || coachView) return
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SEEN_KEY(clientId), updatedAt)
    }
    setSeenAt(updatedAt)
  }

  // If the user lands with the note already expanded (e.g. coach view, or
  // editing mode), mark it seen so the badge clears.
  useEffect(() => {
    if (!collapsed && !editing) markSeen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, editing, updatedAt])

  const hasNote = note != null && note.trim().length > 0
  // Don't render at all on client view when there's no note yet
  if (!coachView && !hasNote) return null

  const openEditor = () => {
    setDraft(note ?? '')
    setError(null)
    setEditing(true)
  }

  const onSave = async () => {
    setSaving(true)
    setError(null)
    const body = draft.trim() || null
    const { error: err } = await supabase
      .from('clients')
      .update({
        coach_note: body,
        coach_note_updated_at: body ? new Date().toISOString() : null,
      })
      .eq('id', clientId)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(false)
    onSaved()
  }

  const onClear = async () => {
    if (
      !confirm(
        'Clear the coach note? The current text will be erased and the client will no longer see it.'
      )
    )
      return
    setSaving(true)
    setError(null)
    const { error: err } = await supabase
      .from('clients')
      .update({ coach_note: null, coach_note_updated_at: null })
      .eq('id', clientId)
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setEditing(false)
    setDraft('')
    onSaved()
  }

  const updatedLabel = updatedAt
    ? new Date(updatedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  // Editing mode (coach only) ------------------------------------------------
  if (editing) {
    return (
      <div className="bg-ink border border-line rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-white text-sm font-bold">Coach Note</h2>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          placeholder="Standing context for this client — focus areas, action items, strategic heads-ups…"
          className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black text-black rounded text-sm px-3 py-2 focus:outline-none"
        />
        {error && (
          <div role="alert" aria-live="assertive" className="text-xs text-white bg-bad/10 border border-bad/40 rounded px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setError(null)
            }}
            className="bg-transparent text-white border border-mute px-4 py-2 sm:py-1.5 rounded text-xs font-semibold hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    )
  }

  // Collapsed mode ------------------------------------------------------------
  if (collapsed) {
    return (
      <div className="bg-ink border border-line rounded-lg p-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-bold uppercase tracking-wider text-white truncate">
            Coach Note {!hasNote && '📝 (none)'}
          </span>
          {isNew && (
            <span className="bg-accent text-black text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0">
              New!
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setCollapsed(false)
            markSeen()
          }}
          aria-label="Expand coach note"
          className="text-accent border border-accent rounded w-6 h-6 flex items-center justify-center text-base font-bold leading-none hover:bg-white/10 shrink-0"
        >
          +
        </button>
      </div>
    )
  }

  // Empty state on coach view --------------------------------------------------
  if (!hasNote) {
    return (
      <div className="bg-ink border border-line rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-white">
            Coach Note
          </div>
          <div className="text-xs text-white mt-1">
            Add standing context for {/* client name not passed; generic label */}
            this client. They'll see it at the top of their dashboard.
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={openEditor}
            className="bg-accent text-black px-3 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95"
          >
            + Add Note
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse coach note"
            className="text-white border border-mute rounded w-6 h-6 flex items-center justify-center text-base font-bold leading-none hover:bg-white/10"
          >
            −
          </button>
        </div>
      </div>
    )
  }

  // Read / displayed mode -----------------------------------------------------
  return (
    <div className="bg-ink border border-line rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-xs font-bold uppercase tracking-wider text-white">
            Coach Note
          </div>
          {isNew && (
            <span className="bg-accent text-black text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 rounded">
              New!
            </span>
          )}
          {updatedLabel && (
            <div className="text-xs text-white">Updated {updatedLabel}</div>
          )}
        </div>
        <div className="flex gap-2 shrink-0 items-center">
          {coachView && (
            <>
              <button
                type="button"
                onClick={openEditor}
                className="bg-accent text-black border border-accent px-3 py-1 rounded text-xs font-bold hover:brightness-95"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={saving}
                className="bg-transparent text-white border border-mute px-3 py-1 rounded text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
              >
                Clear
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse coach note"
            className="text-white border border-mute rounded w-6 h-6 flex items-center justify-center text-base font-bold leading-none hover:bg-white/10"
          >
            −
          </button>
        </div>
      </div>
      <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">
        {note}
      </div>
    </div>
  )
}
