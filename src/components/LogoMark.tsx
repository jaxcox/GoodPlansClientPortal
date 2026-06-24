import { useState } from 'react'

/** Brand logo image with graceful fallback. Sourced from a static
 *  asset at /logo.png (drop your file in public/logo.png). If the file
 *  is missing or fails to load, the image hides itself and the caller's
 *  text-only fallback (rendered alongside) carries the brand identity.
 *
 *  Sized via Tailwind classes so callers can pick "small" (header chip)
 *  or "large" (login screen). h-* alone — width auto-scales from the
 *  image's intrinsic aspect ratio so wordmarks and square marks both
 *  render correctly without distortion. */
export function LogoMark({ size = 'sm' }: { size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  // 'sm' = header chip (48px) — large enough for the dense wordmark
  // inside the circle to read. 'md' = enlarged admin header (96px).
  // 'lg' = login screen (112px), big enough to read the letterforms clearly.
  const h = size === 'lg' ? 'h-28' : size === 'md' ? 'h-24' : 'h-12'
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden
      className={`${h} w-auto`}
      onError={() => setFailed(true)}
    />
  )
}
