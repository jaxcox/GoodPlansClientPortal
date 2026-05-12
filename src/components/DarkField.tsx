type Props = {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
  required?: boolean
  hint?: string
}

// Labeled text input used on every dark-card form (Settings, Coach Account).
// Editable: white bg with yellow accent ring per the field-treatment rule.
// Disabled: dark surface with thin yellow border — reads as "derived/read-only".
export function DarkField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  required,
  hint,
}: Props) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider text-white mb-1">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        className={`w-full rounded text-sm px-3 py-2 focus:outline-none ${
          disabled
            ? 'bg-surface-2 border-[0.5px] border-accent text-white cursor-not-allowed'
            : 'bg-white border-2 border-accent ring-1 ring-inset ring-black text-black focus:border-accent'
        }`}
      />
      {hint && <div className="text-xs text-white mt-1">{hint}</div>}
    </div>
  )
}
