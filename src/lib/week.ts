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

/** Sundays from `fromDate`'s week up to (but not including) the current
 *  in-progress week, minus any week present in `savedWeekIsos`. Returned
 *  most-recent-first. Used by Weekly Entry (dropdown of weeks to fill in)
 *  and the Weekly Dashboard (multi-week-gap status pill). */
export function missedWeeksBetween(
  fromDate: Date,
  savedWeekIsos: Set<string>,
  today: Date = new Date()
): Date[] {
  const start = weekStartSunday(fromDate)
  const current = weekStartSunday(today)
  const out: Date[] = []
  const cur = new Date(start)
  while (cur < current) {
    if (!savedWeekIsos.has(isoDate(cur))) out.push(new Date(cur))
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
