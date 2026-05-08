import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Client } from '../lib/types'
import { SettingsPage } from '../components/SettingsPage'
import { BudgetGoalsPage } from '../components/BudgetGoalsPage'

type Props = {
  clientId: string
  coachView: boolean
  onBack?: () => void
}

type NavTab = 'dashboard' | 'entry' | 'budget' | 'history' | 'settings'

export function ClientPortal({ clientId, coachView, onBack }: Props) {
  const { signOut, coach } = useAuth()
  const [client, setClient] = useState<Client | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<NavTab>('dashboard')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .maybeSingle()
      if (cancelled) return
      if (error || !data) {
        setError(error?.message ?? 'Client not found')
        return
      }
      setClient(data as Client)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] text-sm text-black">
        <div className="text-center">
          <div className="font-bold mb-2">Couldn't load client</div>
          <div className="text-xs text-black mb-4">{error}</div>
          {coachView && onBack && (
            <button
              type="button"
              onClick={onBack}
              className="bg-ink text-white px-4 py-2 rounded text-xs"
            >
              Back to Coach Admin
            </button>
          )}
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f3ec] text-sm text-black">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f3ec] flex flex-col">
      {/* Top bar — client name primary, brand to footer (per Doc 03 PC) */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-base font-extrabold text-ink">
            {client.company_name}
          </span>
          {coachView && (
            <span className="bg-ink text-white border border-line rounded px-2 py-0.5 text-xs font-bold">
              COACH VIEW
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs flex-wrap">
          <NavLink active={tab === 'dashboard'} onClick={() => setTab('dashboard')}>Dashboard</NavLink>
          <NavLink active={tab === 'entry'} onClick={() => setTab('entry')}>Weekly Entry</NavLink>
          <NavLink active={tab === 'budget'} onClick={() => setTab('budget')}>Budget &amp; Goals</NavLink>
          <NavLink active={tab === 'history'} onClick={() => setTab('history')}>History</NavLink>
          <NavLink active={tab === 'settings'} onClick={() => setTab('settings')}>Settings</NavLink>
          {client.shared_folder_link && (
            <a
              href={client.shared_folder_link}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-transparent text-ink border border-gray-300 px-3 py-1 rounded ml-2 hover:bg-gray-50"
              title={`Open ${client.company_name}'s shared folder`}
            >
              Shared Drive ↗
            </a>
          )}
          {coachView ? (
            <button
              type="button"
              onClick={onBack}
              className="bg-surface-2 text-white border border-line px-3 py-1 rounded ml-2 hover:bg-surface-1"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={signOut}
              className="bg-surface-2 text-white border border-line px-3 py-1 rounded ml-2 hover:bg-surface-1"
            >
              Logout
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
        {tab === 'settings' ? (
          <SettingsPage
            clientId={clientId}
            coachView={coachView}
            onLeave={() => {
              if (coachView && onBack) {
                onBack()
              } else {
                setTab('dashboard')
              }
            }}
          />
        ) : tab === 'budget' ? (
          <BudgetGoalsPage
            clientId={clientId}
            coachView={coachView}
            onLeave={() => {
              if (coachView && onBack) {
                onBack()
              } else {
                setTab('dashboard')
              }
            }}
          />
        ) : (
          <Body tab={tab} />
        )}
      </main>

      {/* Footer — brand mark per Doc 03 PC */}
      <footer className="text-center text-xs text-black py-4">
        Powered by {coach?.brand_name ?? 'The Good Plans Co'}
      </footer>
    </div>
  )
}

function NavLink({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2 py-0.5 ${
        active ? 'font-bold text-ink border-b-2 border-accent' : 'text-black'
      }`}
    >
      {children}
    </button>
  )
}

function Body({ tab }: { tab: NavTab }) {
  const titles: Record<NavTab, string> = {
    dashboard: 'Performance Dashboard',
    entry: 'Weekly Entry',
    budget: 'Budget & Goals',
    history: 'History',
    settings: 'Company Settings',
  }
  const subtitles: Record<NavTab, string> = {
    dashboard: 'No entries yet — Weekly Dashboard lands in Phase 5.',
    entry: 'Weekly Entry form lands in Phase 5.',
    budget: '',
    history: 'History view lands in Phase 7.',
    settings: '',
  }
  return (
    <section>
      <h1 className="text-lg font-bold text-ink mb-1">{titles[tab]}</h1>
      <p className="text-sm text-black mb-6">{subtitles[tab]}</p>
      <div className="bg-white border border-gray-200 rounded-lg p-10 text-center text-sm text-black">
        Coming soon.
      </div>
    </section>
  )
}
