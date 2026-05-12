import { useState } from 'react'

type Props = {
  /** Tooltip body. Plain text; line breaks ignored. */
  text: string
  className?: string
}

// Small info icon (ⓘ) that reveals a dark Tailwind tooltip on hover, focus,
// or tap. Used to surface KPI descriptions from src/lib/kpis.ts next to
// KPI labels in Settings, KPI Goals, and Weekly Entry. Tooltip renders
// above the icon; if your label sits near the top of a scroll container
// the bubble may clip — fine for now since KPI labels sit inside cards.
export function InfoIcon({ text, className = '' }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label="More info"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault()
          setOpen((o) => !o)
        }}
        className="inline-flex items-center justify-center w-3.5 h-3.5 text-mute hover:text-accent focus:text-accent cursor-help focus:outline-none"
      >
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor" aria-hidden>
          <path d="M8 0a8 8 0 100 16A8 8 0 008 0zM7 4a1 1 0 112 0 1 1 0 01-2 0zm0 3h2v6H7V7z" />
        </svg>
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 bg-ink border border-accent rounded text-white text-xs p-2 shadow-lg leading-relaxed text-left normal-case font-normal tracking-normal"
        >
          {text}
          <span
            aria-hidden
            className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 w-2 h-2 bg-ink border-r border-b border-accent rotate-45"
          />
        </span>
      )}
    </span>
  )
}
