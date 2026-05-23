// =============================================================================
// Week math — Sunday-start, Saturday-end (US convention).
// All week-related state in the portal uses these helpers so the convention
// is enforced in one place.
// =============================================================================

/** The Sunday on or before `date` (in local time). */
export function weekStartSunday(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay()) // getDay: Sun=0
  return d
}

/** The Saturday after `date`'s week-start (in local time). */
export function weekEndSaturday(date: Date): Date {
  const d = weekStartSunday(date)
  d.setDate(d.getDate() + 6)
  return d
}

/** YYYY-MM-DD in local time. Used as the DB key for week_start_date. */
export function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse a YYYY-MM-DD string back to a local-time Date at midnight. */
export function dateFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}

/** Step the week by N weeks (negative for past, positive for future). */
export function shiftWeek(weekStart: Date, weeks: number): Date {
  const d = new Date(weekStart)
  d.setDate(d.getDate() + weeks * 7)
  return weekStartSunday(d)
}

/** The Sunday of the most recent COMPLETED week (i.e. last week — never
 *  the current in-progress week). If today is Sunday May 11, this returns
 *  May 4. Used as the default landing week on the Weekly Entry page. */
export function mostRecentCompletedWeekStart(today: Date = new Date()): Date {
  const current = weekStartSunday(today)
  const d = new Date(current)
  d.setDate(d.getDate() - 7)
  return d
}

/** The Saturday at the end of the most recent completed week — i.e. the
 *  latest date the user is allowed to enter actuals for (yesterday-or-
 *  earlier, never inside the in-progress week). */
export function lastCompletedSaturday(today: Date = new Date()): Date {
  const current = weekStartSunday(today)
  const d = new Date(current)
  d.setDate(d.getDate() - 1)
  return d
}

/** Spec for one partial side of a boundary-week split. */
export type PartialSlot = {
  /** YYYY-MM-DD start date (Sunday for side A, 1st of next month for B). */
  startIso: string
  /** Number of days this partial covers (1–6). */
  days: number
  /** 0-indexed month this partial belongs to. */
  month: number
  /** Year this partial belongs to (matters for the Dec/Jan year boundary). */
  year: number
}

/** Detect whether a Sun-Sat week crosses a month boundary. Returns the
 *  two partial slots (A = Sunday→end-of-month, B = 1st-of-next-month
 *  →Saturday) or null if the week sits entirely in one month.
 *
 *  Used by the Weekly Entry boundary UI to render two entry cards, and
 *  by missedWeeksBetween (range-aware) to know whether both halves of a
 *  boundary week have been filled in. */
export function monthBoundaryInWeek(weekStart: Date): {
  a: PartialSlot
  b: PartialSlot
} | null {
  const sun = weekStartSunday(weekStart)
  const sat = weekEndSaturday(sun)
  if (sun.getMonth() === sat.getMonth()) return null

  // Last day of the Sunday's month — that's where partial A ends.
  const sideAEnd = new Date(sun.getFullYear(), sun.getMonth() + 1, 0)
  const sideBStart = new Date(sun.getFullYear(), sun.getMonth() + 1, 1)

  const aDays =
    Math.round(
      (sideAEnd.getTime() - sun.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1
  const bDays = 7 - aDays

  return {
    a: {
      startIso: isoDate(sun),
      days: aDays,
      month: sun.getMonth(),
      year: sun.getFullYear(),
    },
    b: {
      startIso: isoDate(sideBStart),
      days: bDays,
      month: sideBStart.getMonth(),
      year: sideBStart.getFullYear(),
    },
  }
}

/** Returns the inclusive YYYY-MM-DD ISO dates that an entry covers,
 *  given its start date and days count. Used by range-aware missed
 *  weeks. */
export function entryCoveredIsos(startIso: string, days: number): string[] {
  const out: string[] = []
  const d = dateFromIso(startIso)
  for (let i = 0; i < days; i++) {
    out.push(isoDate(d))
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** Sundays from `fromDate`'s week up to (but not including) the current
 *  in-progress week that aren't fully covered by saved entries. Range-
 *  aware: walks each Sun-Sat week day by day and only counts the week
 *  as covered when every day is inside at least one entry's date range.
 *  Handles boundary weeks correctly — a Sun-Sat week with only the
 *  Partial A row saved still shows as missed because Partial B's days
 *  aren't covered.
 *
 *  Returned most-recent-first. Used by Weekly Entry (dropdown of weeks
 *  to fill in) and the Weekly Dashboard (multi-week-gap status pill). */
export function missedWeeksBetween(
  fromDate: Date,
  savedEntries: { startIso: string; days: number }[],
  today: Date = new Date()
): Date[] {
  // Flatten every saved entry's date range into a single Set we can
  // check per-day. Cheap because total days across all entries is the
  // same order of magnitude as the number of weeks we're scanning.
  const coveredDays = new Set<string>()
  for (const e of savedEntries) {
    for (const iso of entryCoveredIsos(e.startIso, e.days)) {
      coveredDays.add(iso)
    }
  }

  const start = weekStartSunday(fromDate)
  const current = weekStartSunday(today)
  const out: Date[] = []
  const cur = new Date(start)
  while (cur < current) {
    let allCovered = true
    const probe = new Date(cur)
    for (let i = 0; i < 7; i++) {
      if (!coveredDays.has(isoDate(probe))) {
        allCovered = false
        break
      }
      probe.setDate(probe.getDate() + 1)
    }
    if (!allCovered) out.push(new Date(cur))
    cur.setDate(cur.getDate() + 7)
  }
  return out.reverse()
}

/** "Week of Sun, May 4 – Sat, May 10, 2026" */
export function formatWeekRange(weekStart: Date): string {
  const start = weekStartSunday(weekStart)
  const end = weekEndSaturday(start)
  const sameYear = start.getFullYear() === end.getFullYear()
  const startFmt = start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endFmt = end.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startFmt} – ${endFmt}`
}

/** Range label for an entry — honors its actual day count so partials
 *  read "Mar 29–31, 2026" or "Apr 1–4, 2026" instead of the full Sun-Sat
 *  week. Full 7-day entries fall through to the formatWeekShort shape
 *  ("May 4–10, 2026"). Used by HistoryPage column headers + Excel export
 *  and the boundary-week card picker. */
export function formatEntryRange(startIso: string, days: number): string {
  const start = dateFromIso(startIso)
  const end = new Date(start)
  end.setDate(end.getDate() + days - 1)
  const sameMonth = start.getMonth() === end.getMonth()
  const sameYear = start.getFullYear() === end.getFullYear()
  if (sameMonth) {
    const month = start.toLocaleDateString('en-US', { month: 'short' })
    return `${month} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
  }
  const startFmt = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const endFmt = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startFmt} – ${endFmt}`
}

/** Short form: "May 4–10, 2026" */
export function formatWeekShort(weekStart: Date): string {
  const start = weekStartSunday(weekStart)
  const end = weekEndSaturday(start)
  const sameMonth = start.getMonth() === end.getMonth()
  if (sameMonth) {
    const month = start.toLocaleDateString('en-US', { month: 'short' })
    return `${month} ${start.getDate()}–${end.getDate()}, ${end.getFullYear()}`
  }
  const startFmt = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
  const endFmt = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${startFmt} – ${endFmt}`
}
