type Props = {
  isDirty: boolean
  saving: boolean
  savedAt: number | null
  onCancel: () => void
  onSave: () => void
}

// Shared Cancel + Save bar used at the top and bottom of every edit page
// (Settings, Budget & Goals, Weekly Entry). Yellow "Save" is the default
// even on a clean form so the screen never feels "done" on arrival; green
// "Saved ✓" is a transient confirmation that fades back to yellow after a
// few seconds (parent controls the timing via savedAt).
export function SaveBar({ isDirty, saving, savedAt, onCancel, onSave }: Props) {
  const showSaved = !isDirty && savedAt !== null
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="bg-white text-black border border-gray-300 px-4 py-2 sm:py-1.5 rounded text-xs font-semibold hover:bg-gray-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className={`px-4 py-2 sm:py-1.5 rounded text-xs font-bold ${
          showSaved
            ? 'bg-good text-black hover:brightness-95'
            : 'bg-accent text-black hover:brightness-95'
        } disabled:opacity-60 disabled:cursor-wait`}
      >
        {saving ? 'Saving…' : showSaved ? 'Saved ✓' : 'Save'}
      </button>
    </div>
  )
}
