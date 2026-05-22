import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useDirtyConfirm } from '../lib/dirtyGuard'
import type { Client } from '../lib/types'
import { SettingsPage } from '../components/SettingsPage'
import { BudgetGoalsPage } from '../components/BudgetGoalsPage'
import { WeeklyEntryPage } from '../components/WeeklyEntryPage'
import { WeeklyDashboard } from '../components/WeeklyDashboard'
import { HistoryPage } from '../components/HistoryPage'
import { ForceChangePasswordPage } from '../components/ForceChangePasswordPage'

type Props = {
  clientId: string
  coachView: boolean
  onBack?: () => void
}

type NavTab = 'dashboard' | 'entry' | 'budget' | 'history' | 'settings'

export function ClientPortal({ clientId, coachView, onBack }: Props) {
  const { signOut, coach } = useAuth()
  const confirmLeave = useDirtyConfirm()
  const [client, setClient] = useState<Client | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<NavTab>('dashboard')

  const reloadClient = async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .maybeSingle()
    if (error || !data) {
      setError(error?.message ?? 'Client not found')
      return
    }
    setClient(data as Client)
  }

  /** Guarded tab change — prompts if the current page has unsaved edits. */
  const guardedSetTab = (next: NavTab) => {
    if (tab === next) return
    if (!confirmLeave()) return
    setTab(next)
  }
  const guardedBack = () => {
    if (!confirmLeave()) return
    onBack?.()
  }
  const guardedSignOut = () => {
    if (!confirmLeave()) return
    signOut()
  }

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
      <div className="min-h-screen flex items-center justify-center bg-[#dad7c5] text-sm text-black">
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
      <div className="min-h-screen flex items-center justify-center bg-[#dad7c5] text-sm text-black">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#dad7c5] flex flex-col">
      {/* Top bar — client name primary, brand to footer (per Doc 03 PC).
          When a force-change-password is required, the nav links are
          suppressed so the client can't navigate around the interstitial.
          Logout / Back stays available. */}
      <header className="sticky top-0 z-30 bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex justify-between items-center flex-wrap gap-2">
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
        <div className="flex items-center gap-1 text-sm sm:text-xs flex-wrap">
          {!(client.must_change_password && !coachView) && (
            <>
              <NavLink active={tab === 'dashboard'} onClick={() => guardedSetTab('dashboard')}>Dashboard</NavLink>
              <NavLink active={tab === 'entry'} onClick={() => guardedSetTab('entry')}>Weekly Entry</NavLink>
              <NavLink active={tab === 'budget'} onClick={() => guardedSetTab('budget')}>Budget &amp; Goals</NavLink>
              <NavLink active={tab === 'history'} onClick={() => guardedSetTab('history')}>History</NavLink>
              <NavLink active={tab === 'settings'} onClick={() => guardedSetTab('settings')}>Settings</NavLink>
            </>
          )}
          {client.shared_folder_link && (
            <a
              href={client.shared_folder_link}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-accent text-black font-bold border border-accent px-3 py-2 sm:py-1 rounded ml-2 hover:brightness-95"
              title={`Open ${client.company_name}'s shared folder`}
            >
              Shared Drive ↗
            </a>
          )}
          {coachView ? (
            <button
              type="button"
              onClick={guardedBack}
              className="bg-surface-2 text-white border border-line px-3 py-2 sm:py-1 rounded ml-2 hover:bg-surface-1"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              onClick={guardedSignOut}
              className="bg-surface-2 text-white border border-line px-3 py-2 sm:py-1 rounded ml-2 hover:bg-surface-1"
            >
              Logout
            </button>
          )}
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {client.must_change_password && !coachView ? (
          <ForceChangePasswordPage
            clientId={clientId}
            email={client.email}
            onChanged={reloadClient}
          />
        ) : tab === 'settings' ? (
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
            onLeave={() => {
              if (coachView && onBack) {
                onBack()
              } else {
                setTab('dashboard')
              }
            }}
          />
        ) : tab === 'entry' ? (
          <WeeklyEntryPage
            clientId={clientId}
            onLeave={() => {
              if (coachView && onBack) {
                onBack()
              } else {
                setTab('dashboard')
              }
            }}
          />
        ) : tab === 'dashboard' ? (
          <WeeklyDashboard clientId={clientId} coachView={coachView} />
        ) : tab === 'history' ? (
          <HistoryPage clientId={clientId} />
        ) : (
          <Body tab={tab} />
        )}
      </main>

      {/* Footer — brand mark per Doc 03 PC */}
      <footer className="text-center text-xs text-black py-4">
        Powered by{' '}
        <span className="font-brand font-bold">
          {coach?.brand_name ?? 'The Good Plans Co'}
        </span>
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
      className={`px-2 py-2 sm:py-1 ${
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
    dashboard: '',
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
