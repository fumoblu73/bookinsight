import type { EvidenceReview } from '../lib/evidence-review'
import { MARKET_BASIS, SELECTION_BASIS, UNCHANGED_SCORES, summarizeReportSelection } from '../lib/report-selection'

export function SelectionScopeNote() {
  return <p className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs text-indigo-900">
    <strong>Base delle testimonianze:</strong> solo i pain point e le testimonianze mantenuti nella selezione riportata all’inizio del report. Le valutazioni strategiche considerano anche dati di mercato, competitor e trend.
  </p>
}

export default function ReportSelection({ review }: { review?: EvidenceReview }) {
  const summary = summarizeReportSelection(review)
  if (!summary) return null
  const excluded = summary.painPoints.filter(p => !p.selected)
  return <section aria-label="Selezione utilizzata nel report" className="report-section rounded-2xl border border-indigo-200 bg-indigo-50 p-6 print:bg-white">
    <h2 className="text-lg font-bold text-indigo-950">Selezione utilizzata nel report</h2>
    <p className="mt-2 text-sm text-indigo-950">{SELECTION_BASIS}</p>
    <p className="mt-2 text-sm font-semibold text-indigo-950">
      Pain point mantenuti: {summary.selectedPainPoints} su {summary.painPoints.length} · Esclusi: {summary.excludedPainPoints}.
    </p>
    <p className="mt-1 text-sm font-semibold text-indigo-950">
      Testimonianze utilizzate: {summary.testimonies.selected} su {summary.testimonies.available} · Non utilizzate: {summary.testimonies.unused}.
    </p>
    <p className="mt-1 text-xs text-indigo-900">Testimonianze distinte, contate una sola volta anche se mantenute per più pain point. Tra quelle non utilizzate, {summary.testimonies.ungrouped} non erano raggruppate.</p>
    <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-indigo-900">
      {summary.testimonies.bySource.map(s => <li key={s.source}>{s.source === 'reddit' ? 'Reddit' : s.source === 'youtube' ? 'YouTube' : 'Amazon'}: {s.selected}/{s.available} utilizzate</li>)}
    </ul>
    <h3 className="mt-4 text-sm font-bold text-indigo-950">Pain point mantenuti</h3>
    <ul className="mt-2 space-y-2 text-sm text-indigo-950">
      {summary.painPoints.filter(p => p.selected).map(p => <li key={p.id} className="print:break-inside-avoid">
        <span className="font-medium">✓ {p.pain_point}</span>
        <span className="block text-xs">Testimonianze mantenute: {p.selectedRecordIds.length} · Escluse da questo gruppo: {p.excludedRecordIds.length}.</span>
      </li>)}
    </ul>
    <details className="mt-4 text-sm text-indigo-950">
      <summary className="cursor-pointer font-semibold">Pain point esclusi dall’analisi ({excluded.length})</summary>
      {excluded.length ? <ul className="mt-2 space-y-1">{excluded.map(p => <li key={p.id}>Escluso: {p.pain_point}</li>)}</ul>
        : <p className="mt-2 text-xs">Nessun pain point escluso.</p>}
    </details>
    <p className="mt-4 text-xs text-indigo-900">I testi mantenuti e quelli esclusi da ogni gruppo sono consultabili nella sezione Pain Points. Una testimonianza esclusa da un gruppo può essere mantenuta per un altro pain point.</p>
    <p className="mt-2 text-xs text-zinc-700">{MARKET_BASIS}</p>
    <p className="mt-2 text-xs text-zinc-700">{UNCHANGED_SCORES}</p>
  </section>
}
