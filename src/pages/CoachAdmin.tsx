import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { generateInviteCode } from '../lib/inviteCode'
import {
  isoDate,
  mostRecentCompletedWeekStart,
} from '../lib/week'
import type { Client, Industry } from '../lib/types'
import { ClientFormModal } from '../components/ClientFormModal'
import { IndustriesPage } from '../components/IndustriesPage'
import { ResetPasswordModal } from '../components/ResetPasswordModal'

type Tab = 'clients' | 'industries'
type ClientFilter = 'active' | 'pending' | 'archived'
type ClientSort = 'alpha-asc' | 'alpha-desc' | 'newest' | 'oldest'

type Props = {
  onViewPortal: (clientId: string) => void
}

export function CoachAdmin({ onViewPortal }: Props) {
  const { coach, profile, signOut } = useAuth()
  const [tab, setTab] = useState<Tab>('clients')
  const [clients, setClients] = useState<Client[] | null>(null)
  const [industries, setIndustries] = useState<Industry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Set of client IDs that have a weekly_entries row for the most recent
   *  completed week. Used to color the entry-status pill on each card. */
  const [lastWeekEntries, setLastWeekEntries] = useState<Set<string>>(
    () => new Set()
  )

  const refresh = async () => {
    const lastWeekIso = isoDate(mostRecentCompletedWeekStart())
    const [cRes, iRes, eRes] = await Promise.all([
      supabase
        .from('clients')
        .select('*')
        .order('created_at', { ascending: true }),
      supabase.from('industries').select('*').order('name'),
      supabase
        .from('weekly_entries')
        .select('client_id')
        .eq('week_start_date', lastWeekIso),
    ])
    if (cRes.error) {
      setLoadError(cRes.error.message)
      setClients([])
    } else {
      setLoadError(null)
      setClients((cRes.data ?? []) as Client[])
    }
    setIndustries((iRes.data ?? []) as Industry[])
    setLastWeekEntries(
      new Set(
        (eRes.data ?? []).map(
          (r) => (r as { client_id: string }).client_id
        )
      )
    )
  }

  const industryById = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of industries) m.set(i.id, i.name)
    return m
  }, [industries])

  useEffect(() => {
    refresh()
  }, [])

  const brandName = coach?.brand_name ?? 'Portal'

  return (
    <div className="min-h-screen bg-[#f5f3ec]">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex justify-between items-center">
        <div>
          <span className="text-base font-extrabold text-ink">{brandName}</span>
          <span className="text-xs text-black ml-3">Admin Panel</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-black">
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
            industryById={industryById}
            lastWeekEntries={lastWeekEntries}
            error={loadError}
            onChange={refresh}
            onViewPortal={onViewPortal}
          />
        ) : (
          <IndustriesPage />
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
          : 'text-black'
      }`}
    >
      {children}
    </button>
  )
}

function ClientsTab({
  clients,
  industryById,
  lastWeekEntries,
  error,
  onChange,
  onViewPortal,
}: {
  clients: Client[] | null
  industryById: Map<string, string>
  lastWeekEntries: Set<string>
  error: string | null
  onChange: () => void
  onViewPortal: (clientId: string) => void
}) {
  const [filter, setFilter] = useState<ClientFilter>('active')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ClientSort>('alpha-asc')
  const [modalState, setModalState] = useState<
    | { kind: 'closed' }
    | { kind: 'create' }
    | { kind: 'edit'; client: Client }
  >({ kind: 'closed' })
  const [resetClient, setResetClient] = useState<Client | null>(null)

  const active = (clients ?? []).filter((c) => !c.archived && c.activated)
  const pending = (clients ?? []).filter((c) => !c.archived && !c.activated)
  const archived = (clients ?? []).filter((c) => c.archived)
  const bucket =
    filter === 'active' ? active : filter === 'pending' ? pending : archived
  const q = search.trim().toLowerCase()
  const filtered = q
    ? bucket.filter((c) => c.company_name.toLowerCase().startsWith(q))
    : bucket
  const visible = useMemo(() => {
    const list = [...filtered]
    switch (sort) {
      case 'alpha-asc':
        return list.sort((a, b) =>
          a.company_name.localeCompare(b.company_name)
        )
      case 'alpha-desc':
        return list.sort((a, b) =>
          b.company_name.localeCompare(a.company_name)
        )
      case 'newest':
        return list.sort((a, b) => b.created_at.localeCompare(a.created_at))
      case 'oldest':
        return list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
  }, [filtered, sort])

  return (
    <section>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-ink text-base font-bold">My Clients</h1>
        <button
          type="button"
          onClick={() => setModalState({ kind: 'create' })}
          className="bg-accent text-black px-4 py-1.5 rounded text-xs font-bold hover:brightness-95"
        >
          + New Client
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex border border-gray-300 rounded overflow-hidden text-xs">
          <FilterButton
            active={filter === 'active'}
            onClick={() => setFilter('active')}
            count={active.length}
          >
            Active
          </FilterButton>
          <FilterButton
            active={filter === 'pending'}
            onClick={() => setFilter('pending')}
            count={pending.length}
          >
            Pending
          </FilterButton>
          <FilterButton
            active={filter === 'archived'}
            onClick={() => setFilter('archived')}
            count={archived.length}
          >
            Archived
          </FilterButton>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by company name…"
          className="flex-1 min-w-[12rem] max-w-sm bg-white border border-gray-300 rounded text-black text-xs px-3 py-1.5 focus:outline-none focus:border-gray-400"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ClientSort)}
          aria-label="Sort clients"
          className="select-yellow bg-white border border-gray-300 rounded text-black text-xs px-3 py-1.5 focus:outline-none focus:border-gray-400"
        >
          <option value="alpha-asc">Sort: A → Z</option>
          <option value="alpha-desc">Sort: Z → A</option>
          <option value="newest">Sort: Newest first</option>
          <option value="oldest">Sort: Oldest first</option>
        </select>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-sm rounded p-3 mb-4">
          {error}
        </div>
      )}

      {clients === null ? (
        <div className="bg-white border border-gray-200 rounded p-6 text-sm text-black">
          Loading…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} hasSearch={q.length > 0} />
      ) : (
        <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {visible.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              industryName={
                c.industry_id ? industryById.get(c.industry_id) ?? null : null
              }
              lastWeekEntered={lastWeekEntries.has(c.id)}
              onChange={onChange}
              onViewPortal={() => onViewPortal(c.id)}
              onEdit={() => setModalState({ kind: 'edit', client: c })}
              onResetPassword={() => setResetClient(c)}
            />
          ))}
        </ul>
      )}

      <ClientFormModal
        open={modalState.kind !== 'closed'}
        editing={modalState.kind === 'edit' ? modalState.client : null}
        onClose={() => setModalState({ kind: 'closed' })}
        onSaved={() => {
          if (modalState.kind === 'create') setFilter('active')
          onChange()
        }}
      />

      <ResetPasswordModal
        open={resetClient !== null}
        client={resetClient}
        onClose={() => setResetClient(null)}
        onReset={() => onChange()}
      />
    </section>
  )
}

/** Entry status pill — green "Current" when the most recent completed
 *  week has a weekly_entries row for this client, red "Overdue" when it
 *  doesn't. Red is intentional here (vs. the softer yellow used for
 *  "behind budget" financial states) — a missed weekly entry is a task
 *  that wasn't done, not a financial trailing indicator, so it warrants
 *  the more urgent treatment. White text on red per the project color
 *  rule (text-on-bg contrast). */
function EntryStatusPill({ entered }: { entered: boolean }) {
  if (entered) {
    return (
      <span className="bg-good text-black text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap shrink-0">
        Current
      </span>
    )
  }
  return (
    <span className="bg-bad text-white text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap shrink-0">
      Overdue
    </span>
  )
}

/* Inline SVG icons used as labels on the client card. fill="currentColor" +
 * text-accent applies the brand yellow; change `text-accent` on any of these
 * to recolor (e.g. text-white, text-good, etc.). */
const ICON_CLS = 'inline-block w-4 h-4 align-text-bottom text-accent'

function EmailIcon() {
  return (
    <svg
      role="img"
      aria-label="Email"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={ICON_CLS}
    >
      <title>Email</title>
      <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
      <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg
      role="img"
      aria-label="Phone"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={ICON_CLS}
    >
      <title>Phone</title>
      <path
        fillRule="evenodd"
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h1.148a1.5 1.5 0 0 1 1.465 1.175l.716 3.223a1.5 1.5 0 0 1-1.052 1.767l-.933.267c-.41.117-.643.555-.48.95a11.542 11.542 0 0 0 6.254 6.254c.395.163.833-.07.95-.48l.267-.933a1.5 1.5 0 0 1 1.767-1.052l3.223.716A1.5 1.5 0 0 1 18 15.352V16.5a1.5 1.5 0 0 1-1.5 1.5H15c-1.149 0-2.263-.15-3.326-.43A13.022 13.022 0 0 1 2.43 8.326 13.019 13.019 0 0 1 2 5V3.5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function IndustryIcon() {
  return (
    <svg
      role="img"
      aria-label="Industry"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={ICON_CLS}
    >
      <title>Industry</title>
      <path
        fillRule="evenodd"
        d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25ZM6 5.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-1.5A.75.75 0 0 1 6 6.75v-1.5Zm5 0a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-1.5ZM6 9.75A.75.75 0 0 1 6.75 9h1.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-1.5A.75.75 0 0 1 6 11.25v-1.5Zm5 0A.75.75 0 0 1 11.75 9h1.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1-.75-.75v-1.5ZM7 14a1 1 0 0 0-1 1v3h3v-3a1 1 0 0 0-1-1H7Zm5-1a.75.75 0 0 0-.75.75v3.5c0 .414.336.75.75.75h.75a.75.75 0 0 0 .75-.75v-3.5a.75.75 0 0 0-.75-.75H12Z"
        clipRule="evenodd"
      />
    </svg>
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
          ? 'bg-ink text-white font-bold'
          : 'bg-white text-black hover:bg-gray-50'
      }`}
    >
      {children} ({count})
    </button>
  )
}

