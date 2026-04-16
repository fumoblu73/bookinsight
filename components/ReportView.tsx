'use client'

import type { Market } from '@/lib/types'

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface FullReport {
  id: string
  keyword: string
  market: Market
  createdAt: string
  profitabilityScore: number
  scoringBreakdown: {
    demandScore: number; royaltyScore: number; competitionScore: number
    trendScore: number; complianceScore: number
    entryDifficulty: 'FACILE' | 'MEDIO' | 'DIFFICILE'
    trendSignal: 'CRESCITA' | 'STABILE' | 'DECLINO' | 'N/A'
    avgRoyalty: number; avgBsr: number
  }
  keyInsights: { insight: string; tipo: string }[]
  competitorTarget: {
    asin: string; title: string; bsr: number; price: number
    currency: string; reviewCount: number; rating: number; pages: number
    publisher?: string; selfPublished: boolean
  }
  passo0: {
    angolo: string; target_reader: string; usp: string
    punti_forza: string[]; punti_debolezza: string[]
    confidence: 'ALTA' | 'MEDIA' | 'BASSA'
  }
  trends: { available: boolean; yoyGrowth: number; relatedQueries: { query: string; value: number; growthYoY: number }[] }
  trendForecast: { classificazione: string; narrativa: string; stagionalita: string | null; query_emergenti: string[] } | null
  painPoints: { pain_point: string; score: number; F: number; I: number; S: number; evidence: string; criticalSignal?: boolean }[]
  gapAnalysis: {
    passo1_problemi_non_risolti: { items: string[] }
    passo2_angoli_mancanti: { items: string[] }
    passo4_target_non_servito: { segmento: string; dimensione: string }
    passo5_tesi_libro: { titolo_proposto: string; sottotitolo: string; hook: string; differenziatori: string[] }
    gap_inventory_table: { gap: string; tipo: string; priorita: 'ALTA' | 'MEDIA' | 'BASSA'; opportunita: string }[]
  }
  seriesStrategy: {
    verdetto: 'INVEST' | 'PARTIAL' | 'PASS'
    motivazione_verdetto: string
    libro_1: { titolo: string; focus: string; pagine_target: number; tempo_scrittura_settimane: number }
    libro_2: { titolo: string; focus: string; timing: string }
    libro_3: { titolo: string; focus: string; condizione: string }
    strategia_lancio: string
    rischi_principali: string[]
  }
  roi: {
    avgDailySalesMin: number; avgDailySalesMax: number
    avgMonthlyRevenueMin: number; avgMonthlyRevenueMax: number
    breakEvenMonths: number; bepSignal: 'VERDE' | 'GIALLO' | 'ROSSO'
    suggestedAdsMonthly: number; cashflowBuffer: number
    roiCluster12mMin: number; roiCluster12mMax: number
    investVerdict: 'INVEST' | 'PARTIAL' | 'PASS'
  }
  roiNarrative: { blocco_scenario: string; blocco_budget: string; blocco_timeline: string; blocco_verdetto: string }
  budget: number
  subNiches: { keyword: string; bsr: number; reviewCount: number; vulnerable: boolean }[]
  complianceCategory: string
  complianceRisk: 'alto' | 'medio' | 'basso'
}

// ─── Helpers colore ───────────────────────────────────────────────────────────

function scoreColor(s: number) {
  if (s >= 70) return 'text-green-600'
  if (s >= 40) return 'text-amber-500'
  return 'text-red-500'
}
function scoreBg(s: number) {
  if (s >= 70) return 'bg-green-50 border-green-200'
  if (s >= 40) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}
