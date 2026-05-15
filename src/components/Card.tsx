import { useState, type ReactNode } from 'react'
import { InfoIcon } from './InfoIcon'

type Props = {
  title: string
  children: ReactNode
  /** Optional explicit key for remembering the collapsed state across
   *  in-app navigation. Defaults to the title — pass an explicit id if
   *  two cards share the same title or if the title can change. */
  id?: string
  /** Optional tooltip rendered as an InfoIcon next to the title. */
  info?: string
  /** When true, the card sizes to its content rather than filling the
   *  column. Used on Utilization + Custom KPIs so the card stays narrow
   *  with few entries and grows as groups / KPIs are added. */
  fit?: boolean
}

// Module-level store: collapsed state keyed by card id (or title). Persists
// across in-SPA navigation (Card unmount/remount re-reads from this Map),
// resets on page reload. No localStorage by design.
const collapsedById = new Map<string, boolean>()

/** Hook for non-Card sections that want the same collapse behavior +
 *  shared persistence. Returns the current state and a toggle function. */
export function useCardCollapsed(key: string): {
  collapsed: boolean
  toggle: () => void
} {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => collapsedById.get(key) ?? false
  )
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    collapsedById.set(key, next)
  }
  return { collapsed, toggle }
}

// Shared dark "ink" card used across Settings, Budget & Goals, and Weekly
// Entry. Title separated from children by mb-4 when expanded; collapsed
// cards drop the gap so the header sits tight against the bottom padding.
export function Card({ title, children, id, info, fit = false }: Props) {
  const key = id ?? title
  const [collapsed, setCollapsed] = useState<boolean>(
    () => collapsedById.get(key) ?? false
  )
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    collapsedById.set(key, next)
  }
  return (
    <div
      className={`bg-ink border border-line rounded-lg p-5 ${fit ? 'w-fit max-w-full' : ''}`}
    >
      <div
        className={`flex items-center justify-between ${collapsed ? '' : 'mb-4'}`}
      >
        <h2 className="text-white text-base font-bold flex items-center gap-1.5">
          <span>{title}</span>
          {info && <InfoIcon text={info} />}
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          aria-expanded={!collapsed}
          className="w-6 h-6 flex items-center justify-center text-white text-base leading-none rounded hover:bg-surface-2 focus:outline-none focus:bg-surface-2"
        >
          {collapsed ? '+' : '−'}
        </button>
      </div>
      {!collapsed && <div className="space-y-3">{children}</div>}
    </div>
  )
}
