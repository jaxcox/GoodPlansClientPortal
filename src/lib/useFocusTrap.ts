import { useEffect, useRef } from 'react'

/**
 * Keyboard focus trap for modals + similar overlay surfaces.
 *
 * When `active` flips to true:
 *   1. Records whatever element was focused before the modal opened
 *      so it can be restored on close.
 *   2. Focuses the first focusable element inside the container (so
 *      keyboard users start "inside" the modal instead of behind it).
 *   3. Intercepts Tab / Shift+Tab and wraps focus around within the
 *      container — keyboard users can't tab out to the dimmed page
 *      underneath, which they can neither see nor interact with.
 *
 * When `active` flips back to false (modal closes / unmounts):
 *   - Restores focus to the previously-focused element so the
 *     keyboard user lands back on the trigger button / link.
 *
 * Returns a ref the caller attaches to the modal's container element.
 *
 * Notes:
 * - Escape key is the caller's responsibility (most of our modals
 *   already wire it). This hook only handles Tab wrapping + focus
 *   restoration.
 * - Click-outside-to-close still works because we don't capture other
 *   keys or mouse events.
 */
export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!active) return
    const container = ref.current
    if (!container) return

    // Remember the element that was focused right before the modal
    // opened so we can restore it on close.
    previousFocus.current = document.activeElement as HTMLElement | null

    // Focus the first focusable element inside the modal so keyboard
    // users start there. Defer to the next tick so React has
    // committed the DOM and the focus target actually exists.
    const queueFocus = () => {
      const first = getFocusables(container)[0]
      if (first) first.focus()
    }
    const raf = requestAnimationFrame(queueFocus)

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const focusables = getFocusables(container)
      if (focusables.length === 0) {
        e.preventDefault()
        return
      }
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !container.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || !container.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      // Restore focus to the trigger element if it's still in the DOM
      // and still focusable. If the trigger is gone (component
      // re-rendered, etc.), do nothing.
      const prev = previousFocus.current
      if (prev && document.contains(prev) && typeof prev.focus === 'function') {
        prev.focus()
      }
    }
  }, [active])

  return ref
}

/** Find the focusable descendants of `root`, in document order. Skips
 *  hidden, disabled, and tabindex=-1 elements. */
function getFocusables(root: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  const nodes = root.querySelectorAll<HTMLElement>(selector)
  return Array.from(nodes).filter(
    (el) => !el.hasAttribute('inert') && el.offsetParent !== null
  )
}
