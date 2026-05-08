import { useState } from 'react'

type Props = {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  autoComplete?: string
  hint?: string
  /**
   * Optional shared visibility state — when provided, the eye toggle inside
   * this field controls visibility for all sibling PasswordFields in the form.
   */
  visibility?: { show: boolean; toggle: () => void }
}

export function PasswordField({
  label,
  value,
  onChange,
  required,
  autoComplete = 'new-password',
  hint,
  visibility,
}: Props) {
  const [localShow, setLocalShow] = useState(false)
  const show = visibility ? visibility.show : localShow
  const toggle = visibility ? visibility.toggle : () => setLocalShow((s) => !s)

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          className="w-full bg-white border-2 border-accent ring-1 ring-inset ring-black rounded text-black text-sm pl-3 pr-10 py-2 focus:outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          title={show ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-white hover:text-white p-1"
        >
          {show ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {hint && <div className="text-xs text-white mt-1">{hint}</div>}
    </div>
  )
}

function EyeIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}
