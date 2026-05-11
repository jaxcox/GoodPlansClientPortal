import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import type { ReactNode } from 'react'

// =============================================================================
// Dirty-leave guard
// -----------------------------------------------------------------------------
// Project rule: any page with a Save button must register its dirty state via
// useDirtyGuard(isDirty). Top-level navigation (tab clicks, Back, Logout)
// then calls confirmLeave() before switching, prompting if the page has
// unsaved edits. Browser-level close/refresh is also guarded via
// `beforeunload`.
//
// dirtyRef is intentionally not a state value — confirmLeave() needs to read
// the latest dirtiness synchronously inside an event handler, before any
// useEffect has had a chance to run.
// =============================================================================

type DirtyGuardCtx = {
  /** Set the current page's dirty state. Synchronous — safe to call right
   *  before triggering navigation to bypass the prompt (e.g. after the page's
   *  own Cancel button already confirmed the discard). */
  setDirty: (dirty: boolean) => void
  /** Returns true if user confirms leaving (or page is clean); false if the
   *  user chose to stay. Callers should only proceed with navigation when
   *  this returns true. */
  confirmLeave: () => boolean
}

const noopCtx: DirtyGuardCtx = {
  setDirty: () => {},
  confirmLeave: () => true,
}

const ctx = createContext<DirtyGuardCtx>(noopCtx)

export function DirtyGuardProvider({ children }: { children: ReactNode }) {
  const dirtyRef = useRef(false)

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty
  }, [])

  const confirmLeave = useCallback((): boolean => {
    if (!dirtyRef.current) return true
    return confirm(
      'You have unsaved changes. Leave without saving? Click OK to continue or Cancel to stay.'
    )
  }, [])

  // Browser-level guard: tab close, refresh, back-to-prior-site. The native
  // dialog wording is dictated by the browser; we just opt in by setting
  // returnValue (custom strings have been ignored by Chrome/Firefox/Safari
  // for years, so we don't bother).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const value = useMemo(
    () => ({ setDirty, confirmLeave }),
    [setDirty, confirmLeave]
  )

  return <ctx.Provider value={value}>{children}</ctx.Provider>
}

/** Page-level hook. Pass your page's isDirty boolean — the hook keeps the
 *  guard's ref in sync and returns the imperative setter for cases like
 *  Cancel buttons that have already confirmed the discard and want to skip
 *  the central prompt. */
export function useDirtyGuard(isDirty: boolean): (dirty: boolean) => void {
  const { setDirty } = useContext(ctx)
  useEffect(() => {
    setDirty(isDirty)
    return () => setDirty(false)
  }, [isDirty, setDirty])
  return setDirty
}

/** Navigation-level hook. Returns confirmLeave — call it before any leave
 *  action (setTab, onBack, signOut). Returns true to proceed, false to stay. */
export function useDirtyConfirm(): () => boolean {
  return useContext(ctx).confirmLeave
}
