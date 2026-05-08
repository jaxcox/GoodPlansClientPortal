import { useRef, useState } from 'react'
import { applyKpiToggle } from './kpis'

/**
 * Small hook that wraps the dependency-cascade logic from Doc 04 PC #9 with
 * confirmation prompts and a transient feedback banner. Returns a handler that
 * pages plug into Toggle's onChange, plus the current feedback message.
 */
export function useKpiToggle(
  defaults: Record<string, number>,
  setDefaults: (d: Record<string, number>) => void
) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setFeedback(null), 4000)
  }

  const onToggle = (kpiId: string, on: boolean) => {
    let result = applyKpiToggle(defaults, kpiId, on)

    if (result.kind === 'requiresConfirm') {
      const labels = result.dependents.map((d) => d.label).join(', ')
      const ok = confirm(
        `Disabling ${result.kpi.label} will also disable: ${labels}.\n\nContinue?`
      )
      if (!ok) return
      result = applyKpiToggle(defaults, kpiId, false, { confirmed: true })
      if (result.kind !== 'applied') return // type guard
    }

    setDefaults(result.defaults)
    if (result.autoEnabled.length > 0) {
      showFeedback(`Also enabled: ${result.autoEnabled.join(', ')}`)
    } else if (result.autoDisabled.length > 0) {
      showFeedback(`Also disabled: ${result.autoDisabled.join(', ')}`)
    }
  }

  return { onToggle, feedback }
}
