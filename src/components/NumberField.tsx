import { useEffect, useState } from 'react'

type Format = 'count' | 'dollars' | 'percent'

type Props = {
  value: number | undefined
  onChange: (n: number | undefined) => void
  format: Format
  placeholder?: string
  className?: string
  /** Override the default min — defaults to 0 (no negatives). Pass null for unbounded. */
  min?: number | null
  /** Override the default max — defaults to 100 for percent, otherwise unbounded. Pass null for unbounded. */
  max?: number | null
  ariaLabel?: string
  /** Visual treatment. 'dark' (default) = bg-surface-2 + white text;
   *  'light' = bg-white + black text (for cards on light surfaces). */
  tone?: 'dark' | 'light'
}

/**
 * Numeric input that:
 *   - Always shows $ prefix for `dollars`, % suffix for `percent`
 *   - Formats with thousands separators on blur (and on external value changes)
 *   - Lets the user type freely while focused — no mid-typing reformatting
 *   - Stores numeric state internally; emits `number | undefined` to the parent
 */
export function NumberField({
  value,
  onChange,
  format,
  placeholder,
  className = '',
  min,
  max,
  ariaLabel,
  tone = 'dark',
}: Props) {
  const [display, setDisplay] = useState(() => formatForDisplay(value, format))
  const [focused, setFocused] = useState(false)

  // Sync display when the parent's value changes externally (e.g. Cancel
  // resetting the form). Skipped while the field is focused so we don't
  // stomp on what the user is mid-typing.
  useEffect(() => {
    if (!focused) {
      setDisplay(formatForDisplay(value, format))
    }
  }, [value, format, focused])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    setDisplay(raw)
    const parsed = parseInput(raw)
    if (parsed === undefined) {
      onChange(undefined)
      return
    }
    const clamped = clamp(parsed, format, min, max)
    onChange(clamped)
  }

  const handleBlur = () => {
    setFocused(false)
    setDisplay(formatForDisplay(value, format))
  }

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setFocused(true)
    // Strip $ / % / commas while editing so the user can fluently re-type.
    setDisplay(rawFromValue(value))
    // Select-all so a quick re-type doesn't require Cmd-A first
    requestAnimationFrame(() => e.target.select())
  }

  const prefix = format === 'dollars' ? '$' : null
  const suffix = format === 'percent' ? '%' : null
  const padLeft = prefix ? 'pl-6' : 'pl-3'
  const padRight = suffix ? 'pr-6' : 'pr-3'

  const inputClasses =
    tone === 'light' ? 'bg-white text-black' : 'bg-surface-2 text-white'
  const fixText = tone === 'light' ? 'text-black' : 'text-white'
  // Light tone gets a thicker yellow ring so the "fillable" affordance reads
  // strongly against the dark card background.
  const borderWidth = tone === 'light' ? 'border-4' : 'border'

  return (
    <div className="relative">
      {prefix && (
        <span
          className={`pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm ${fixText}`}
        >
          {prefix}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={handleFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={`w-full ${inputClasses} ${borderWidth} border-accent rounded text-sm py-2 ${padLeft} ${padRight} focus:outline-none focus:border-accent ${className}`}
      />
      {suffix && (
        <span
          className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm ${fixText}`}
        >
          {suffix}
        </span>
      )}
    </div>
  )
}

// ----------------------------------------------------------------------------

function clamp(
  n: number,
  format: Format,
  min: number | null | undefined,
  max: number | null | undefined
): number {
  let lo: number | null = min === undefined ? 0 : min
  let hi: number | null =
    max === undefined ? (format === 'percent' ? 100 : null) : max
  if (lo !== null && n < lo) n = lo
  if (hi !== null && n > hi) n = hi
  return n
}

function formatForDisplay(
  value: number | undefined,
  format: Format
): string {
  if (value === undefined || Number.isNaN(value)) return ''
  if (format === 'dollars') {
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
  if (format === 'percent') {
    // Allow up to 1 decimal place for percent inputs (e.g. 87.5%)
    return Number.isInteger(value)
      ? value.toString()
      : value.toFixed(1)
  }
  // count: integer with thousands separators
  return value.toLocaleString('en-US')
}

function rawFromValue(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return ''
  return Number.isInteger(value) ? value.toString() : value.toString()
}

function parseInput(raw: string): number | undefined {
  const cleaned = raw.replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return undefined
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : undefined
}
