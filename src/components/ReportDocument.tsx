// =============================================================================
// ReportDocument — client-side PDF generator for the Dashboard's
// "Download Report" action. Drawn from scratch with @react-pdf/renderer
// (not a screenshot of the dashboard) so the layout is deliberately
// print-friendly: white background, black text, minimal ink, single
// accent color on the status arrows. SVG triangles instead of Unicode
// ▼ ▲ ● because react-pdf's bundled Helvetica doesn't carry geometric
// shape glyphs and falls back to nonsense fragments.
//
// The data shape (ReportData) is built in WeeklyDashboard at click time
// from the same state the on-screen tiles use, so what you download
// always matches what you see.
// =============================================================================

import {
  Document,
  Page,
  Polygon,
  StyleSheet,
  Svg,
  Text,
  View,
} from '@react-pdf/renderer'
import { computeBand } from '../lib/band'
import type { KpiDirection, KpiFormat } from '../lib/kpis'

// -----------------------------------------------------------------------------
// Public data shape
// -----------------------------------------------------------------------------

export type ReportRow = {
  label: string
  format: KpiFormat
  direction: KpiDirection
  range: boolean
  value: number | null
  /** Full period goal (the "finish line"). In weekly mode this is the
   *  weekly goal; in MTD/QTD/YTD it's the full-period total. */
  goal: number | null
  /** Pace goal — where the actual should be by today. Sum/$ KPIs scale
   *  this by days-elapsed; ratio / range / per-unit KPIs use the same
   *  value as `goal` (a 60% conversion rate is 60% regardless of how
   *  far into the period you are). Only set for cumulative modes; null
   *  in weekly mode. When set, the PDF shows a Pace column and bases
   *  variance + arrow color on actual vs pace. */
  paceGoal?: number | null
}

export type ReportSection = {
  title: string
  rows: ReportRow[]
}

/** A single per-group, per-metric data cell on the Utilization section.
 *  Carries everything needed to color the indicator (direction, range,
 *  value/goal). format determines the displayed unit ('%' / '$' / '#'). */
export type CapacityCell = {
  format: KpiFormat
  direction: KpiDirection
  range: boolean
  value: number | null
  goal: number | null
  /** Same semantics as ReportRow.paceGoal — only set in cumulative
   *  modes. Labor Hours scales by pace; Utilization / Labor Efficiency
   *  don't (range KPIs stay flat). */
  paceGoal?: number | null
}

/** One capacity group's column on the Utilization section. Each metric
 *  is null when not applicable (e.g. only labor-method groups have
 *  laborHours / laborEfficiency). */
export type CapacityGroupData = {
  name: string
  utilization: CapacityCell | null
  laborHours: CapacityCell | null
  laborEfficiency: CapacityCell | null
}

/** Utilization section — rendered as a transposed table where metrics
 *  (Utilization / Labor Hours / Labor Efficiency) are rows and each
 *  capacity group is its own column. */
export type CapacitySectionData = {
  title: string
  groups: CapacityGroupData[]
}

export type ReportData = {
  clientName: string
  /** Brand the report comes from. Defaults to "The Good Plans Co" but
   *  is passed in so a coach's brand_name (if customized) is honored. */
  brandName: string
  /** "Week of May 17–23, 2026", "April 2026", "Q2 2026", "2026", etc. */
  periodLabel: string
  /** Optional dashboard coach note. Rendered verbatim. */
  coachNote: string | null
  sections: ReportSection[]
  /** Optional capacity / utilization section. Rendered after the KPI
   *  sections using a transposed table (metrics rows × groups columns)
   *  because the per-row layout the other sections use gets repetitive
   *  with multiple capacity groups. */
  capacitySection?: CapacitySectionData
  /** True when this report is for a cumulative mode (MTD / QTD / YTD).
   *  Adds a Pace column between Actual and Goal; variance + arrow are
   *  computed against pace, not full goal. Defaults to false (weekly). */
  showPace?: boolean
}

// -----------------------------------------------------------------------------
// Formatting helpers (kept local — they mirror KpiTile.formatValue but
// without React deps and tuned for print spacing).
// -----------------------------------------------------------------------------

function formatVal(value: number | null, format: KpiFormat): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (format === '$')
    return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (format === '%') return `${value.toFixed(1)}%`
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/** Variance cell text — always the absolute difference, never replaced
 *  by a band label (band labels live in the arrow slot instead). The
 *  colored arrow carries direction. Uses "pts" for percent KPIs so the
 *  variance unit doesn't collide with the value unit ("5% behind a 95%
 *  goal" is ambiguous; "5 pts behind" is not). */
