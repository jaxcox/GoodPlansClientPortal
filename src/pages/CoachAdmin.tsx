import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Client } from '../lib/types'

type Tab = 'clients' | 'industries'

export function CoachAdmin() {
  const { coach, profile, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('clients')
  const [clients, setClients] = useState<Client[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (error) {
        setLoadError(error.message)
        setClients([])
      } else {
        setClients((data ?? []) as Client[])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const brandName = coach?.brand_name ?? 'Portal'

  return (
    <div className="min-h-screen bg-[#f5f3ec]">
      {/* Top bar */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center">
        <div>
          <span className="text-base font-extrabold text-ink">{brandName}</span>
          <span className="text-xs text-gray-500 ml-3">Admin Panel</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500">
            {profile?.display_name ?? 'Coach'}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="bg-surface-2 text-white border border-line px-3 py-1.5 rounded hover:bg-surface-1"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Sub-nav */}
      <nav className="bg-white border-b border-gray-100 px-6 flex gap-5">
        <button
          type="button"
          onClick={() => setTab('clients')}
          className={`text-xs py-2.5 ${
            tab === 'clients'
              ? 'font-bold text-ink border-b-2 border-accent -mb-px'
              : 'text-gray-600'
          }`}
        >
          Clients
        </button>
        <button
          type="button"
          onClick={() => setTab('industries')}
          className={`text-xs py-2.5 ${
            tab === 'industries'
              ? 'font-bold text-ink border-b-2 border-accent -mb-px'
              : 'text-gray-600'
          }`}
        >
          Industries
        </button>
      </nav>

      {/* Body */}
      <main className="max-w-5xl mx-auto p-6">
        {tab === 'clients' ? (
          <ClientsTab clients={clients} error={loadError} />
        ) : (
          <IndustriesTab />
        )}
      </main>
    </div>
  )
}

function ClientsTab({
  clients,
  error,
}: {
  clients: Client[] | null
  error: string | null
}) {
  return (
    <section>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-ink text-base font-bold">
          My Clients ({clients?.length ?? 0})
        </h1>
        <button
          type="button"
          disabled
          className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold opacity-50 cursor-not-allowed"
          title="Adding new clients lands in Phase 2"
        >
          + New Client
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3 mb-4">
          {error}
        </div>
      )}

      {clients === null ? (
        <div className="bg-white border border-gray-200 rounded p-6 text-sm text-gray-500">
          Loading…
        </div>
      ) : clients.length === 0 ? (
        <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
          <div className="text-2xl mb-2">📂</div>
          <div className="text-white font-bold text-sm mb-1">No clients yet</div>
          <div className="text-mute text-xs">
            Phase 2 will add the “New Client” flow.
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li
              key={c.id}
              className="bg-ink border border-line rounded p-4 text-white text-sm"
            >
              {c.company_name}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function IndustriesTab() {
  return (
    <section>
      <h1 className="text-ink text-base font-bold mb-2">Custom Industries</h1>
      <p className="text-gray-500 text-xs mb-6">
        Define industries and their default KPI sets for new clients.
      </p>
      <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
        <div className="text-2xl mb-2">🏭</div>
        <div className="text-white font-bold text-sm mb-1">
          Industries land in Phase 3
        </div>
        <div className="text-mute text-xs">
          Once you start creating clients (Phase 2), industries become the next thing.
        </div>
      </div>
    </section>
  )
}
