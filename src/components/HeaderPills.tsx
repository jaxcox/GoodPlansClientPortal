// =============================================================================
// Shared header-row pills — used by the Weekly Dashboard and the Weekly
// Entry page so the two screens read identically. Pulled out of
// WeeklyDashboard.tsx so the entry page can drop the older labelled
// native input + plain-text week range in favor of the same combined
// pill UX.
// =============================================================================

import { useRef } from 'react'
import {
  dateFromIso,
  formatWeekShort,
  isoDate,
  lastCompletedSaturday,
} from '../lib/week'

// -----------------------------------------------------------------------------
// WeekOfCalendarPill
// -----------------------------------------------------------------------------
/** Combined "Week of [date]" pill — the ENTIRE pill is a button. Clicking
 *  anywhere on it opens the OS-native date picker via showPicker() on a
 *  hidden date input (a bare invisible-overlay input only opens on desktop
 *  when you hit its calendar indicator, which made the pill feel like only
 *  the icon was clickable). Falls back to focusing the input if showPicker
 *  isn't supported. Caps at the most recent completed Saturday — any past
 *  completed week is viewable, never a future one. */
export function WeekOfCalendarPill({
  weekStart,
  onPick,
}: {
  weekStart: Date
  onPick: (date: Date) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const openPicker = () => {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker()
        return
      } catch {
        // Some browsers throw if the picker can't open; fall through.
      }
    }
    el.focus()
  }
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={openPicker}
        aria-label="Pick a week"
        className="bg-ink text-white px-3 py-1 rounded font-semibold inline-flex items-center gap-2 cursor-pointer hover:brightness-110 transition-[filter]"
      >
        <span>Week of {formatWeekShort(weekStart)}</span>
        <span aria-hidden className="text-sm">📅</span>
      </button>
      <input
        ref={inputRef}
        type="date"
        value={isoDate(weekStart)}
        max={isoDate(lastCompletedSaturday())}
        onChange={(e) => {
          if (e.target.value) onPick(dateFromIso(e.target.value))
        }}
        aria-hidden="true"
        tabIndex={-1}
        // Hidden but kept in the DOM (not display:none) so showPicker can
        // anchor the native popup near the pill's bottom-left.
        className="absolute bottom-0 left-0 h-0 w-0 opacity-0 pointer-events-none"
      />
    </span>
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
