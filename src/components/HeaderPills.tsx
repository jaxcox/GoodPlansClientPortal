// =============================================================================
// Shared header-row pills — used by the Weekly Dashboard and the Weekly
// Entry page so the two screens read identically. Pulled out of
// WeeklyDashboard.tsx so the entry page can drop the older labelled
// native input + plain-text week range in favor of the same combined
// pill UX.
// =============================================================================

import {
  dateFromIso,
  formatWeekShort,
  isoDate,
  lastCompletedSaturday,
} from '../lib/week'

// -----------------------------------------------------------------------------
// WeekOfCalendarPill
// -----------------------------------------------------------------------------
/** Combined "Week of [date]" pill + invisible native date input overlay.
 *  Tapping anywhere on the pill opens the OS-native date picker (because
 *  the input lives inside the <label> and the click bubbles to it). Caps
 *  at the most recent completed Saturday — you can view any past
 *  completed week, never a future one. */
export function WeekOfCalendarPill({
  weekStart,
  onPick,
}: {
  weekStart: Date
  onPick: (date: Date) => void
}) {
  return (
    <label className="bg-ink text-white px-3 py-1 rounded font-semibold inline-flex items-center gap-2 cursor-pointer relative">
      <span>Week of {formatWeekShort(weekStart)}</span>
      <span aria-hidden className="text-sm">📅</span>
      <input
        type="date"
        value={isoDate(weekStart)}
        max={isoDate(lastCompletedSaturday())}
        onChange={(e) => {
          if (e.target.value) onPick(dateFromIso(e.target.value))
        }}
        aria-label="Pick a week"
        className="absolute inset-0 opacity-0 cursor-pointer"
      />
    </label>
  )
}

// -----------------------------------------------------------------------------
// MissedWeeksPill
// -----------------------------------------------------------------------------
/** Red dropdown surfacing missed-week count + tap-to-pick list.
 *  Native <select> — iOS opens a scroll wheel, desktop a popup. Callers
 *  decide what "pick" means (Weekly Dashboard deep-links into Entry;
 *  Weekly Entry just changes its own week state). */
export function MissedWeeksPill({
  missedWeeks,
  onPick,
}: {
  missedWeeks: Date[]
  onPick?: (weekStart: Date) => void
}) {
  return (
    <select
      value=""
      onChange={(e) => {
        if (!e.target.value || !onPick) return
        onPick(dateFromIso(e.target.value))
      }}
      aria-label="Jump to a missed week"
      // text-base + font-semibold + border-0 keep the pill at the same
      // height as the WeekOfCalendarPill on desktop. (On mobile both
      // already render at 16px via the iOS-zoom-fix media query.)
      className="select-yellow bg-bad text-white font-semibold rounded px-3 py-1 text-base border-0 focus:outline-none cursor-pointer"
    >
      <option value="">Missed weeks ({missedWeeks.length})</option>
      {missedWeeks.map((d) => (
        <option key={isoDate(d)} value={isoDate(d)} className="text-black">
          {formatWeekShort(d)}
        </option>
      ))}
    </select>
  )
}
