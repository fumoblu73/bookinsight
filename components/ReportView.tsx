'use client'

import type { Market } from '@/lib/types'

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface FullReport {
  id: string
  keyword: string
  market: Market
  createdAt: string
  cpc?: number
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIPO_COLOR: Record<string, string> = {
  rischio:     'text-rose-600 bg-rose-50 border-rose-200',
  mercato:     'text-sky-600 bg-sky-50 border-sky-200',
  opportunita: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  trend:       'text-violet-600 bg-violet-50 border-violet-200',
  competitor:  'text-amber-600 bg-amber-50 border-amber-200',
  suggerimento:'text-indigo-600 bg-indigo-50 border-indigo-200',
}
function tipoStyle(tipo: string) {
  return TIPO_COLOR[tipo.toLowerCase()] ?? 'text-zinc-600 bg-zinc-50 border-zinc-200'
}
function scoreColor(s: number) {
  if (s >= 70) return 'text-emerald-600'
  if (s >= 40) return 'text-amber-500'
  return 'text-rose-500'
}
function scoreBorder(s: number) {
  if (s >= 70) return 'border-emerald-300'
  if (s >= 40) return 'border-amber-300'
  return 'border-rose-300'
}
function verdettoCls(v: 'INVEST' | 'PARTIAL' | 'PASS') {
  if (v === 'INVEST')  return 'bg-emerald-600 text-white'
  if (v === 'PARTIAL') return 'bg-amber-500 text-white'
  return 'bg-rose-500 text-white'
}
function difficultyColor(d: string) {
  if (d === 'FACILE') return 'text-emerald-600'
  if (d === 'MEDIO')  return 'text-amber-500'
  return 'text-rose-500'
}
function trendColor(t: string) {
  if (t === 'CRESCITA') return 'text-emerald-600'
  if (t === 'DECLINO')  return 'text-rose-500'
  return 'text-zinc-500'
}
function bepColor(s: string) {
  if (s === 'VERDE')  return 'text-emerald-600'
  if (s === 'GIALLO') return 'text-amber-500'
  return 'text-rose-500'
}
function prioritaCls(p: string) {
  if (p === 'ALTA')  return 'bg-rose-100 text-rose-700'
  if (p === 'MEDIA') return 'bg-amber-100 text-amber-700'
  return 'bg-zinc-100 text-zinc-500'
}
function fmt(n: number, dec = 2) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

// Parsa la strategia lancio in punti numerati (es. "1) ... 2) ...")
function parseStrategiaLancio(text: string): string[] {
  return text
    .split(/(?=\d+\)\s)/)
    .map(p => p.replace(/^\d+\)\s+/, '').trim())
    .filter(Boolean)
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ num, title, children, breakBefore = true }: {
  num: string; title: string; children: React.ReactNode; breakBefore?: boolean
}) {
  return (
    <section className={`report-section bg-white rounded-2xl border border-zinc-200 shadow-sm overflow-hidden${breakBefore ? ' print-break-before' : ''}`}>
      <div className="px-7 py-4 border-b border-zinc-100 bg-gradient-to-r from-zinc-50 to-white flex items-baseline gap-3">
        <span className="text-xs font-bold tracking-widest text-zinc-400 shrink-0">§{num}</span>
        <h2 className="text-base font-bold text-zinc-800">{title}</h2>
      </div>
      <div className="px-7 py-5">
        {children}
      </div>
    </section>
  )
}

