import type { ReactNode } from 'react'

type Props = {
  title: string
  children: ReactNode
}

// Shared dark "ink" card used across Settings, Budget & Goals, and Weekly
// Entry. Title separated from children by mb-4; child rows gap at space-y-3.
export function Card({ title, children }: Props) {
  return (
    <div className="bg-ink border border-line rounded-lg p-5">
      <h2 className="text-white text-sm font-bold mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}
