import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { Client } from '../lib/types'
import { NewClientModal } from '../components/NewClientModal'

type Tab = 'clients' | 'industries'
type ClientFilter = 'active' | 'archived'

type Props = {
  onViewPortal: (clientId: string) => void
}

export function CoachAdmin({ onViewPortal }: Props) {
  const { coach, profile, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('clients')
  const [clients, setClients] = useState<Client[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = async () => {
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) {
      setLoadError(error.message)
      setClients([])
    } else {
      setLoadError(null)
      setClients((data ?? []) as Client[])
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const brandName = coach?.brand_name ?? 'Portal'

  return (
    <div className="min-h-screen bg-[#f5f3ec]">
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

      <nav className="bg-white border-b border-gray-100 px-6 flex gap-5">
        <TabButton active={tab === 'clients'} onClick={() => setTab('clients')}>
          Clients
        </TabButton>
        <TabButton active={tab === 'industries'} onClick={() => setTab('industries')}>
          Industries
        </TabButton>
      </nav>

      <main className="max-w-5xl mx-auto p-6">
        {tab === 'clients' ? (
          <ClientsTab
            clients={clients}
            error={loadError}
            onChange={refresh}
            onViewPortal={onViewPortal}
          />
        ) : (
          <IndustriesTab />
        )}
      </main>
    </div>
  )
}

function TabButton({
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
      className={`text-xs py-2.5 ${
        active
          ? 'font-bold text-ink border-b-2 border-accent -mb-px'
          : 'text-gray-600'
      }`}
    >
      {children}
    </button>
  )
}

function ClientsTab({
  clients,
  error,
  onChange,
  onViewPortal,
}: {
  clients: Client[] | null
  error: string | null
  onChange: () => void
  onViewPortal: (clientId: string) => void
}) {
  const [filter, setFilter] = useState<ClientFilter>('active')
  const [modalOpen, setModalOpen] = useState(false)

  const active = (clients ?? []).filter((c) => !c.archived)
  const archived = (clients ?? []).filter((c) => c.archived)
  const visible = filter === 'active' ? active : archived

  return (
    <section>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-ink text-base font-bold">My Clients</h1>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95"
        >
          + New Client
        </button>
      </div>

      <div className="inline-flex border border-gray-300 rounded overflow-hidden text-xs mb-4">
        <FilterButton
          active={filter === 'active'}
          onClick={() => setFilter('active')}
          count={active.length}
        >
          Active
        </FilterButton>
        <FilterButton
          active={filter === 'archived'}
          onClick={() => setFilter('archived')}
          count={archived.length}
        >
          Archived
        </FilterButton>
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
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul className="space-y-2">
          {visible.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              onChange={onChange}
              onViewPortal={() => onViewPortal(c.id)}
            />
          ))}
        </ul>
      )}

      <NewClientModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={() => {
          setFilter('active')
          onChange()
        }}
      />
    </section>
  )
}

function FilterButton({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 ${
        active
          ? 'bg-ink text-accent font-bold'
          : 'bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {children} ({count})
    </button>
  )
}

function EmptyState({ filter }: { filter: ClientFilter }) {
  return (
    <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
      <div className="text-2xl mb-2">{filter === 'active' ? '📂' : '🗄️'}</div>
      <div className="text-white font-bold text-sm mb-1">
        {filter === 'active' ? 'No active clients yet' : 'No archived clients'}
      </div>
      <div className="text-mute text-xs">
        {filter === 'active'
          ? 'Click “+ New Client” to add your first.'
          : 'Archived clients live here.'}
      </div>
    </div>
  )
}

function ClientCard({
  client,
  onChange,
  onViewPortal,
}: {
  client: Client
  onChange: () => void
  onViewPortal: () => void
}) {
  const [busy, setBusy] = useState(false)

  const setArchived = async (archived: boolean) => {
    if (busy) return
    if (
      archived &&
      !confirm(
        `Archive ${client.company_name}? They won't be able to log in until restored. Their data is preserved.`
      )
    )
      return
    setBusy(true)
    const { error } = await supabase
      .from('clients')
      .update({ archived })
      .eq('id', client.id)
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    onChange()
  }

  return (
    <li className="bg-ink border border-line rounded-lg p-4 flex justify-between items-start gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-white font-bold text-sm mb-1">
          {client.company_name}
        </div>
        <div className="text-mute text-xs mb-2">
          {[client.contact_name, client.email].filter(Boolean).join(' · ') ||
            '—'}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill activated={client.activated} archived={client.archived} />
          {!client.activated && client.invite_code && (
            <span className="bg-line text-white rounded px-2 py-0.5 text-[10px] font-mono">
              Code: {client.invite_code}
            </span>
          )}
        </div>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onViewPortal}
          className="bg-accent text-black text-[11px] font-bold px-3 py-1.5 rounded hover:brightness-95"
        >
          View Portal
        </button>
        {client.archived ? (
          <button
            type="button"
            onClick={() => setArchived(false)}
            disabled={busy}
            className="bg-transparent text-good border border-good text-[11px] font-bold px-3 py-1.5 rounded hover:bg-good/10 disabled:opacity-50"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setArchived(true)}
            disabled={busy}
            className="bg-transparent text-bad-soft border border-bad-soft text-[11px] font-bold px-3 py-1.5 rounded hover:bg-bad/10 disabled:opacity-50"
          >
            Archive
          </button>
        )}
      </div>
    </li>
  )
}

function StatusPill({
  activated,
  archived,
}: {
  activated: boolean
  archived: boolean
}) {
  if (archived) {
    return (
      <span className="bg-line text-mute rounded px-2 py-0.5 text-[10px] font-semibold">
        Archived
      </span>
    )
  }
  if (activated) {
    return (
      <span className="bg-line text-good rounded px-2 py-0.5 text-[10px] font-semibold">
        Active
      </span>
    )
  }
  return (
    <span className="bg-line text-mute rounded px-2 py-0.5 text-[10px] font-semibold">
      Pending
    </span>
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
          Once you start creating clients, industries become the next thing.
        </div>
      </div>
    </section>
  )
}