// ─── ScoreBar ─────────────────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = value * 10
  const barColor = value >= 7 ? 'bg-emerald-400' : value >= 4 ? 'bg-amber-400' : 'bg-rose-400'
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 text-sm text-zinc-500 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold w-5 text-right text-zinc-700">{value}</span>
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, subColor = '' }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-4 bg-zinc-50 rounded-xl border border-zinc-200 text-center gap-0.5 print:break-inside-avoid">
      <span className="text-xs text-zinc-400 mb-1">{label}</span>
      <span className="text-lg font-bold text-zinc-900 leading-none">{value}</span>
      {sub && <span className={`text-xs font-semibold mt-0.5 ${subColor}`}>{sub}</span>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportView({ report }: { report: FullReport }) {
  const { scoringBreakdown: sb, roi } = report
  const date = new Date(report.createdAt).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'long', year: 'numeric'
  })

  const strategiaSteps = parseStrategiaLancio(report.seriesStrategy.strategia_lancio)

  return (
    <div className="space-y-4 report-root">

      {/* ── COPERTINA (solo stampa) ──────────────────────────────────────── */}
      <div className="print-cover hidden print:flex flex-col justify-between min-h-screen print:min-h-0 print:h-screen print:overflow-hidden px-16 py-20 print:px-12 print:py-10 bg-white">
        {/* Logo */}
        <div>
          <p className="text-xs font-bold tracking-[0.3em] text-zinc-400 uppercase mb-1">BookInsight</p>
          <p className="text-xs text-zinc-300">Analisi Nicchie Amazon KDP</p>
        </div>

        {/* Titolo */}
        <div className="flex-1 flex flex-col justify-center">
          <p className="text-xs font-semibold tracking-widest text-indigo-500 uppercase mb-4">Report di analisi</p>
          <h1 className="text-5xl print:text-4xl font-black text-zinc-900 leading-tight mb-4">{report.keyword}</h1>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-full px-4 py-1.5">
              Mercato {report.market}
            </span>
            <span className="text-sm text-zinc-400">{date}</span>
            {report.cpc && (
              <span className="text-sm text-zinc-400">CPC Amazon Ads: ${report.cpc.toFixed(2)}</span>
            )}
          </div>
        </div>

        {/* Score in basso */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-zinc-400 mb-1">Profitability Score</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-6xl print:text-5xl font-black ${scoreColor(report.profitabilityScore)}`}>
                {report.profitabilityScore}
              </span>
              <span className="text-2xl text-zinc-300 font-light">/100</span>
            </div>
          </div>
          <div className="text-right text-xs text-zinc-300">
            <p>ID: {report.id}</p>
            <p className="mt-0.5">bookinsight.vercel.app</p>
          </div>
        </div>
      </div>

      {/* ── HEADER (solo schermo) ────────────────────────────────────────── */}
      <div className="no-print flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">{report.keyword}</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            Mercato {report.market} · {date}
            {report.cpc ? ` · CPC Amazon Ads $${report.cpc.toFixed(2)}` : ''}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => {
              const d = new Date(report.createdAt)
              const aa = String(d.getFullYear()).slice(-2)
              const mm = String(d.getMonth() + 1).padStart(2, '0')
              const gg = String(d.getDate()).padStart(2, '0')
              const filename = `${aa}${mm}${gg} BookInsight - ${report.keyword} (${report.market})`
              const prev = document.title
              document.title = filename
              window.print()
              window.addEventListener('afterprint', () => { document.title = prev }, { once: true })
            }}
            className="px-4 py-2 text-sm rounded-lg border border-zinc-300 hover:bg-zinc-50 transition-colors font-medium"
          >
            Stampa / PDF
          </button>
          <a href="/history" className="px-4 py-2 text-sm rounded-lg bg-zinc-900 text-white hover:bg-zinc-700 transition-colors font-medium">
            Storico
          </a>
        </div>
      </div>

      {/* ── §1 + §2 condividono la stessa pagina di stampa ──────────────── */}
      <div className="print-break-before space-y-4">

        {/* §1 Key Insights */}
        <Section num="1" title="Key Insights" breakBefore={false}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {report.keyInsights.map((ins, i) => (
              <div key={i} className={`p-4 rounded-xl border print:break-inside-avoid ${tipoStyle(ins.tipo)}`}>
                <span className="inline-block text-xs font-semibold rounded-full px-2 py-0.5 mb-2 capitalize border border-current/20 bg-current/10">
                  {ins.tipo}
                </span>
                <p className="text-sm text-zinc-700 leading-relaxed">{ins.insight}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* §2 Profitability Score */}
        <Section num="2" title="Profitability Score" breakBefore={false}>
          <div className="flex gap-8 flex-wrap items-center print:break-inside-avoid">
            <div className={`relative flex items-center justify-center w-32 h-32 rounded-full border-8 ${scoreBorder(report.profitabilityScore)} shrink-0`}>
              <div className="text-center">
                <span className={`text-4xl font-black leading-none ${scoreColor(report.profitabilityScore)}`}>
                  {report.profitabilityScore}
                </span>
                <span className="block text-xs text-zinc-400 font-medium">/100</span>
              </div>
            </div>
            <div className="flex-1 min-w-56 space-y-2.5">
              <ScoreBar label="Domanda (30%)" value={sb.demandScore} />
              <ScoreBar label="Royalty (25%)" value={sb.royaltyScore} />
              <ScoreBar label="Competizione (20%)" value={sb.competitionScore} />
              <ScoreBar label="Trend (15%)" value={sb.trendScore} />
              <ScoreBar label="Compliance (10%)" value={sb.complianceScore} />
            </div>
          </div>
          <div className="flex flex-wrap gap-5 mt-5 pt-4 border-t border-zinc-100 text-sm">
            <span className="text-zinc-500">BSR medio: <strong className="text-zinc-800">{sb.avgBsr.toLocaleString('it-IT')}</strong></span>
            <span className="text-zinc-500">Royalty media: <strong className="text-zinc-800">${fmt(sb.avgRoyalty)}</strong></span>
            <span className="text-zinc-500">Difficoltà: <strong className={difficultyColor(sb.entryDifficulty)}>{sb.entryDifficulty}</strong></span>
            <span className="text-zinc-500">Trend: <strong className={trendColor(sb.trendSignal)}>{sb.trendSignal}</strong></span>
            <span className="text-zinc-500">Compliance: <strong className="text-zinc-800">{report.complianceCategory}</strong> <span className="text-zinc-400">({report.complianceRisk})</span></span>
          </div>
          {report.subNiches.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">Sub-nicchie rilevate</p>
              <div className="flex flex-wrap gap-2">
                {report.subNiches.map((s, i) => (
                  <span key={i} className={`text-xs px-3 py-1 rounded-full border font-medium ${s.vulnerable ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600'}`}>
                    {s.keyword} · BSR {s.bsr.toLocaleString('it-IT')}
                    {s.vulnerable && <span className="ml-1 opacity-70">✓</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

      </div>

      {/* §3 Top Competitor */}
      <Section num="3" title="Top Competitor & Posizionamento">
        <div className="grid sm:grid-cols-2 gap-5">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5 print:break-inside-avoid">
            <p className="text-xs font-bold text-zinc-400 tracking-widest uppercase mb-2">Target Competitor</p>
            <p className="font-bold text-zinc-900 text-sm leading-snug mb-4">{report.competitorTarget.title}</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
              {[
                ['ASIN', <a key="a" href={`https://www.amazon.com/dp/${report.competitorTarget.asin}`} target="_blank" rel="noreferrer" className="text-indigo-600 underline underline-offset-2">{report.competitorTarget.asin}</a>],
                ['BSR', report.competitorTarget.bsr.toLocaleString('it-IT')],
                ['Prezzo', `${report.competitorTarget.currency}${report.competitorTarget.price}`],
                ['Recensioni', report.competitorTarget.reviewCount.toLocaleString('it-IT')],
                ['Rating', `${report.competitorTarget.rating}/5`],
                ['Pagine', report.competitorTarget.pages],
              ].map(([k, v]) => (
                <div key={String(k)}>
                  <span className="text-zinc-400 mr-1">{k}:</span>
                  <span className="font-medium text-zinc-700">{v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Angolo', value: report.passo0.angolo, color: 'bg-indigo-50 border-indigo-100' },
              { label: 'Target Reader', value: report.passo0.target_reader, color: 'bg-sky-50 border-sky-100' },
              { label: 'USP', value: report.passo0.usp, color: 'bg-violet-50 border-violet-100' },
            ].map(({ label, value, color }) => (
              <div key={label} className={`p-3 rounded-xl border ${color} print:break-inside-avoid`}>
                <p className="text-xs font-bold text-zinc-400 tracking-widest uppercase mb-0.5">{label}</p>
                <p className="text-sm text-zinc-800 leading-snug">{value}</p>
              </div>
            ))}
            {report.passo0.punti_forza.length > 0 && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 print:break-inside-avoid">
                <p className="text-xs font-bold text-emerald-600 tracking-widest uppercase mb-1.5">Punti di forza</p>
                <ul className="space-y-1">
                  {report.passo0.punti_forza.slice(0, 3).map((p, i) => (
                    <li key={i} className="text-xs text-emerald-700 flex gap-1.5 leading-relaxed">
                      <span className="shrink-0 font-bold">+</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* §4 Trend Analysis */}
      <Section num="4" title="Trend Analysis">
        {!report.trends.available ? (
          <div className="flex items-center gap-3 text-sm text-zinc-400 italic py-2">
            <span className="text-2xl">—</span>
            <span>Dati Google Trends non disponibili per questa keyword.</span>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4 flex-wrap print:break-inside-avoid">
              <span className={`text-3xl font-black ${trendColor(report.trendForecast?.classificazione ?? sb.trendSignal)}`}>
                {report.trendForecast?.classificazione ?? sb.trendSignal}
              </span>
              <span className={`text-lg font-bold ${report.trends.yoyGrowth >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {report.trends.yoyGrowth > 0 ? '+' : ''}{report.trends.yoyGrowth}% YoY
              </span>
              {report.trendForecast?.stagionalita && (
                <span className="text-xs px-3 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-200 font-medium">
                  Stagionale: {report.trendForecast.stagionalita}
                </span>
              )}
            </div>
            {report.trendForecast?.narrativa && (
              <p className="text-sm text-zinc-600 leading-relaxed border-l-2 border-indigo-200 pl-4">
                {report.trendForecast.narrativa}
              </p>
            )}
            {report.trends.relatedQueries.length > 0 && (
              <div className="print:break-inside-avoid">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Query correlate</p>
                <div className="flex flex-wrap gap-2">
                  {report.trends.relatedQueries.slice(0, 8).map((q, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-zinc-600">
                      {q.query}
                      <span className={`font-semibold ${q.growthYoY >= 50 ? 'text-emerald-600' : q.growthYoY >= 20 ? 'text-amber-500' : 'text-zinc-400'}`}>
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

      {/* §5 Gap Analysis & Pain Points — 1 colonna sequenziale */}
      <Section num="5" title="Gap Analysis & Pain Points">
        <div className="space-y-6">

          {/* 1. Pain Points */}
          <div className="print:break-inside-avoid">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Top Pain Points</p>
            {report.painPoints.length > 0 ? (
              <ul className="space-y-2">
                {report.painPoints.slice(0, 5).map((pp, i) => (
                  <li key={i} className={`p-3 rounded-xl border list-none print:break-inside-avoid ${pp.criticalSignal ? 'bg-rose-50 border-rose-200' : 'bg-zinc-50 border-zinc-200'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-zinc-800 leading-snug">{pp.pain_point}</span>
                      <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${pp.criticalSignal ? 'bg-rose-100 text-rose-700' : 'bg-zinc-200 text-zinc-500'}`}>
                        {pp.criticalSignal ? '⚠ ' : ''}{pp.score}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-400 mt-1.5 italic">{pp.evidence}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-sm text-zinc-400 italic">
                  Nessun dato Reddit disponibile — pain points inferiti dal contesto Amazon nella Gap Analysis sottostante.
                </p>
              </div>
            )}
          </div>

          {/* 2. Problemi non risolti */}
          <div className="print:break-inside-avoid">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Problemi non risolti dai competitor</p>
            <ul className="space-y-1.5">
              {report.gapAnalysis.passo1_problemi_non_risolti.items.map((item, i) => (
                <li key={i} className="text-sm text-zinc-700 flex gap-2 leading-relaxed">
                  <span className="text-rose-400 shrink-0 mt-0.5">→</span>{item}
                </li>
              ))}
            </ul>
          </div>

          {/* 3. Angoli non coperti */}
          <div className="print:break-inside-avoid">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Angoli non coperti</p>
            <ul className="space-y-1.5">
              {report.gapAnalysis.passo2_angoli_mancanti.items.map((item, i) => (
                <li key={i} className="text-sm text-zinc-700 flex gap-2 leading-relaxed">
                  <span className="text-indigo-400 shrink-0 mt-0.5">→</span>{item}
                </li>
              ))}
            </ul>
          </div>

          {/* 4. Libro proposto */}
          <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-indigo-800 text-white p-5 print:break-inside-avoid">
            <p className="text-xs font-bold opacity-60 mb-2 uppercase tracking-widest">Libro proposto</p>
            <p className="font-black text-xl leading-snug">{report.gapAnalysis.passo5_tesi_libro.titolo_proposto}</p>
            <p className="text-sm opacity-75 mt-1.5 leading-relaxed">{report.gapAnalysis.passo5_tesi_libro.sottotitolo}</p>
            <p className="text-sm mt-3 italic opacity-80 border-l border-white/30 pl-3">{report.gapAnalysis.passo5_tesi_libro.hook}</p>
            {report.gapAnalysis.passo5_tesi_libro.differenziatori.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {report.gapAnalysis.passo5_tesi_libro.differenziatori.map((d, i) => (
                  <li key={i} className="text-xs opacity-80 flex gap-2 leading-relaxed">
                    <span className="shrink-0 opacity-50 font-bold">·</span>{d}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 5. Gap Inventory */}
          <div className="print:break-inside-avoid">
            <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Gap Inventory</p>
            <div className="space-y-2">
              {report.gapAnalysis.gap_inventory_table.slice(0, 5).map((g, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className={`shrink-0 mt-0.5 text-xs px-2 py-0.5 rounded-full font-semibold ${prioritaCls(g.priorita)}`}>
                    {g.priorita}
                  </span>
                  <div className="text-sm">
                    <span className="font-semibold text-zinc-800">{g.gap}</span>
                    <span className="text-zinc-400 text-xs"> · {g.opportunita}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </Section>

      {/* §6 Series Strategy */}
      <Section num="6" title="Series Strategy">
        {/* Verdetto */}
        <div className="flex items-start gap-4 mb-5 p-4 rounded-xl border border-zinc-100 bg-zinc-50 print:break-inside-avoid">
          <span className={`text-lg font-black px-5 py-2 rounded-xl shrink-0 ${verdettoCls(report.seriesStrategy.verdetto)}`}>
            {report.seriesStrategy.verdetto}
          </span>
          <p className="text-sm text-zinc-600 leading-relaxed pt-0.5">{report.seriesStrategy.motivazione_verdetto}</p>
        </div>
        {/* 3 volumi */}
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          {[
            { n: '1', data: report.seriesStrategy.libro_1, sub: `${report.seriesStrategy.libro_1.pagine_target}p · ${report.seriesStrategy.libro_1.tempo_scrittura_settimane} sett.` },
            { n: '2', data: report.seriesStrategy.libro_2, sub: report.seriesStrategy.libro_2.timing },
            { n: '3', data: report.seriesStrategy.libro_3, sub: report.seriesStrategy.libro_3.condizione },
          ].map(({ n, data, sub }) => (
            <div key={n} className="p-4 rounded-xl border border-zinc-200 bg-white print:break-inside-avoid">
              <p className="text-xs font-bold text-zinc-300 mb-1">Vol. {n}</p>
              <p className="font-bold text-zinc-900 text-sm leading-snug mb-1.5">{data.titolo}</p>
              <p className="text-xs text-zinc-500 leading-relaxed mb-2">{data.focus}</p>
              <p className="text-xs text-zinc-400 italic">{sub}</p>
            </div>
          ))}
        </div>
        {/* Strategia lancio — punti numerati */}
        <div className="rounded-xl bg-indigo-50 border border-indigo-100 p-4 print:break-inside-avoid">
          <p className="font-bold text-indigo-700 text-sm mb-3">Strategia lancio</p>
          {strategiaSteps.length > 1 ? (
            <ol className="space-y-2.5">
              {strategiaSteps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-sm text-zinc-700 leading-relaxed">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-200 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-700 leading-relaxed">{report.seriesStrategy.strategia_lancio}</p>
          )}
        </div>
      </Section>

      {/* §7 Investment & ROI */}
      <Section num="7" title="Investment & ROI">
        {/* KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <KpiCard label="Vendite/giorno"  value={`${roi.avgDailySalesMin}–${roi.avgDailySalesMax}`} />
          <KpiCard label="Ricavo mensile"  value={`$${fmt(roi.avgMonthlyRevenueMin, 0)}–$${fmt(roi.avgMonthlyRevenueMax, 0)}`} />
          <KpiCard label="Break-even"      value={`${roi.breakEvenMonths} mesi`} sub={roi.bepSignal} subColor={bepColor(roi.bepSignal)} />
          <KpiCard label="ROI 12 mesi"     value={`$${fmt(roi.roiCluster12mMin, 0)}–$${fmt(roi.roiCluster12mMax, 0)}`} />
        </div>
        {/* Budget row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-center">
          {[
            { label: 'Budget totale',   value: `$${fmt(report.budget, 0)}` },
            { label: 'Ads consigliati', value: `$${fmt(roi.suggestedAdsMonthly, 0)}/mese` },
            { label: 'Buffer cashflow', value: `$${fmt(roi.cashflowBuffer, 0)}` },
            ...(report.cpc
              ? [{ label: 'Click stimati/mese', value: `~${Math.round(roi.suggestedAdsMonthly / report.cpc).toLocaleString('it-IT')}` }]
              : [{ label: 'Verdetto', value: report.roi.investVerdict }]
            ),
          ].map(({ label, value }) => (
            <div key={label} className="p-3 rounded-xl border border-zinc-100 bg-zinc-50 text-center print:break-inside-avoid">
              <p className="text-xs text-zinc-400 mb-1">{label}</p>
              <p className={`text-base font-bold ${label === 'Verdetto' ? (report.roi.investVerdict === 'INVEST' ? 'text-emerald-600' : report.roi.investVerdict === 'PARTIAL' ? 'text-amber-500' : 'text-rose-500') : 'text-zinc-800'}`}>
                {value}
              </p>
            </div>
          ))}
        </div>
        {/* CPC info se presente */}
        {report.cpc && (
          <div className="mb-4 flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2">
            <span className="font-semibold">CPC Amazon Ads: ${report.cpc.toFixed(2)}</span>
            <span className="text-zinc-400">·</span>
            <span>Con il budget ads di ${fmt(roi.suggestedAdsMonthly, 0)}/mese puoi acquistare circa <strong>~{Math.round(roi.suggestedAdsMonthly / report.cpc).toLocaleString('it-IT')} click/mese</strong></span>
          </div>
        )}
        {/* 4 blocchi narrativa — 1 colonna in stampa */}
        <div className="grid sm:grid-cols-2 print:grid-cols-1 gap-3">
          {[
            { label: 'Scenario',  text: report.roiNarrative.blocco_scenario },
            { label: 'Budget',    text: report.roiNarrative.blocco_budget },
            { label: 'Timeline',  text: report.roiNarrative.blocco_timeline },
            { label: 'Verdetto',  text: report.roiNarrative.blocco_verdetto },
          ].map(({ label, text }) => (
            <div key={label} className="p-4 rounded-xl bg-zinc-50 border border-zinc-200 print:break-inside-avoid">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-1.5">{label}</p>
              <p className="text-sm text-zinc-700 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* §8 Come leggere questo report */}
      <Section num="8" title="Come leggere questo report">
        <div className="space-y-0 divide-y divide-zinc-100">
          {[
            {
              sec: '§1 — Key Insights',
              desc: 'Sintesi delle 6 osservazioni più rilevanti sulla nicchia, classificate per tipo (Mercato, Trend, Rischio, Opportunità, Competitor, Suggerimento). Leggilo per primo: offre un quadro immediato prima di entrare nel dettaglio.',
            },
            {
              sec: '§2 — Profitability Score',
              desc: 'Punteggio 0–100 calcolato su 5 dimensioni: Domanda (30%), Royalty (25%), Competizione (20%), Trend (15%), Compliance (10%). Verde ≥70 = nicchia attrattiva, Giallo 40–69 = selettiva, Rosso <40 = sconsigliata. L\'Entry Difficulty si basa sul leader di nicchia (posizione #1), non sul competitor target.',
            },
            {
              sec: '§3 — Top Competitor & Posizionamento',
              desc: 'Analisi del competitor più vulnerabile tra i top 5 Amazon per BSR e numero di recensioni. L\'AI ne estrae l\'Angolo editoriale, il Target Reader e l\'USP per aiutarti a capire come differenziarti. I punti di forza indicano cosa dovrai eguagliare o superare.',
            },
            {
              sec: '§4 — Trend Analysis',
              desc: 'Andamento della domanda su Google Trends negli ultimi 5 anni con crescita YoY (anno su anno). "Stagionale" indica picchi ricorrenti in determinati mesi: pianifica il lancio di conseguenza. Le query correlate sono sub-nicchie e termini in espansione da considerare nel titolo o sottotitolo.',
            },
            {
              sec: '§5 — Gap Analysis & Pain Points',
              desc: 'Il cuore strategico del report. I Pain Points provengono da Reddit e recensioni Amazon: sono i problemi reali espressi dai lettori. "Problemi non risolti" e "Angoli non coperti" identificano cosa manca ai libri esistenti. Il Libro proposto è la sintesi operativa con titolo, sottotitolo, hook e differenziatori chiave. La Gap Inventory classifica per priorità (ALTA/MEDIA/BASSA) ogni opportunità.',
            },
            {
              sec: '§6 — Series Strategy',
              desc: 'Strategia a 3 volumi: Vol.1 è il libro da scrivere subito, Vol.2 è l\'espansione naturale da pianificare dopo il lancio, Vol.3 è uno spin-off su nicchia adiacente da attivare al raggiungimento di soglie di vendita specifiche. Il verdetto INVEST/PARTIAL/PASS si basa sul ROI proiettato: INVEST = ROI 12m ≥2× budget. Il piano lancio include pricing, ARC team, Amazon Ads e contenuto organico.',
            },
            {
              sec: '§7 — Investment & ROI',
              desc: 'Analisi finanziaria con stime di vendite giornaliere, ricavi mensili, break-even e ROI a 12 mesi. I valori sono calcolati con la formula BSR→vendite calibrata su dati storici KDP, con moltiplicatori per mercato (US/UK/DE/IT/ES). Buffer cashflow = 2 mesi di budget ads: è la riserva raccomandata prima di scalare le campagne. BEP Verde = break-even ≤3 mesi, Giallo = 3–6 mesi, Rosso = >6 mesi.',
            },
          ].map(({ sec, desc }) => (
            <div key={sec} className="flex gap-4 py-3.5 print:break-inside-avoid">
              <div className="shrink-0 w-48 pt-0.5">
                <span className="text-xs font-bold text-indigo-700">{sec}</span>
              </div>
              <p className="text-sm text-zinc-600 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </Section>

    </div>
  )
}
