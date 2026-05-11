/**
 * Auto-format US phone input as the user types.
 * Output shape: `(XXX)XXX-XXXX`. Strips all non-digits, caps at 10 digits,
 * and progressively builds the formatted string.
 *
 *   ''            → ''
 *   '5'           → '(5'
 *   '555'         → '(555'
 *   '5551212'     → '(555)121-2'
 *   '5551212345'  → '(555)121-2345'
 *
 * Click-to-call links should re-strip non-digits via
 *   `tel:${phone.replace(/[^0-9+]/g, '')}`
 * so the formatter and the dialer link stay decoupled.
 */
export function formatPhone(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)})${digits.slice(3)}`
  return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`
}
