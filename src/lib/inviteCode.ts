// Generates 6-character invite codes. Uppercase letters + digits, omitting
// the ambiguous characters I, O, 0, 1 so coaches don't read an O for a 0
// over the phone.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateInviteCode(length = 6): string {
  const arr = new Uint32Array(length)
  crypto.getRandomValues(arr)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += ALPHABET[arr[i] % ALPHABET.length]
  }
  return out
}
