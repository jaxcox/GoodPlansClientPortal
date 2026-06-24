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
import { ReassignClientModal } from '../components/ReassignClientModal'
import { TeamPage } from '../components/TeamPage'
import { CoachAccountPage } from './CoachAccountPage'
import { useDirtyConfirm } from '../lib/dirtyGuard'

type Tab = 'clients' | 'industries' | 'team' | 'account'
type ClientFilter = 'active' | 'pending' | 'archived'
type ClientSort = 'alpha-asc' | 'alpha-desc' | 'newest' | 'oldest'

type Props = {
  onViewPortal: (clientId: string) => void
}

export function CoachAdmin({ onViewPortal }: Props) {
  const { coach, profile, signOut } = useAuth()
  const confirmLeave = useDirtyConfirm()
  const [tab, setTab] = useState<Tab>('clients')

  /** Role gates (Phase B of the role overhaul). Admins see every tab +
   *  every admin action. Managers + Coaches see Clients + Team only;
   *  Industries and Account live behind the admin flag. */
  const isAdmin = coach?.is_admin === true

  // Snap back to Clients if the active tab gets hidden (e.g., user
  // refreshes the page on an admin-only tab after admin was revoked).
  useEffect(() => {
    if (!isAdmin && (tab === 'industries' || tab === 'account')) {
      setTab('clients')
    }
  }, [isAdmin, tab])

  /** Guarded tab change — prompts if the current page has unsaved edits. */
  const guardedSetTab = (next: Tab) => {
    if (tab === next) return
    if (!confirmLeave()) return
    setTab(next)
  }
  const guardedSignOut = () => {
    if (!confirmLeave()) return
    signOut()
  }
  const [clients, setClients] = useState<Client[] | null>(null)
  const [industries, setIndustries] = useState<Industry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  /** Set of client IDs that have a weekly_entries row for the most recent
   *  completed week. Used to color the entry-status pill on each card. */
  const [lastWeekEntries, setLastWeekEntries] = useState<Set<string>>(
    () => new Set()
  )
  /** Caller + their direct reports — populated by refresh(). Used to
   *  power the Clients tab's coach-filter dropdown and to display
   *  "Coach: X" on client cards when viewing a multi-coach list. */
  const [teamCoaches, setTeamCoaches] = useState<
    Array<{ id: string; display_name: string | null }>
  >([])
  /** Active coach filter on the Clients tab. null = "All". Set by
   *  TeamPage card clicks (deep-link) or by the dropdown. */
  const [clientsCoachFilter, setClientsCoachFilter] = useState<
    string | null
  >(null)

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
    // Load the team roster (self + direct reports per migration 0015).
    // RLS already scopes this to who the caller can see, so the same query
    // serves both managers (returns self + reports) and reports (returns
    // just self).
    if (coach) {
      const { data: coachRows } = await supabase
        .from('coaches')
        .select('id')
        .or(`id.eq.${coach.id},manager_coach_id.eq.${coach.id}`)
      const ids = (coachRows ?? []).map((r) => (r as { id: string }).id)
      const { data: profs } = await supabase
        .from('profiles')
        .select('coach_id, display_name, role')
        .in('coach_id', ids)
        .eq('role', 'coach')
      const merged = ids.map((id) => {
        const p = (profs ?? []).find(
          (x) => (x as { coach_id: string | null }).coach_id === id
        ) as { display_name: string | null } | undefined
        return { id, display_name: p?.display_name ?? null }
      })
      setTeamCoaches(merged)
    }
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
    <div className="min-h-screen bg-[#dad7c5]">
      <div className="sticky top-0 z-30 bg-white border-b border-ink/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          {/* Brand row — centered wordmark, name + Logout right. Mirrors the
              marketing site header. */}
          <div className="grid grid-cols-3 items-center py-4">
            <div></div>
            <div className="justify-self-center">
              {brandName === 'The Good Plans Co' ? (
                <span className="font-brand text-3xl font-bold text-ink">The Good P<span className="underline decoration-accent decoration-[3px] underline-offset-[6px]">lans Co&nbsp;&nbsp;&nbsp;</span></span>
              ) : (
                <span className="font-brand text-3xl font-bold text-ink">{brandName}</span>
              )}
            </div>
            <div className="flex items-center gap-3 justify-end text-sm">
              <span className="text-ink">{profile?.display_name ?? 'Coach'}</span>
              <button
                type="button"
                onClick={guardedSignOut}
                className="bg-ink text-white font-bold px-4 py-2 rounded hover:brightness-110 transition-all text-sm"
              >
                Logout
              </button>
            </div>
          </div>
          {/* Tab row — centered, text-sm, matching the site's nav row. */}
          <div className="border-t border-ink/10 py-3">
            <nav className="flex justify-center gap-12 text-sm">
              <TabButton active={tab === 'clients'} onClick={() => guardedSetTab('clients')}>
                Clients
              </TabButton>
              {isAdmin && (
                <TabButton
                  active={tab === 'industries'}
                  onClick={() => guardedSetTab('industries')}
                >
                  Industries
                </TabButton>
              )}
              <TabButton active={tab === 'team'} onClick={() => guardedSetTab('team')}>
                Team
              </TabButton>
              {isAdmin && (
                <TabButton
                  active={tab === 'account'}
                  onClick={() => guardedSetTab('account')}
                >
                  Account
                </TabButton>
              )}
            </nav>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {tab === 'clients' ? (
          <ClientsTab
            clients={clients}
            industryById={industryById}
            lastWeekEntries={lastWeekEntries}
            error={loadError}
            onChange={refresh}
            onViewPortal={onViewPortal}
            teamCoaches={teamCoaches}
            coachFilter={clientsCoachFilter}
            onCoachFilterChange={setClientsCoachFilter}
            isAdmin={isAdmin}
          />
        ) : tab === 'industries' && isAdmin ? (
          <IndustriesPage />
        ) : tab === 'team' ? (
          <TeamPage
            onSelectCoach={(coachId) => {
              setClientsCoachFilter(coachId)
              setTab('clients')
            }}
          />
        ) : tab === 'account' && isAdmin ? (
          <CoachAccountPage onLeave={() => setTab('clients')} />
        ) : null}
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
      className={`text-sm py-1 ${
        active ? 'font-bold text-ink' : 'text-ink hover:text-ink/70 transition-colors'
      }`}
    >
      {/* Underline on an inner span so the yellow rule hugs the word,
          not the bottom of the tap-target padding. Always reserve the
          border + padding (toggle only its color) so the active tab's
          baseline doesn't shift up relative to the inactive ones. */}
      <span
        className={`border-b-2 pb-0.5 ${active ? 'border-accent' : 'border-transparent'}`}
      >
        {children}
      </span>
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
  teamCoaches,
  coachFilter,
  onCoachFilterChange,
  isAdmin,
}: {
  clients: Client[] | null
  industryById: Map<string, string>
  lastWeekEntries: Set<string>
  error: string | null
  onChange: () => void
  onViewPortal: (clientId: string) => void
  teamCoaches: Array<{ id: string; display_name: string | null }>
  coachFilter: string | null
  onCoachFilterChange: (id: string | null) => void
  /** Admin sees + Add Client, Edit, Archive, Reset Password, Send Invite.
   *  Non-admin coaches only see View Portal + (Manager) Reassign + the
   *  KPI workflow inside the portal. */
  isAdmin: boolean
}) {
  const { coach } = useAuth()
  const [filter, setFilter] = useState<ClientFilter>('active')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ClientSort>('alpha-asc')
  const [modalState, setModalState] = useState<
    | { kind: 'closed' }
    | { kind: 'create' }
    | { kind: 'edit'; client: Client }
  >({ kind: 'closed' })
  /** Bulk reassign selection — only meaningful when teamCoaches.length > 1.
   *  Reset whenever the visible bucket changes (filter / coach filter
   *  switch) so stale selections don't carry across views. */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkTarget, setBulkTarget] = useState<string>('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  useEffect(() => {
    setSelectedIds(new Set())
    setBulkResult(null)
  }, [filter, coachFilter])

  // First narrow by coach filter (null = "All" = every client the
  // current caller can see; specific id = only that coach's clients).
  const coachScoped = coachFilter
    ? (clients ?? []).filter((c) => c.coach_id === coachFilter)
    : clients ?? []
  const active = coachScoped.filter((c) => !c.archived && c.activated)
  const pending = coachScoped.filter((c) => !c.archived && !c.activated)
  const archived = coachScoped.filter((c) => c.archived)
  const bucket =
    filter === 'active' ? active : filter === 'pending' ? pending : archived
  const q = search.trim().toLowerCase()
  const filtered = q
    ? bucket.filter((c) => c.company_name.toLowerCase().startsWith(q))
    : bucket
  /** Map coach_id → display name for the "Coach: X" badge on cards
   *  when showing more than one coach's clients. */
  const coachNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const tc of teamCoaches) {
      m.set(tc.id, tc.display_name ?? '— no name —')
    }
    return m
  }, [teamCoaches])
  /** Show coach indicator on each card only when multiple coaches are
   *  in the visible list (i.e., the filter isn't pinned to a single
   *  coach AND the team has more than one coach in it). */
  const showCoachOnCards = !coachFilter && teamCoaches.length > 1
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

  // Heading reflects the active coach filter. When viewing yours: "My
  // Clients". Viewing a teammate: "Steve's Clients". "All" or none:
  // "All Clients" (multi-coach team) or "My Clients" (solo coach).
  const heading = (() => {
    if (!coachFilter) {
      return teamCoaches.length > 1 ? 'All Clients' : 'My Clients'
    }
    if (coachFilter === coach?.id) return 'My Clients'
    const name =
      teamCoaches.find((c) => c.id === coachFilter)?.display_name ?? null
    if (!name) return 'Clients'
    // Apostrophe-S possessive — handles names ending in s ("Steve" → "Steve's";
    // "Chris" → "Chris's") consistently. Coach Cox's spouse Steve qualifies for
    // the standard form.
    return `${name}'s Clients`
  })()

  return (
    <section>
      <div className="flex justify-between items-center mb-4">
        <h1 className="font-brand text-ink text-lg font-bold">{heading}</h1>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setModalState({ kind: 'create' })}
            className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95"
          >
            + Add Client
          </button>
        )}
      </div>

      {/* Select-all helper for bulk reassign — only when multi-coach team
          AND the current bucket has selectable (non-archived) cards. */}
      {teamCoaches.length > 1 &&
        filter !== 'archived' &&
        visible.length > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <label className="inline-flex items-center gap-2 text-xs text-black cursor-pointer select-none">
              <input
                type="checkbox"
                checked={
                  visible.every((c) => selectedIds.has(c.id)) &&
                  visible.length > 0
                }
                ref={(el) => {
                  if (el) {
                    const someSelected = visible.some((c) =>
                      selectedIds.has(c.id)
                    )
                    const allSelected = visible.every((c) =>
                      selectedIds.has(c.id)
                    )
                    el.indeterminate = someSelected && !allSelected
                  }
                }}
                onChange={(e) => {
                  setBulkResult(null)
                  if (e.target.checked) {
                    setSelectedIds(
                      (prev) =>
                        new Set([...prev, ...visible.map((c) => c.id)])
                    )
                  } else {
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      for (const c of visible) next.delete(c.id)
                      return next
                    })
                  }
                }}
                className="w-4 h-4 accent-accent cursor-pointer"
              />
              Select all on this page ({visible.length})
            </label>
          </div>
        )}
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
        {/* Coach filter — only renders when the caller has at least one
            teammate. Single-coach setups don't need a filter. */}
        {teamCoaches.length > 1 && (
          <select
            value={coachFilter ?? ''}
            onChange={(e) =>
              onCoachFilterChange(e.target.value === '' ? null : e.target.value)
            }
            aria-label="Filter clients by coach"
            className="select-yellow bg-white border border-gray-300 rounded text-black text-xs px-3 py-1.5 focus:outline-none focus:border-gray-400"
          >
            <option value="">Coach: All</option>
            {teamCoaches.map((tc) => (
              <option key={tc.id} value={tc.id}>
                Coach: {tc.display_name ?? '— no name —'}
                {tc.id === coach?.id ? ' (You)' : ''}
              </option>
            ))}
          </select>
        )}
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
        <EmptyState
          filter={filter}
          hasSearch={q.length > 0}
          onAddClient={
            isAdmin ? () => setModalState({ kind: 'create' }) : null
          }
        />
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
              ownedByCoachName={
                showCoachOnCards ? coachNameById.get(c.coach_id) ?? null : null
              }
              canReassign={teamCoaches.length > 1}
              isAdmin={isAdmin}
              selectable={teamCoaches.length > 1 && !c.archived}
              selected={selectedIds.has(c.id)}
              onToggleSelect={() => {
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (next.has(c.id)) next.delete(c.id)
                  else next.add(c.id)
                  return next
                })
                setBulkResult(null)
              }}
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

      {/* Bulk reassign action bar — fixed at viewport bottom whenever the
          manager has selected at least one client. Posts to reassign-client
          once per selected id; reports per-client outcome in a summary. */}
      {teamCoaches.length > 1 && selectedIds.size > 0 && (
        <div
          role="region"
          aria-label="Bulk reassign"
          className="fixed bottom-0 left-0 right-0 z-40 bg-ink border-t border-line shadow-2xl p-3"
        >
          <div className="max-w-6xl mx-auto flex flex-wrap items-center gap-3">
            <div className="text-white text-sm font-bold">
              {selectedIds.size} selected
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-white">
              Reassign to:
              <select
                value={bulkTarget}
                onChange={(e) => setBulkTarget(e.target.value)}
                disabled={bulkBusy}
                className="select-yellow bg-white border border-gray-300 rounded text-black text-xs px-3 py-1.5 focus:outline-none focus:border-gray-400"
              >
                <option value="">Pick a coach…</option>
                {teamCoaches.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.display_name ?? '— no name —'}
                    {tc.id === coach?.id ? ' (You)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!bulkTarget || bulkBusy}
              onClick={async () => {
                if (!bulkTarget) return
                setBulkBusy(true)
                setBulkResult(null)
                const ids = Array.from(selectedIds)
                // Run reassigns in parallel. Each call validates target +
                // industry-copies as needed. Clients already on the target
                // come back as a 400 we silently fold into "skipped".
                const results = await Promise.all(
                  ids.map(async (clientId) => {
                    const { data, error: invokeErr } =
                      await supabase.functions.invoke<{
                        ok?: boolean
                        error?: string
                      }>('reassign-client', {
                        body: { clientId, targetCoachId: bulkTarget },
                      })
                    if (invokeErr) {
                      let msg = invokeErr.message
                      const ctx = (
                        invokeErr as { context?: Response }
                      ).context
                      if (ctx && typeof ctx.json === 'function') {
                        try {
                          const body = await ctx.json()
                          if (body?.error) msg = body.error
                        } catch {
                          /* keep generic */
                        }
                      }
                      return { clientId, ok: false, error: msg }
                    }
                    if (!data?.ok) {
                      return {
                        clientId,
                        ok: false,
                        error: data?.error ?? 'Failed',
                      }
                    }
                    return { clientId, ok: true }
                  })
                )
                const moved = results.filter((r) => r.ok).length
                const skipped = results.filter(
                  (r) =>
                    !r.ok && r.error?.includes('already assigned to that coach')
                ).length
                const failed = results.length - moved - skipped
                const targetName =
                  teamCoaches.find((tc) => tc.id === bulkTarget)
                    ?.display_name ?? 'that coach'
                const parts: string[] = []
                if (moved > 0)
                  parts.push(
                    `Moved ${moved} ${moved === 1 ? 'client' : 'clients'} to ${targetName}`
                  )
                if (skipped > 0)
                  parts.push(
                    `${skipped} already on ${targetName} (skipped)`
                  )
                if (failed > 0)
                  parts.push(
                    `${failed} failed: ${results
                      .filter(
                        (r) =>
                          !r.ok &&
                          !r.error?.includes(
                            'already assigned to that coach'
                          )
                      )
                      .map((r) => r.error)
                      .join('; ')}`
                  )
                setBulkResult(parts.join(' · '))
                setBulkBusy(false)
                if (moved > 0) {
                  setSelectedIds(new Set())
                  setBulkTarget('')
                  onChange()
                }
              }}
              className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bulkBusy ? 'Reassigning…' : 'Reassign'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedIds(new Set())
                setBulkResult(null)
                setBulkTarget('')
              }}
              disabled={bulkBusy}
              className="bg-transparent text-white border border-mute px-3 py-1.5 rounded text-xs font-semibold hover:bg-white/10 disabled:opacity-50"
            >
              Clear
            </button>
            {bulkResult && (
              <div className="text-xs text-white basis-full sm:basis-auto sm:ml-auto">
                {bulkResult}
              </div>
            )}
          </div>
        </div>
      )}
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
/** Clickable invite-code chip. Click anywhere on the chip to copy the
 *  code; the chip briefly swaps to "Copied ✓" so the coach knows it
 *  landed (clipboard is otherwise invisible). The copy icon makes the
 *  click affordance discoverable. */
function CopyableCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? 'Copied to clipboard' : 'Click to copy'}
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-mono transition-colors ${
        copied
          ? 'bg-good text-white'
          : 'bg-line text-white hover:bg-line/80 cursor-pointer'
      }`}
    >
      <span>{copied ? 'Copied ✓' : `Code: ${code}`}</span>
      {!copied && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3 h-3"
          aria-hidden
        >
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}

function EntryStatusPill({ entered }: { entered: boolean }) {
  if (entered) {
    return (
      <span className="bg-good text-white text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap shrink-0">
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
      className={`px-3 py-2 sm:py-1.5 ${
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
  onAddClient,
}: {
  filter: ClientFilter
  hasSearch: boolean
  /** Null when the viewer can't add clients (non-admin) — button is
   *  hidden. Otherwise the Add Client CTA is offered. */
  onAddClient: (() => void) | null
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
      sub: 'Add your first to get started.',
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
      {filter === 'active' && onAddClient && (
        <button
          type="button"
          onClick={onAddClient}
          className="bg-accent text-black px-4 py-2 sm:py-1.5 rounded text-xs font-bold hover:brightness-95 mt-4"
        >
          + Add Client
        </button>
      )}
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
  ownedByCoachName,
  canReassign,
  isAdmin,
  selectable,
  selected,
  onToggleSelect,
}: {
  client: Client
  industryName: string | null
  lastWeekEntered: boolean
  onChange: () => void
  onViewPortal: () => void
  onEdit: () => void
  /** When set (multi-coach view), shown as "Coach: X" on the card so
   *  the manager can tell whose client this is at a glance. Hidden
   *  when the list is filtered to a single coach (redundant). */
  ownedByCoachName: string | null
  /** True when the signed-in coach has at least one teammate, so
   *  Reassign makes sense. Final gate is canReassign && (isAdmin ||
   *  isManager); server-side enforces both. */
  canReassign: boolean
  /** Admin gates the client-management buttons: Edit, Archive/Restore,
   *  Reset Password, Send Invite. Non-admins see only View Portal +
   *  (where applicable) Reassign. */
  isAdmin: boolean
  /** Bulk-reassign mode: when true, a checkbox renders to the left of
   *  the company name and the parent controls multi-select. Mirrors the
   *  per-card Reassign button but lets the manager move many at once. */
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: () => void
}) {
  const { coach } = useAuth()
  const [busy, setBusy] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)

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

  /** Send (or re-send) the invite email. Single entry point — handles
   *  the "code expired, need a new one" path transparently so the coach
   *  doesn't have to think about which button to click. Flow:
   *    - If the existing code is missing or expired: generate a fresh
   *      code + new 30-day expiry, save it, then send.
   *    - Otherwise: just send the existing code as-is.
   *  Either path ends with an alert telling the coach what happened. */
  const sendInvite = async () => {
    if (busy) return
    setBusy(true)

    const codeExpired =
      client.invite_code_expires_at != null &&
      new Date(client.invite_code_expires_at) < new Date()
    const needsNewCode = !client.invite_code || codeExpired

    if (needsNewCode) {
      const newCode = generateInviteCode()
      const expires = new Date()
      expires.setDate(expires.getDate() + 30)
      const { error: updateErr } = await supabase
        .from('clients')
        .update({
          invite_code: newCode,
          invite_code_expires_at: expires.toISOString(),
        })
        .eq('id', client.id)
      if (updateErr) {
        setBusy(false)
        alert(updateErr.message)
        return
      }
    }

    const { error: emailErr } = await supabase.functions.invoke(
      'send-client-invite',
      { body: { clientId: client.id } }
    )
    setBusy(false)
    if (emailErr) {
      alert(`Invite email failed: ${emailErr.message}`)
    } else {
      alert(`Invite email sent to ${client.email}.`)
    }
    onChange()
  }

  return (
    <li className="bg-ink border border-line rounded-lg p-4 flex flex-col gap-3">
      <div className="min-w-0">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {selectable && (
              <input
                type="checkbox"
                checked={!!selected}
                onChange={onToggleSelect}
                aria-label={`Select ${client.company_name} for bulk reassign`}
                className="mt-1 w-4 h-4 accent-accent cursor-pointer flex-shrink-0"
              />
            )}
            <div className="text-white font-bold text-base truncate flex-1 min-w-0">
              {client.company_name}
            </div>
          </div>
          {/* Entry status pill — only on Active clients. Pending = no entry
              workflow yet; Archived = irrelevant. */}
          {client.activated && !client.archived && (
            <EntryStatusPill entered={lastWeekEntered} />
          )}
        </div>
        {/* Coach badge — shown when the parent passes a name (manager
            viewing All clients in a multi-coach team). Distinguishes
            "this is yours" from "this belongs to your report" at a
            glance. Hidden when the list is filtered to a single coach. */}
        {ownedByCoachName && (
          <div className="text-xs text-white mt-1 italic">
            Coach: {ownedByCoachName}
            {client.coach_id === coach?.id ? ' (You)' : ''}
          </div>
        )}
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
            <CopyableCode code={client.invite_code} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-center sm:justify-start gap-1.5">
        {isAdmin && (
          <button
            type="button"
            onClick={onEdit}
            className="bg-transparent text-white border border-mute text-xs font-bold px-3 py-2 sm:py-1.5 rounded hover:bg-white/10"
          >
            Edit
          </button>
        )}
        {!client.archived && canReassign && (
          <button
            type="button"
            onClick={() => setReassignOpen(true)}
            className="bg-transparent text-white border border-mute text-xs font-bold px-3 py-2 sm:py-1.5 rounded hover:bg-white/10"
            title="Move this client to another coach on your team"
          >
            Reassign
          </button>
        )}
        {isAdmin && !client.activated && !client.archived && (
          <button
            type="button"
            onClick={sendInvite}
            disabled={busy}
            className="bg-transparent text-white border border-mute text-xs font-bold px-3 py-2 sm:py-1.5 rounded hover:bg-white/10 disabled:opacity-50"
            title="Send (or re-send) the invite email to this client. Generates a fresh code automatically if the existing one is expired."
          >
            Send Invite
          </button>
        )}
        <button
          type="button"
          onClick={onViewPortal}
          className="bg-accent text-black text-xs font-bold px-3 py-2 sm:py-1.5 rounded hover:brightness-95"
        >
          View Portal
        </button>
        {/* Mobile-only row break — pushes Archive/Restore to its own row
            below the action cluster (Edit / Reset / View Portal). On
            desktop (sm+) this is hidden so all buttons sit on one row. */}
        {isAdmin && (
          <>
            <div className="basis-full h-0 sm:hidden" aria-hidden />
            {client.archived ? (
              <button
                type="button"
                onClick={() => setArchived(false)}
                disabled={busy}
                className="bg-transparent text-white border border-good text-xs font-bold px-3 py-2 sm:py-1.5 rounded hover:bg-good/10 disabled:opacity-50"
              >
                Restore
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setArchived(true)}
                disabled={busy}
                className="bg-transparent text-white border border-bad-soft text-xs font-bold px-3 py-2 sm:py-1.5 rounded hover:bg-bad/10 disabled:opacity-50"
              >
                Archive
              </button>
            )}
          </>
        )}
      </div>
      {coach && (
        <ReassignClientModal
          open={reassignOpen}
          clientId={client.id}
          clientName={client.company_name}
          brandName={coach.brand_name}
          currentCoachId={coach.id}
          onClose={() => setReassignOpen(false)}
          onReassigned={() => {
            setReassignOpen(false)
            onChange()
          }}
        />
      )}
    </li>
  )
}