function verdettoBadge(v: 'INVEST' | 'PARTIAL' | 'PASS') {
  if (v === 'INVEST') return 'bg-green-100 text-green-800'
  if (v === 'PARTIAL') return 'bg-amber-100 text-amber-800'
  return 'bg-red-100 text-red-800'
}
function difficultyColor(d: 'FACILE' | 'MEDIO' | 'DIFFICILE') {
  if (d === 'FACILE') return 'text-green-600'
  if (d === 'MEDIO') return 'text-amber-500'
  return 'text-red-500'
}
function trendColor(t: string) {
  if (t === 'CRESCITA') return 'text-green-600'
  if (t === 'DECLINO') return 'text-red-500'
  return 'text-zinc-500'
}
function bepColor(s: 'VERDE' | 'GIALLO' | 'ROSSO') {
  if (s === 'VERDE') return 'text-green-600'
  if (s === 'GIALLO') return 'text-amber-500'
  return 'text-red-500'
}
function prioritaBadge(p: 'ALTA' | 'MEDIA' | 'BASSA') {
  if (p === 'ALTA') return 'bg-red-100 text-red-700'
  if (p === 'MEDIA') return 'bg-amber-100 text-amber-700'
  return 'bg-zinc-100 text-zinc-600'
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ num, title, children, className = '' }: { num: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white rounded-xl border border-zinc-200 p-6 ${className}`}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1">§{num}</h2>
      <h3 className="text-lg font-bold text-zinc-900 mb-4">{title}</h3>
      {children}
    </section>
  )
}

// ─── ScoreBar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-sm text-zinc-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-zinc-100 rounded-full overflow-hidden">
        <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${value * 10}%` }} />
      </div>
      <span className="text-sm font-medium w-6 text-right">{value}</span>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportView({ report }: { report: FullReport }) {
  const { scoringBreakdown: sb, roi } = report

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{report.keyword}</h1>
          <p className="text-sm text-zinc-500 mt-0.5">
            Mercato {report.market} · {new Date(report.createdAt).toLocaleDateString('it-IT')} · ID: {report.id}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-50 transition-colors"
          >
            Stampa / PDF
          </button>
          <a href="/history" className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors">
            Storico
          </a>
        </div>
      </div>

      {/* §1 Key Insights */}
      <Section num="1" title="Key Insights">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {report.keyInsights.map((ins, i) => (
            <div key={i} className="p-3 rounded-lg bg-zinc-50 border border-zinc-100">
              <span className="inline-block text-xs font-medium text-blue-600 bg-blue-50 rounded px-1.5 py-0.5 mb-1.5 capitalize">
                {ins.tipo}
              </span>
              <p className="text-sm text-zinc-700 leading-relaxed">{ins.insight}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* §2 Profitability Score */}
      <Section num="2" title="Profitability Score">
        <div className="flex gap-6 flex-wrap">
          <div className={`flex flex-col items-center justify-center w-28 h-28 rounded-full border-4 ${scoreBg(report.profitabilityScore)} shrink-0`}>
            <span className={`text-4xl font-black ${scoreColor(report.profitabilityScore)}`}>{report.profitabilityScore}</span>
            <span className="text-xs text-zinc-400 mt-0.5">/100</span>
          </div>
          <div className="flex-1 min-w-48 space-y-2">
            <ScoreBar label="Domanda (30%)" value={sb.demandScore} />
            <ScoreBar label="Royalty (25%)" value={sb.royaltyScore} />
            <ScoreBar label="Competizione (20%)" value={sb.competitionScore} />
            <ScoreBar label="Trend (15%)" value={sb.trendScore} />
            <ScoreBar label="Compliance (10%)" value={sb.complianceScore} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-zinc-100 text-sm">
          <span>BSR medio: <strong>{sb.avgBsr.toLocaleString('it-IT')}</strong></span>
          <span>Royalty media: <strong>${sb.avgRoyalty.toFixed(2)}</strong></span>
          <span>Difficoltà: <strong className={difficultyColor(sb.entryDifficulty)}>{sb.entryDifficulty}</strong></span>
          <span>Trend: <strong className={trendColor(sb.trendSignal)}>{sb.trendSignal}</strong></span>
          <span>Compliance: <strong>{report.complianceCategory}</strong> ({report.complianceRisk})</span>
        </div>
        {report.subNiches.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Sub-nicchie rilevate</p>
            <div className="flex flex-wrap gap-2">
              {report.subNiches.map((s, i) => (
                <span key={i} className={`text-xs px-2.5 py-1 rounded-full border ${s.vulnerable ? 'bg-green-50 border-green-200 text-green-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600'}`}>
                  {s.keyword} · BSR {s.bsr.toLocaleString('it-IT')}
                  {s.vulnerable && ' ✓ vulnerabile'}
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      {/* §3 Top Competitor */}
      <Section num="3" title="Top Competitor & Posizionamento">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="p-4 bg-zinc-50 rounded-lg border border-zinc-200">
            <p className="text-xs text-zinc-400 font-medium mb-1">TARGET COMPETITOR</p>
            <p className="font-semibold text-zinc-900 text-sm leading-snug mb-2">{report.competitorTarget.title}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-600">
              <span>ASIN: <a href={`https://www.amazon.com/dp/${report.competitorTarget.asin}`} target="_blank" rel="noreferrer" className="text-blue-600 underline">{report.competitorTarget.asin}</a></span>
              <span>BSR: {report.competitorTarget.bsr.toLocaleString('it-IT')}</span>
              <span>Prezzo: {report.competitorTarget.currency}{report.competitorTarget.price}</span>
              <span>Recensioni: {report.competitorTarget.reviewCount}</span>
              <span>Rating: {report.competitorTarget.rating}/5</span>
              <span>Pagine: {report.competitorTarget.pages}</span>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Angolo', value: report.passo0.angolo },
              { label: 'Target reader', value: report.passo0.target_reader },
              { label: 'USP', value: report.passo0.usp },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                <p className="text-xs font-semibold text-blue-500 mb-0.5">{label.toUpperCase()}</p>
                <p className="text-sm text-zinc-800">{value}</p>
              </div>
            ))}
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-1 rounded bg-green-50 text-green-700 border border-green-100">
                + {report.passo0.punti_forza.slice(0, 2).join(' · ')}
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* §4 Trend Analysis */}
      <Section num="4" title="Trend Analysis">
        {!report.trends.available ? (
          <p className="text-sm text-zinc-400 italic">Dati Google Trends non disponibili per questa keyword.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4 flex-wrap">
              <div className={`text-2xl font-bold ${trendColor(report.trendForecast?.classificazione ?? sb.trendSignal)}`}>
                {report.trendForecast?.classificazione ?? sb.trendSignal}
              </div>
              <span className="text-sm text-zinc-500">
                YoY: <strong className={report.trends.yoyGrowth >= 0 ? 'text-green-600' : 'text-red-500'}>
                  {report.trends.yoyGrowth > 0 ? '+' : ''}{report.trends.yoyGrowth}%
                </strong>
              </span>
              {report.trendForecast?.stagionalita && (
                <span className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded border border-amber-100">
                  Stagionale: {report.trendForecast.stagionalita}
                </span>
              )}
            </div>
            {report.trendForecast?.narrativa && (
              <p className="text-sm text-zinc-600 leading-relaxed">{report.trendForecast.narrativa}</p>
            )}
            {report.trends.relatedQueries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Query correlate</p>
                <div className="flex flex-wrap gap-2">
                  {report.trends.relatedQueries.slice(0, 8).map((q, i) => (
                    <span key={i} className="text-xs px-2 py-1 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
                      {q.query} <span className={q.growthYoY >= 50 ? 'text-green-600' : 'text-zinc-400'}>
                        {q.growthYoY > 0 ? '+' : ''}{q.growthYoY}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* §5 Gap Analysis */}
      <Section num="5" title="Gap Analysis & Pain Points" className="print-break-before">
        <div className="grid sm:grid-cols-2 gap-6">
          <div className="space-y-4">
            {/* Pain Points */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Top Pain Points</p>
              {report.painPoints.length > 0 ? (
                <div className="space-y-1.5">
                  {report.painPoints.slice(0, 5).map((pp, i) => (
                    <div key={i} className={`p-2.5 rounded-lg border text-sm ${pp.criticalSignal ? 'bg-red-50 border-red-200' : 'bg-zinc-50 border-zinc-200'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-zinc-800 leading-snug">{pp.pain_point}</span>
                        <span className={`shrink-0 font-bold text-xs px-1.5 py-0.5 rounded ${pp.criticalSignal ? 'bg-red-100 text-red-700' : 'bg-zinc-200 text-zinc-600'}`}>
                          {pp.criticalSignal ? '⚠' : ''} {pp.score}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1 italic">{pp.evidence}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-zinc-400 italic">
                  Nessun dato Reddit disponibile per questa keyword — i pain points sono stati inferiti dal contesto Amazon nella Gap Analysis.
                </p>
              )}
            </div>
            {/* Problemi non risolti */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Problemi non risolti dai competitor</p>
              <ul className="space-y-1">
                {report.gapAnalysis.passo1_problemi_non_risolti.items.map((item, i) => (
                  <li key={i} className="text-sm text-zinc-700 flex gap-2"><span className="text-zinc-400 shrink-0">→</span>{item}</li>
                ))}
              </ul>
            </div>
            {/* Angoli mancanti */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1.5">Angoli non coperti</p>
              <ul className="space-y-1">
                {report.gapAnalysis.passo2_angoli_mancanti.items.map((item, i) => (
                  <li key={i} className="text-sm text-zinc-700 flex gap-2"><span className="text-zinc-400 shrink-0">→</span>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="space-y-4">
            {/* Tesi libro */}
            <div className="p-4 rounded-xl bg-blue-600 text-white">
              <p className="text-xs font-semibold opacity-70 mb-1 uppercase tracking-wide">Libro proposto</p>
              <p className="font-bold text-lg leading-snug">{report.gapAnalysis.passo5_tesi_libro.titolo_proposto}</p>
              <p className="text-sm opacity-80 mt-1">{report.gapAnalysis.passo5_tesi_libro.sottotitolo}</p>
              <p className="text-sm mt-2 italic opacity-90">"{report.gapAnalysis.passo5_tesi_libro.hook}"</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {report.gapAnalysis.passo5_tesi_libro.differenziatori.map((d, i) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-white/20">{d}</span>
                ))}
              </div>
            </div>
            {/* Gap Inventory */}
            <div>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Gap Inventory</p>
              <div className="space-y-1.5">
                {report.gapAnalysis.gap_inventory_table.slice(0, 5).map((g, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={`shrink-0 mt-0.5 text-xs px-1.5 py-0.5 rounded font-medium ${prioritaBadge(g.priorita)}`}>{g.priorita}</span>
                    <div>
                      <span className="font-medium text-zinc-800">{g.gap}</span>
                      <span className="text-zinc-400"> · {g.opportunita}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* §6 Series Strategy */}
      <Section num="6" title="Series Strategy">
        <div className="flex items-center gap-3 mb-4">
          <span className={`text-xl font-black px-4 py-1.5 rounded-full ${verdettoBadge(report.seriesStrategy.verdetto)}`}>
            {report.seriesStrategy.verdetto}
          </span>
          <p className="text-sm text-zinc-600 leading-relaxed">{report.seriesStrategy.motivazione_verdetto}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          {[
            { n: '1', data: report.seriesStrategy.libro_1, sub: `${report.seriesStrategy.libro_1.pagine_target}p · ${report.seriesStrategy.libro_1.tempo_scrittura_settimane} sett.` },
            { n: '2', data: report.seriesStrategy.libro_2, sub: report.seriesStrategy.libro_2.timing },
            { n: '3', data: report.seriesStrategy.libro_3, sub: report.seriesStrategy.libro_3.condizione },
          ].map(({ n, data, sub }) => (
            <div key={n} className="p-3 rounded-lg border border-zinc-200 bg-zinc-50">
              <span className="text-xs font-bold text-zinc-400">Vol. {n}</span>
              <p className="font-semibold text-zinc-900 text-sm mt-1 leading-snug">{data.titolo}</p>
              <p className="text-xs text-zinc-500 mt-1">{data.focus}</p>
              <p className="text-xs text-zinc-400 mt-1 italic">{sub}</p>
            </div>
          ))}
        </div>
        <div className="text-sm text-zinc-600 bg-zinc-50 rounded-lg p-3 border border-zinc-200">
          <span className="font-semibold text-zinc-700">Strategia lancio: </span>{report.seriesStrategy.strategia_lancio}
        </div>
      </Section>

      {/* §7 Investment & ROI */}
      <Section num="7" title="Investment & ROI" className="print-break-before">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Vendite/giorno', value: `${roi.avgDailySalesMin}–${roi.avgDailySalesMax}` },
            { label: 'Ricavo mensile', value: `$${roi.avgMonthlyRevenueMin}–$${roi.avgMonthlyRevenueMax}` },
            { label: 'Break-even', value: `${roi.breakEvenMonths} mesi`, extra: roi.bepSignal, color: bepColor(roi.bepSignal) },
            { label: 'ROI 12 mesi', value: `$${roi.roiCluster12mMin}–$${roi.roiCluster12mMax}` },
          ].map(({ label, value, extra, color }) => (
            <div key={label} className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-center">
              <p className="text-xs text-zinc-400 mb-1">{label}</p>
              <p className="font-bold text-zinc-900">{value}</p>
              {extra && <span className={`text-xs font-semibold ${color}`}>{extra}</span>}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-xs text-zinc-500 text-center">
          <div><span className="block font-medium text-zinc-700">${report.budget}</span>Budget totale</div>
          <div><span className="block font-medium text-zinc-700">${roi.suggestedAdsMonthly}/mese</span>Ads consigliati</div>
          <div><span className="block font-medium text-zinc-700">${roi.cashflowBuffer}</span>Buffer cashflow</div>
          <div><span className={`block font-bold text-base ${verdettoBadge(roi.investVerdict).includes('green') ? 'text-green-700' : roi.investVerdict === 'PARTIAL' ? 'text-amber-700' : 'text-red-600'}`}>{roi.investVerdict}</span>Verdetto</div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            { label: 'Scenario', text: report.roiNarrative.blocco_scenario },
            { label: 'Budget', text: report.roiNarrative.blocco_budget },
            { label: 'Timeline', text: report.roiNarrative.blocco_timeline },
            { label: 'Verdetto', text: report.roiNarrative.blocco_verdetto },
          ].map(({ label, text }) => (
            <div key={label} className="p-3 rounded-lg bg-zinc-50 border border-zinc-200">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">{label}</p>
              <p className="text-sm text-zinc-700 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}
