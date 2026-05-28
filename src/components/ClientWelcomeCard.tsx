import { runClientTour, markClientTourSeen } from '../lib/clientTour'

type Props = {
  clientId: string
  /** Brand name pulled from the coach record for the greeting. Falls
   *  back to "your coach" when not set. */
  coachBrandName?: string | null
  /** Called when the client dismisses the card (Take tour OR Skip) so
   *  the parent can re-render without it. The clientTour module also
   *  writes a localStorage flag so future sessions stay dismissed. */
  onDismiss: () => void
  /** Called when the client clicks the "Log your first weekly entry"
   *  checklist item — parent navigates to the Weekly Entry tab. The
   *  card also marks the tour as seen so it doesn't reappear next
   *  visit (client jumped right into the action, no walkthrough
   *  needed). */
  onGoToWeeklyEntry: () => void
}

/** First-time-client welcome card. Renders on the ClientPortal when
 *  the client hasn't completed onboarding yet. Three-step checklist
 *  shows what's next; "Take the tour" fires the Driver.js walkthrough;
 *  "Skip" hides the card without triggering it.
 *
 *  Either action marks the tour as seen (localStorage), so this card
 *  doesn't render on subsequent sign-ins. Clients can replay the tour
 *  from the Resources page. */
export function ClientWelcomeCard({
  clientId,
  coachBrandName,
  onDismiss,
  onGoToWeeklyEntry,
}: Props) {
  const onTake = () => {
    runClientTour(clientId)
    onDismiss()
  }
  const onSkip = () => {
    markClientTourSeen(clientId)
    onDismiss()
  }
  const onLogEntry = () => {
    markClientTourSeen(clientId)
    onDismiss()
    onGoToWeeklyEntry()
  }

  const brand = coachBrandName?.trim() || 'your coach'

  return (
    <div className="bg-ink border border-line rounded-xl p-6 mb-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-white text-xl font-bold mb-2">
            Welcome to your Client Portal
          </h2>
          <p className="text-white text-sm mb-4 leading-relaxed">
            This is where you'll log your numbers each week and track your
            progress with {brand}. A quick walk-through helps you get
            oriented.
          </p>

          <ul className="space-y-1.5 mb-5 text-white text-sm">
            <li className="flex items-center gap-2">
              <span className="text-accent font-bold">✓</span>
              <span>Activate your account</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex justify-center w-4 text-mute">
                ◯
              </span>
              <span>Take the tour (1 minute)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="inline-flex justify-center w-4 text-mute">
                ◯
              </span>
              <button
                type="button"
                onClick={onLogEntry}
                className="text-white underline underline-offset-4 hover:text-accent text-left"
              >
                Log your first weekly entry
              </button>
            </li>
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTake}
              className="bg-accent text-black font-bold px-4 py-2 rounded text-sm hover:brightness-95"
            >
              Take the tour
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="bg-transparent text-white border border-mute font-semibold px-4 py-2 rounded text-sm hover:bg-white/10"
            >
              Skip for now
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