function formatVariance(
  value: number | null,
  goal: number | null,
  format: KpiFormat
): string {
  if (value == null || goal == null) return ''
  const diff = Math.abs(value - goal)
  if (format === '$') {
    return `$${diff.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  }
  if (format === '%') {
    const n = diff.toFixed(1).replace(/\.0$/, '')
    return `${n} pts`
  }
  return diff.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/** True when value sits within ±10% of goal. Drives the "+/-10%" text
 *  shown in the arrow slot instead of a triangle / dash indicator. */
function isWithinTen(value: number | null, goal: number | null): boolean {
  if (value == null || goal == null || goal === 0) return false
  return Math.abs(value - goal) / Math.abs(goal) <= 0.1
}

/** True when the report contains at least one range KPI (Accounts
 *  Receivable, or any capacity / Labor Efficiency tile). Gates the
 *  global "range metrics" footnote at the bottom of the report. */
function hasRangeKpi(data: ReportData): boolean {
  if (data.capacitySection && data.capacitySection.groups.length > 0) {
    return true
  }
  return data.sections.some((s) => s.rows.some((r) => r.range))
}

// Three-state arrow per the dashboard's color bands (same thresholds as
// computeBand — green ≥ 100%, yellow 90–100%, red < 90%, inverted for
// 'lo' direction KPIs like Expenses).
type ArrowSpec = { dir: 'up' | 'down' | 'flat'; color: string }

function arrowFor(
  value: number | null,
  goal: number | null,
  direction: KpiDirection,
  range: boolean
): ArrowSpec | null {
  const band = computeBand({ value, goal, direction, range })
  if (band == null || value == null || goal == null) return null
  // Arrow direction always follows value vs goal — down when below,
  // up when above, flat only on a literal match. Range KPIs (e.g.
  // Utilization) use the same up/down arrows so behind / over-capacity
  // reads at a glance instead of always showing a flat dot.
  let dir: 'up' | 'down' | 'flat'
  if (value < goal) dir = 'down'
  else if (value > goal) dir = 'up'
  else dir = 'flat'
  const color =
    band === 'green'
      ? '#16a34a' // green-600
      : band === 'yellow'
        ? '#ca8a04' // yellow-600 (readable on white, B&W friendly)
        : '#dc2626' // red-600
  return { dir, color }
}

/** Inline arrow drawn as SVG so it renders regardless of the font's
 *  Unicode support. 8x8 triangle (up / down) or a small dot for range
 *  / on-target. */
function Arrow({ spec }: { spec: ArrowSpec }) {
  return (
    <Svg viewBox="0 0 10 10" width={9} height={9}>
      {spec.dir === 'down' && (
        <Polygon points="1,2 9,2 5,9" fill={spec.color} />
      )}
      {spec.dir === 'up' && (
        <Polygon points="5,1 9,8 1,8" fill={spec.color} />
      )}
      {spec.dir === 'flat' && (
        <Polygon points="2,4 8,4 8,6 2,6" fill={spec.color} />
      )}
    </Svg>
  )
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#ffffff',
    paddingTop: 32,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#000000',
  },
  clientName: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 2,
  },
  reportTitle: {
    fontSize: 12,
    marginBottom: 2,
  },
  period: {
    fontSize: 11,
    marginBottom: 18,
  },
  coachNoteLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
    marginTop: 2,
  },
  coachNote: {
    fontSize: 10,
    marginBottom: 16,
    lineHeight: 1.4,
  },
  // Column header row sits once at the top of the KPI tables. Same
  // grid as data rows so the columns line up.
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    borderBottomColor: '#000000',
    borderBottomWidth: 1,
    marginTop: 8,
  },
  headerCell: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionTitle: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    marginTop: 8,
    marginBottom: 2,
    borderBottomColor: '#000000',
    borderBottomWidth: 1,
    paddingBottom: 2,
  },
  // Bracketing line at the bottom of the KPI tables (mirrors the
  // 1pt black line that sits under the column header row at the top).
  tableBottom: {
    borderBottomColor: '#000000',
    borderBottomWidth: 1,
    marginTop: 4,
  },
  // Capacity (Utilization) section — group name as a sub-header, then
  // one row per metric (Utilization / Labor Hours / Labor Efficiency)
  // using the same 5-column layout as the rest of the report.
  subSectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 6,
    marginBottom: 2,
    paddingBottom: 1,
    borderBottomColor: '#cccccc',
    borderBottomWidth: 0.5,
  },
  capacityRowLabel: {
    flex: 3,
    paddingLeft: 12, // indent sub-category metric rows
  },
  rangeFootnote: {
    fontSize: 8,
    fontFamily: 'Helvetica-Oblique',
    color: '#444444',
    marginTop: 10,
    lineHeight: 1.4,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  // Column widths — tightened so the table sits more compactly to the
  // left of the page. KPI takes the bulk of the row width; Actual /
  // Pace / Goal / Variance are right-aligned compact columns; Indicator
  // is a narrow column on the far right. Pace is only rendered in
  // cumulative modes (MTD / QTD / YTD).
  colLabel: { flex: 3, paddingLeft: 0 },
  colActual: { flex: 1.1, textAlign: 'right', paddingRight: 8 },
  colPace: { flex: 1.1, textAlign: 'right', paddingRight: 8 },
  colGoal: { flex: 1.1, textAlign: 'right', paddingRight: 8 },
  colVariance: { flex: 1.1, textAlign: 'right', paddingRight: 8 },
  colIndicator: { width: 36, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  withinTen: {
    fontSize: 9,
    color: '#ca8a04', // yellow-600 — readable on white (portal #FFF200 has too little contrast for print body text)
    fontFamily: 'Helvetica-Bold',
  },
  emptyRow: {
    paddingVertical: 3,
    paddingLeft: 12,
    fontFamily: 'Helvetica-Oblique',
  },
  footer: {
    marginTop: 'auto',
    paddingTop: 16,
    borderTopColor: '#cccccc',
    borderTopWidth: 0.5,
    fontSize: 9,
  },
})

// -----------------------------------------------------------------------------
// Document
// -----------------------------------------------------------------------------

export function ReportDocument({ data }: { data: ReportData }) {
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Document title={`${data.clientName} ${data.periodLabel} Report`}>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.clientName}>{data.clientName}</Text>
        <Text style={styles.reportTitle}>Performance Report</Text>
        <Text style={styles.period}>{data.periodLabel}</Text>

        {data.coachNote && (
          <View>
            <Text style={styles.coachNoteLabel}>Coach Note</Text>
            <Text style={styles.coachNote}>{data.coachNote}</Text>
          </View>
        )}

        {/* Single header row at the top of the KPI tables — columns
            stay the same across every section so we don't repeat. The
            Indicator column carries either the colored arrow (out of
            band) or "±10%" text (within band). Cumulative modes
            (MTD/QTD/YTD) add a Pace column between Actual and Goal. */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerCell, styles.colLabel]}>KPI</Text>
          <Text style={[styles.headerCell, styles.colActual]}>Actual</Text>
          {data.showPace && (
            <Text style={[styles.headerCell, styles.colPace]}>Pace</Text>
          )}
          <Text style={[styles.headerCell, styles.colGoal]}>Goal</Text>
          <Text style={[styles.headerCell, styles.colVariance]}>Variance</Text>
          <Text style={[styles.headerCell, styles.colIndicator]}></Text>
        </View>

        {data.sections.map((section) => (
          <View key={section.title} wrap={false}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.rows.length === 0 ? (
              <Text style={styles.emptyRow}>No active KPIs in this section.</Text>
            ) : (
              section.rows.map((row, i) => {
                // In cumulative modes the arrow + variance compare
                // actual vs pace (where you should be by today); in
                // weekly they compare vs goal. paceGoal is null in
                // weekly mode and === goal for non-scaling KPIs in
                // cumulative, so this falls through cleanly.
                const comparisonGoal = row.paceGoal ?? row.goal
                // ±10% text only applies to RANGE KPIs (where being
                // within 10% of goal on EITHER side genuinely means
                // on-target). Non-range KPIs always show the colored
                // arrow so the indicator matches the dashboard's
                // asymmetric color band (yellow only on the bad side).
                const showWithinTen =
                  row.range && isWithinTen(row.value, comparisonGoal)
                const arrow = arrowFor(
                  row.value,
                  comparisonGoal,
                  row.direction,
                  row.range
                )
                return (
                  <View key={`${section.title}-${i}`} style={styles.row}>
                    <Text style={styles.colLabel}>{row.label}</Text>
                    <Text style={styles.colActual}>
                      {formatVal(row.value, row.format)}
                    </Text>
                    {data.showPace && (
                      <Text style={styles.colPace}>
                        {row.paceGoal == null
                          ? '—'
                          : formatVal(row.paceGoal, row.format)}
                      </Text>
                    )}
                    <Text style={styles.colGoal}>
                      {row.goal == null ? '—' : formatVal(row.goal, row.format)}
                    </Text>
                    <Text style={styles.colVariance}>
                      {formatVariance(row.value, comparisonGoal, row.format)}
                    </Text>
                    <View style={styles.colIndicator}>
                      {showWithinTen ? (
                        <Text style={styles.withinTen}>±10%</Text>
                      ) : (
                        arrow && <Arrow spec={arrow} />
                      )}
                    </View>
                  </View>
                )
              })
            )}
          </View>
        ))}

        {data.capacitySection &&
          data.capacitySection.groups.length > 0 && (
            <CapacityTable
              section={data.capacitySection}
              showPace={!!data.showPace}
            />
          )}

        {/* Bracketing bottom rule — mirrors the 1pt black line under
            the column header row so the table reads as a closed unit. */}
        <View style={styles.tableBottom} />

        {/* Global footnote for range KPIs (Accounts Receivable,
            Utilization, Labor Efficiency). Only rendered when the report
            contains at least one of them — explains why values above
            goal can still flag red. */}
        {hasRangeKpi(data) && (
          <Text style={styles.rangeFootnote}>
            Note: Accounts Receivable, Utilization, and Labor Efficiency
            use a ±10% target band. Values significantly above or below
            goal are both flagged red. For Accounts Receivable, too high
            ties up cash and too low can signal slower sales. For
            Utilization and Labor Efficiency, too high can signal over-
            capacity or burnout on the team.
          </Text>
        )}

        <Text style={styles.footer}>
          Generated {generatedOn} · {data.brandName}
        </Text>
      </Page>
    </Document>
  )
}

// -----------------------------------------------------------------------------
// CapacityTable — Utilization section. Section title + one sub-section
// per capacity group; each group's metrics (Utilization / Labor Hours /
// Labor Efficiency) render as standard KPI rows using the same
// 5-column layout (KPI / Actual / Goal / Variance / Indicator) as the
// rest of the report.
// -----------------------------------------------------------------------------

function CapacityTable({
  section,
  showPace,
}: {
  section: CapacitySectionData
  showPace: boolean
}) {
  const metrics: { key: keyof CapacityGroupData; label: string }[] = [
    { key: 'utilization', label: 'Utilization' },
    { key: 'laborHours', label: 'Labor Hours' },
    { key: 'laborEfficiency', label: 'Labor Efficiency' },
  ]
  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      {section.groups.map((group) => {
        const cells = metrics
          .map((m) => ({ ...m, cell: group[m.key] as CapacityCell | null }))
          .filter((m) => m.cell != null)
        if (cells.length === 0) return null
        return (
          <View key={group.name} wrap={false}>
            <Text style={styles.subSectionTitle}>{group.name}</Text>
            {cells.map(({ label, cell }) => (
              <CapacityMetricRow
                key={label}
                label={label}
                cell={cell as CapacityCell}
                showPace={showPace}
              />
            ))}
          </View>
        )
      })}
    </View>
  )
}

function CapacityMetricRow({
  label,
  cell,
  showPace,
}: {
  label: string
  cell: CapacityCell
  showPace: boolean
}) {
  // Same pace handling as the main KPI rows: arrow + variance compare
  // actual vs pace in cumulative modes, vs goal in weekly. For range
  // capacity cells (Utilization, Labor Efficiency) paceGoal === goal.
  const comparisonGoal = cell.paceGoal ?? cell.goal
  // Within-10% text for range cells (Utilization, Labor Efficiency) —
  // matches the Accounts Receivable rule elsewhere. Labor Hours is
  // hi-direction and shows the colored arrow instead.
  const showWithinTen =
    cell.range && isWithinTen(cell.value, comparisonGoal)
  const arrow = arrowFor(cell.value, comparisonGoal, cell.direction, cell.range)
  return (
    <View style={styles.row}>
      <Text style={styles.capacityRowLabel}>{label}</Text>
      <Text style={styles.colActual}>{formatVal(cell.value, cell.format)}</Text>
      {showPace && (
        <Text style={styles.colPace}>
          {cell.paceGoal == null ? '—' : formatVal(cell.paceGoal, cell.format)}
        </Text>
      )}
      <Text style={styles.colGoal}>
        {cell.goal == null ? '—' : formatVal(cell.goal, cell.format)}
      </Text>
      <Text style={styles.colVariance}>
        {formatVariance(cell.value, comparisonGoal, cell.format)}
      </Text>
      <View style={styles.colIndicator}>
        {showWithinTen ? (
          <Text style={styles.withinTen}>±10%</Text>
        ) : (
          arrow && <Arrow spec={arrow} />
        )}
      </View>
    </View>
  )
}