function EmptyState({
  filter,
  hasSearch,
}: {
  filter: ClientFilter
  hasSearch: boolean
}) {
  if (hasSearch) {
    return (
      <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
        <div className="text-white font-bold text-sm mb-1">
          No matches
        </div>
        <div className="text-white text-xs">
          No {filter} clients match that search.
        </div>
      </div>
    )
  }
  const copy: Record<ClientFilter, { title: string; sub: string }> = {
    active: {
      title: 'No active clients yet',
      sub: 'Click “+ New Client” to add your first.',
    },
    pending: {
      title: 'No pending clients',
      sub: 'New clients land here until they activate their portal.',
    },
    archived: {
      title: 'No archived clients',
      sub: 'Archived clients live here.',
    },
  }
  return (
    <div className="bg-ink border border-dashed border-line rounded p-10 text-center">
      <div className="text-white font-bold text-sm mb-1">
        {copy[filter].title}
      </div>
      <div className="text-white text-xs">{copy[filter].sub}</div>
    </div>
  )
}

function ClientCard({
  client,
  industryName,
  lastWeekEntered,
  onChange,
  onViewPortal,
  onEdit,
  onResetPassword,
}: {
  client: Client
  industryName: string | null
  lastWeekEntered: boolean
  onChange: () => void
  onViewPortal: () => void
  onEdit: () => void
  onResetPassword: () => void
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

  const regenerateCode = async () => {
    if (busy) return
    if (
      !confirm(
        `Regenerate the invite code for ${client.company_name}? The current code (${client.invite_code ?? '—'}) will stop working immediately. The new code will appear on this card — share it with the client.`
      )
    )
      return
    setBusy(true)
    const newCode = generateInviteCode()
    const expires = new Date()
    expires.setDate(expires.getDate() + 30)
    const { error } = await supabase
      .from('clients')
      .update({
        invite_code: newCode,
        invite_code_expires_at: expires.toISOString(),
      })
      .eq('id', client.id)
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    onChange()
  }

  return (
    <li className="bg-ink border border-line rounded-lg p-4 flex flex-col gap-3">
      <div className="min-w-0">
        <div className="flex justify-between items-start gap-2">
          <div className="text-white font-bold text-base truncate flex-1 min-w-0">
            {client.company_name}
          </div>
          {/* Entry status pill — only on Active clients. Pending = no entry
              workflow yet; Archived = irrelevant. */}
          {client.activated && !client.archived && (
            <EntryStatusPill entered={lastWeekEntered} />
          )}
        </div>
        <div className="text-white text-sm mt-1 space-y-0.5">
          {client.contact_name && (
            <div>
              <span className="font-semibold">Contact Name:</span>{' '}
              {client.contact_name}
            </div>
          )}
          {client.email && (
            <div className="truncate">
              <EmailIcon />{' '}
              <a
                href={`mailto:${client.email}`}
                className="underline hover:opacity-80"
              >
                {client.email}
              </a>
            </div>
          )}
          {client.phone && (
            <div>
              <PhoneIcon />{' '}
              <a
                href={`tel:${client.phone.replace(/[^0-9+]/g, '')}`}
                className="underline hover:opacity-80"
              >
                {client.phone}
              </a>
            </div>
          )}
          <div>
            <IndustryIcon />{' '}
            {industryName ?? '—'}
          </div>
        </div>
        {!client.activated && client.invite_code && (
          <div className="mt-2">
            <span className="bg-line text-white rounded px-2 py-0.5 text-xs font-mono">
              Code: {client.invite_code}
            </span>
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        <button
          type="button"
          onClick={onEdit}
          className="bg-transparent text-white border border-mute text-xs font-bold px-3 py-1.5 rounded hover:bg-white/10"
        >
          Edit
        </button>
        {client.activated && !client.archived && (
          <button
            type="button"
            onClick={onResetPassword}
            className="bg-transparent text-white border border-mute text-xs font-bold px-3 py-1.5 rounded hover:bg-white/10"
          >
            Reset Password
          </button>
        )}
        {!client.activated && !client.archived && (
          <button
            type="button"
            onClick={regenerateCode}
            disabled={busy}
            className="bg-transparent text-white border border-mute text-xs font-bold px-3 py-1.5 rounded hover:bg-white/10 disabled:opacity-50"
          >
            Regenerate Code
          </button>
        )}
        <button
          type="button"
          onClick={onViewPortal}
          className="bg-accent text-black text-xs font-bold px-3 py-1.5 rounded hover:brightness-95"
        >
          View Portal
        </button>
        {client.archived ? (
          <button
            type="button"
            onClick={() => setArchived(false)}
            disabled={busy}
            className="bg-transparent text-white border border-good text-xs font-bold px-3 py-1.5 rounded hover:bg-good/10 disabled:opacity-50"
          >
            Restore
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setArchived(true)}
            disabled={busy}
            className="bg-transparent text-white border border-bad-soft text-xs font-bold px-3 py-1.5 rounded hover:bg-bad/10 disabled:opacity-50"
          >
            Archive
          </button>
        )}
      </div>
    </li>
  )
}

