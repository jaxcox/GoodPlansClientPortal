import { Fragment, useState } from 'react'
import { CATEGORIES, KPIS } from '../lib/kpis'
import type { KpiCategory, KpiDef } from '../lib/kpis'
import { runClientTour } from '../lib/clientTour'

// =============================================================================
// Resources — coach-curated reference content surfaced inside the portal.
// The first article (KPI Glossary) is auto-generated from src/lib/kpis.ts so
// the page launches with real content without any hand-written articles.
// Future articles will land as markdown files under src/content/resources/
// and get registered in the ARTICLES list below.
// =============================================================================

type Props = {
  clientId: string
}

/** Catalog of available resources. New entries land here as they're built.
 *  Today the only article is the auto-generated KPI Glossary. */
type Article = {
  id: string
  title: string
  description: string
  /** Rendered article body. Receives clientId for future per-client copy
   *  (e.g. surfacing a client's custom KPIs alongside the standard set). */
  render: (clientId: string) => React.ReactNode
}

const ARTICLES: Article[] = [
  {
    id: 'kpi-glossary',
    title: 'KPI Glossary',
    description:
      "Every KPI you can track in the portal. What each one measures and why it's important. Organized by category.",
    render: () => <KpiGlossary />,
  },
]

export function ResourcesPage({ clientId }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = activeId ? ARTICLES.find((a) => a.id === activeId) : null

  // Article view — open one article from the index. Read surface uses
  // a lighter chrome than operational pages (no dark cards, plain text
  // back link) so it reads as documentation, not as another tile.
  if (active) {
    return (
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-ink">{active.title}</h1>
          <button
            type="button"
            onClick={() => setActiveId(null)}
            className="text-sm text-black hover:underline"
          >
            ← Back to Resources
          </button>
        </div>
        {active.render('')}
      </section>
    )
  }

  // Index view — list of articles as clickable cards, plus a special
  // "Take a tour" card that fires the Driver.js walkthrough instead of
  // opening article content.
  return (
    <section className="space-y-4">
      <h1 className="text-lg font-bold text-ink">Resources</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ARTICLES.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => setActiveId(a.id)}
            className="text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-accent hover:shadow-sm transition-all"
          >
            <div className="text-base font-bold text-ink mb-1">{a.title}</div>
            <div className="text-sm text-black">{a.description}</div>
          </button>
        ))}
        <button
          type="button"
          onClick={() => runClientTour(clientId)}
          className="text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-accent hover:shadow-sm transition-all"
        >
          <div className="text-base font-bold text-ink mb-1">
            Take a tour
          </div>
          <div className="text-sm text-black">
            A one-minute walk-through of the portal's main pages. Skip
            it the first time? Replay anytime here.
          </div>
        </button>
      </div>
    </section>
  )
}

// =============================================================================
// KPI Glossary — auto-generated from KPIS in src/lib/kpis.ts. Rendered as a
// "documentation" surface: a single white paper-style panel holds the entire
// article; each category is a typographic section (uppercase heading +
// horizontal rule + table) rather than its own dark Card. This signals
// "read me, I'm static reference content" instead of "I'm another
// operational surface like the dashboard tiles."
// =============================================================================

function KpiGlossary() {
  // Group KPIs by category, preserving registry order within each.
  const byCategory = new Map<KpiCategory, KpiDef[]>()
  for (const k of KPIS) {
    const list = byCategory.get(k.category) ?? []
    list.push(k)
    byCategory.set(k.category, list)
  }

  return (
    <div className="bg-white rounded-lg p-6 sm:p-8 space-y-10">
      {CATEGORIES.map((cat) => {
        const kpis = byCategory.get(cat) ?? []
        if (kpis.length === 0) return null
        return (
          <section key={cat}>
            <h2 className="text-base font-bold text-black uppercase tracking-wider mb-1">
              {cat}
            </h2>
            <hr className="border-t-2 border-accent mb-5" />
            <KpiTable kpis={kpis} />
          </section>
        )
      })}
    </div>
  )
}

function KpiTable({ kpis }: { kpis: KpiDef[] }) {
  return (
    <>
      {/* Mobile: stacked per-KPI layout with section labels repeated per
          KPI so a phone reader always has context. */}
      <div className="sm:hidden space-y-6">
        {kpis.map((k) => (
          <div key={k.id} className="space-y-2">
            <div className="text-sm font-bold text-black">{k.label}</div>
            <div>
              <SectionLabel>What it measures</SectionLabel>
              <p className="text-sm text-black leading-snug">
                {measuresOf(k)}
              </p>
            </div>
            <div>
              <SectionLabel>Why it's important</SectionLabel>
              <p className="text-sm text-black leading-snug">
                {importanceOf(k)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop / tablet: 3-column grid. KPI name on the left, two text
          columns on the right. One header row at the top of the section. */}
      <div className="hidden sm:grid sm:grid-cols-[minmax(160px,auto)_1fr_1fr] gap-x-8 gap-y-5">
        <div />
        <div className="border-b border-gray-300 pb-2">
          <SectionLabel>What it measures</SectionLabel>
        </div>
        <div className="border-b border-gray-300 pb-2">
          <SectionLabel>Why it's important</SectionLabel>
        </div>
        {kpis.map((k) => (
          <Fragment key={k.id}>
            <div className="text-sm font-bold text-black text-right self-start">
              {k.label}
            </div>
            <p className="text-sm text-black leading-snug">{measuresOf(k)}</p>
            <p className="text-sm text-black leading-snug">
              {importanceOf(k)}
            </p>
          </Fragment>
        ))}
      </div>
    </>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-bold uppercase tracking-wider text-black">
      {children}
    </div>
  )
}

/** Best-available "what it measures" copy. Prefers the structured
 *  glossary entry; falls back to the short desc for KPIs that don't
 *  have a glossary yet. Returns empty string if neither exists. */
function measuresOf(k: KpiDef): string {
  return k.glossary?.whatItMeasures ?? k.desc ?? ''
}

function importanceOf(k: KpiDef): string {
  return k.glossary?.whyItsImportant ?? ''
}

