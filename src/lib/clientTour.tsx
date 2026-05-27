// =============================================================================
// Client onboarding tour — Driver.js guided walk-through
// =============================================================================
// First-time clients get a quick 5-step tour of the portal's main nav and
// key actions. Tour is opt-in (a button on the welcome card), opt-out
// (Skip), and replay-able (a "Replay tour" entry on the Resources page).
//
// Driver.js highlights the target element with a spotlight and floats a
// popover beside it. Targets are anchored to stable selectors on the
// ClientPortal nav (data-tour="dashboard" / "entry" / "resources" /
// "message" / etc.) so the tour code stays loose from JSX edits.
//
// Persistence: a localStorage flag keyed on clientId records whether the
// client has completed (or skipped) the tour. The welcome card on
// ClientPortal reads this flag to decide whether to render itself on
// first sign-in.

import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'

/** LocalStorage key namespaces by clientId so a coach who views multiple
 *  clients' portals (coach view) doesn't dismiss the tour for them all. */
const STORAGE_KEY = (clientId: string) => `clientTourSeen:${clientId}`

export function hasSeenClientTour(clientId: string): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(STORAGE_KEY(clientId)) === 'true'
}

export function markClientTourSeen(clientId: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY(clientId), 'true')
}

/** Run the 5-step welcome tour. Caller controls when (welcome card "Take
 *  the tour" button, or Resources "Replay tour" link). Marks the tour
 *  as seen on completion OR skip so the welcome card stops auto-showing. */
export function runClientTour(clientId: string): void {
  const tour = driver({
    showProgress: true,
    progressText: 'Step {{current}} of {{total}}',
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    overlayOpacity: 0.6,
    onDestroyed: () => markClientTourSeen(clientId),
    steps: [
      {
        popover: {
          title: 'Welcome to your Client Portal',
          description:
            "Quick walk-through (less than a minute) of where things live. You can replay this anytime from the Resources page.",
        },
      },
      {
        element: '[data-tour="dashboard"]',
        popover: {
          title: 'Dashboard',
          description:
            "Your KPIs at a glance. Once you start logging weekly entries, this is where you'll see trends, pace toward goals, and color-coded status. Toggle between Weekly, MTD, QTD, and YTD views.",
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="entry"]',
        popover: {
          title: 'Weekly Entry',
          description:
            "This is the main action. Each week, click here to log your numbers. It only takes a few minutes once you know your KPIs.",
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="budget"]',
        popover: {
          title: 'Budget & Goals',
          description:
            "Your annual targets and how they break down across the year. Your coach sets these with you. Review anytime to see what you're working toward.",
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="history"]',
        popover: {
          title: 'History',
          description:
            "Every week you've logged, side-by-side. Useful for spotting trends and explaining changes to your coach.",
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="resources"]',
        popover: {
          title: 'Resources',
          description:
            "KPI glossary, reference docs, and the place to replay this tour. Visit when something isn't clear.",
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="settings"]',
        popover: {
          title: 'Settings',
          description:
            "Manage your password, contact info, weekly reminder emails, and other account preferences.",
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="message"]',
        popover: {
          title: 'Message your coach',
          description:
            "Have a question? Send your coach a message anytime. Their reply lands in your email inbox.",
          side: 'bottom',
          align: 'end',
        },
      },
      {
        popover: {
          title: "You're all set",
          description:
            "Start by clicking Weekly Entry to log your first week's numbers. We'll take it from there.",
        },
      },
    ],
  })

  tour.drive()
}
