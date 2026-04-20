'use client'

import { useEffect } from 'react'
import type { Market, FilteredBook, RawBook } from '@/lib/types'

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
  topBooks: { asin: string; title: string; bsr: number; price: number; currency: string; reviewCount: number; rating: number; selfPublished: boolean; imageUrl?: string }[]
  redditMeta?: { available: boolean; insufficientCorpus: boolean; threadCount: number; subredditsUsed: string[] }
  complianceCategory: string
  complianceRisk: 'alto' | 'medio' | 'basso'
  amazon?: {
    topBooks: FilteredBook[]
    rawTop15: RawBook[]
  }
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
const AMAZON_DOMAIN: Record<string, string> = {
  US: 'amazon.com', UK: 'amazon.co.uk', DE: 'amazon.de',
  FR: 'amazon.fr',  IT: 'amazon.it',   ES: 'amazon.es',
}
function amazonProductUrl(asin: string, market: string) {
  return `https://www.${AMAZON_DOMAIN[market] ?? 'amazon.com'}/dp/${asin}`
}
function coverUrl(asin: string, imageUrl?: string) {
  return imageUrl || `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SX85_.jpg`
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

// Parsa la strategia lancio in punti numerati (es. "1) ...", "1. ...")
function parseStrategiaLancio(text: string): string[] {
  return text
    .split(/(?=\d+[).]\s+[A-Z])/)
    .map(p => p.replace(/^\d+[).]\s+/, '').trim())
    .filter(Boolean)
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ num, title, children, breakBefore = true }: {
  num: string; title: string; children: React.ReactNode; breakBefore?: boolean
}) {
  return (
    <section className={`report-section bg-white rounded-2xl border border-zinc-200 shadow-sm print:bg-transparent print:border-0 print:shadow-none print:rounded-none print:overflow-visible overflow-hidden${breakBefore ? ' print-break-before' : ''}`}>
      <div className="px-7 py-4 border-b border-zinc-100 bg-gradient-to-r from-zinc-50 to-white print:bg-none print:from-transparent print:to-transparent print:border-0 print:px-0 print:py-0 print:pb-3 flex items-baseline gap-3">
        <span className="text-xs font-bold tracking-widest text-zinc-400 shrink-0">§{num}</span>
        <h2 className="text-base font-bold text-zinc-800">{title}</h2>
      </div>
      <div className="px-7 py-5 print:px-0 print:py-0 print:space-y-3">
        {children}
      </div>
    </section>
  )
}

// ─── SubCard ──────────────────────────────────────────────────────────────────

type AccentKey = 'zinc' | 'indigo' | 'sky' | 'emerald' | 'rose' | 'amber' | 'violet'

const ACCENT_CLASSES: Record<AccentKey, { header: string; label: string }> = {
  zinc:    { header: 'bg-zinc-50 border-zinc-200',       label: 'text-zinc-500' },
  indigo:  { header: 'bg-indigo-50 border-indigo-100',   label: 'text-indigo-600' },
  sky:     { header: 'bg-sky-50 border-sky-100',         label: 'text-sky-600' },
  emerald: { header: 'bg-emerald-50 border-emerald-100', label: 'text-emerald-700' },
  rose:    { header: 'bg-rose-50 border-rose-100',       label: 'text-rose-600' },
  amber:   { header: 'bg-amber-50 border-amber-100',     label: 'text-amber-700' },
  violet:  { header: 'bg-violet-50 border-violet-100',   label: 'text-violet-600' },
}

function SubCard({ title, accent = 'zinc', children }: {
  title: string; accent?: AccentKey; children: React.ReactNode
}) {
  const cls = ACCENT_CLASSES[accent]
  return (
    <div className="rounded-xl border border-zinc-200 overflow-hidden print:break-inside-avoid print:bg-white print:shadow-[0_1px_6px_rgba(0,0,0,0.08)]">
      <div className={`px-4 py-2.5 border-b ${cls.header}`}>
        <p className={`text-xs font-bold uppercase tracking-widest ${cls.label}`}>{title}</p>
      </div>
      <div className="px-4 py-4">{children}</div>
    </div>
  )
}

// ─── SectionNote ──────────────────────────────────────────────────────────────

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <details className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50 print:bg-white print:shadow-[0_1px_6px_rgba(0,0,0,0.08)] overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer select-none text-xs font-semibold text-zinc-500 hover:bg-zinc-100 transition-colors flex items-center gap-2 list-none">
        <span className="text-zinc-400">▸</span>
        Come leggere questa sezione
      </summary>
      <div className="px-5 py-4 border-t border-zinc-200">
        <p className="hidden print:block text-[8pt] font-bold uppercase tracking-widest text-zinc-400 mb-2">Come leggere questa sezione</p>
        <p className="text-sm print:text-[8pt] text-zinc-600 leading-relaxed">{children}</p>
      </div>
    </details>
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

// ─── ExcludedBooks ────────────────────────────────────────────────────────────

function excludeReason(b: RawBook): string {
  if (b.sponsored) return 'Sponsorizzato'
  if (!b.format && !b.publisher && !b.publishedDate) return 'Non è un libro'
  return 'Non nei top 5 per BSR'
}

function ExcludedBooks({ rawTop15, topBooks }: { rawTop15: RawBook[]; topBooks: { asin: string }[] }) {
  const topAsins = new Set(topBooks.map(b => b.asin))
  const excluded = rawTop15.filter(b => !topAsins.has(b.asin))
  if (!excluded.length) return null
  return (
    <details className="no-print rounded-xl border border-zinc-200 overflow-hidden">
      <summary className="px-4 py-3 cursor-pointer select-none text-xs font-semibold text-zinc-500 hover:bg-zinc-100 transition-colors flex items-center gap-2 list-none">
        <span className="text-zinc-400">▸</span>
        {excluded.length} prodotti esclusi dall&apos;analisi
      </summary>
      <div className="px-4 py-3 border-t border-zinc-100 space-y-1.5">
        {excluded.map(b => (
          <div key={b.asin} className="flex items-center gap-3 text-xs">
            <span className="font-mono text-zinc-400 shrink-0">{b.asin}</span>
            <span className="flex-1 min-w-0 truncate text-zinc-600">{b.title}</span>
            <span className="shrink-0 px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-medium">{excludeReason(b)}</span>
          </div>
        ))}
      </div>
    </details>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReportView({ report }: { report: FullReport }) {
  const { scoringBreakdown: sb, roi } = report

  useEffect(() => {
    const openAll = () => {
      document.querySelectorAll('.report-root details').forEach(el => el.setAttribute('open', ''))
    }
    const closeAll = () => {
      document.querySelectorAll('.report-root details').forEach(el => el.removeAttribute('open'))
    }
    window.addEventListener('beforeprint', openAll)
    window.addEventListener('afterprint', closeAll)
    return () => {
      window.removeEventListener('beforeprint', openAll)
      window.removeEventListener('afterprint', closeAll)
    }
  }, [])
  const date = new Date(report.createdAt).toLocaleDateString('it-IT', {
    day: '2-digit', month: 'long', year: 'numeric'
  })

  const strategiaSteps = parseStrategiaLancio(report.seriesStrategy.strategia_lancio)

  const footerText = `BookInsight · ${report.keyword} · ${report.market} · ${date} · Score ${report.profitabilityScore}/100`

  return (
    <div className="space-y-4 report-root">

      {/* ── FOOTER DI PAGINA (solo stampa) ──────────────────────────────── */}
      <div className="hidden print:block fixed bottom-0 left-0 right-0 border-t border-zinc-200 bg-white px-8 py-1.5">
        <p className="text-[8pt] text-zinc-400 text-center">{footerText}</p>
      </div>

      {/* ── COPERTINA (solo stampa) ──────────────────────────────────────── */}
      <div className="print-cover hidden print:flex flex-col justify-between min-h-screen print:min-h-0 print:h-screen print:overflow-hidden px-16 py-20 print:px-12 print:py-6 bg-white">
        {/* Logo */}
        <div>
          <p className="text-xs font-bold tracking-[0.3em] text-zinc-400 uppercase mb-1">BookInsight</p>
          <p className="text-xs text-zinc-300">Analisi Nicchie Amazon KDP</p>
        </div>

        {/* Titolo */}
        <div className="flex-1 flex flex-col justify-center">
          <p className="text-xs font-semibold tracking-widest text-indigo-500 uppercase mb-4">Report di analisi</p>
          <h1 className="text-5xl print:text-3xl font-black text-zinc-900 leading-tight mb-3 print:uppercase">{report.keyword}</h1>
          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-zinc-600 bg-zinc-100 rounded-full px-4 py-1.5">
              Mercato {report.market}
            </span>
            <span className="text-sm text-zinc-400">{date}</span>
            {report.cpc && (
              <span className="text-sm text-zinc-400">CPC Amazon Ads: ${report.cpc.toFixed(2)}</span>
            )}
          </div>
          {/* Punteggio compatto — solo stampa, dentro il blocco titolo */}
          <div className="hidden print:flex items-baseline gap-2 mt-5">
            <span className={`text-6xl font-black leading-none ${scoreColor(report.profitabilityScore)}`}>
              {report.profitabilityScore}
            </span>
            <div className="flex flex-col">
              <span className="text-xl text-zinc-300 font-light">/100</span>
              <span className="text-xs text-zinc-400 mt-1">Profitability Score</span>
            </div>
          </div>
        </div>

        {/* Score in basso — nascosto in stampa (già nel footer) */}
        <div className="flex items-end justify-between print:hidden">
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

      {/* ── §1 Key Insights ─────────────────────────────────────────────── */}
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
        <SectionNote>
          Inizia sempre da qui. Queste 6 card ti danno una fotografia immediata della nicchia, prima ancora di guardare numeri o tabelle. Ogni card è classificata per tipo e colorata di conseguenza: le card verdi segnalano opportunità concrete da sfruttare, quelle rosse sono campanelli d&apos;allarme che meritano attenzione prima di procedere, quelle viola riguardano l&apos;andamento del mercato nel tempo, quelle blu descrivono la struttura competitiva della nicchia, quelle arancioni analizzano i libri e gli autori dominanti, quelle indaco ti danno un&apos;indicazione operativa su cosa fare concretamente. Se in questa sezione prevalgono segnali negativi, è il momento di fermarsi e valutare se vale davvero la pena approfondire l&apos;analisi. Se prevalgono segnali positivi, hai già una buona ragione per continuare con le sezioni successive.
        </SectionNote>
      </Section>

      {/* ── §2 Profitability Score ───────────────────────────────────────── */}
      <Section num="2" title="Profitability Score">
        <div className="space-y-4">
          <SubCard title="Score" accent="zinc">
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
          </SubCard>

          {report.subNiches.length > 0 && (
            <SubCard title="Sub-nicchie rilevate" accent="emerald">
              <div className="flex flex-wrap gap-2">
                {report.subNiches.map((s, i) => (
                  <span key={i} className={`text-xs px-3 py-1 rounded-full border font-medium ${s.vulnerable ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-zinc-100 border-zinc-200 text-zinc-600'}`}>
                    {s.keyword} · BSR {s.bsr.toLocaleString('it-IT')}
                    {s.vulnerable && <span className="ml-1 opacity-70">✓</span>}
                  </span>
                ))}
              </div>
            </SubCard>
          )}
        </div>
        <SectionNote>
          Il punteggio da 0 a 100 misura quanto sia conveniente, in questo momento, pubblicare un libro in questa nicchia. Non è un valore assoluto, ma un indicatore comparativo che tiene conto di cinque aspetti fondamentali del mercato. Punteggio verde (70 o più): la nicchia è sana, la domanda c&apos;è, i margini sono accettabili e la concorrenza è gestibile — un buon punto di partenza. Punteggio giallo (40–69): l&apos;opportunità esiste ma richiede una proposta editoriale molto differenziata per emergere; non è da escludere, ma va affrontata con più cura nel posizionamento. Punteggio rosso (sotto 40): la nicchia presenta troppe criticità per giustificare un investimento in questa forma; meglio cercare una variante della keyword o un mercato diverso. Le cinque barre ti mostrano da dove viene il punteggio: la Domanda misura quanto le persone cercano e comprano in questa nicchia; la Royalty indica quanto guadagni mediamente per ogni copia venduta; la Competizione riflette quanto è difficile entrare nel mercato; il Trend dice se la domanda sta crescendo o calando; la Compliance segnala se la tematica comporta rischi legali o etici (es. salute, finanza, contenuti sensibili). Le sub-nicchie in verde sono aree più specifiche con meno concorrenza: spesso rappresentano il punto di ingresso ideale per chi parte da zero.
        </SectionNote>
      </Section>

      {/* ── §3 Top Competitor & Posizionamento ──────────────────────────── */}
      <Section num="3" title="Top Competitor & Posizionamento">
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <SubCard title="Competitor target" accent="indigo">
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
            </SubCard>

            <SubCard title="Posizionamento" accent="sky">
              <div className="space-y-2">
                {[
                  { label: 'Angolo', value: report.passo0.angolo },
                  { label: 'Target Reader', value: report.passo0.target_reader },
                  { label: 'USP', value: report.passo0.usp },
                ].map(({ label, value }) => (
                  <div key={label} className="print:break-inside-avoid">
                    <p className="text-xs font-bold text-zinc-400 tracking-widest uppercase mb-0.5">{label}</p>
                    <p className="text-sm text-zinc-800 leading-snug">{value}</p>
                  </div>
                ))}
                {report.passo0.punti_forza.length > 0 && (
                  <div className="pt-2 print:break-inside-avoid">
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
            </SubCard>
          </div>

          {(report.amazon?.topBooks ?? report.topBooks)?.length > 0 && (
            <SubCard title="Top 5 competitor analizzati" accent="zinc">
              <div className="space-y-2">
                {(report.amazon?.topBooks ?? report.topBooks).slice(0, 5).map((b, i) => {
                  const isTarget = b.asin === report.competitorTarget.asin
                  const full = report.amazon?.topBooks ? b as FilteredBook : null
                  return (
                    <div key={b.asin} className="rounded-xl border border-zinc-200 p-3 flex gap-3 print:break-inside-avoid hover:bg-zinc-50 transition-colors">
                      <div className="shrink-0 pt-0.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={coverUrl(b.asin, b.imageUrl)}
                          alt=""
                          width={32}
                          height={46}
                          className="rounded object-cover bg-zinc-100 border border-zinc-200"
                          style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}
                          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden' }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                          <span className="text-[10px] font-bold text-zinc-300">#{i + 1}</span>
                          {isTarget && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200 font-semibold">Target</span>}
                          {b.selfPublished && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold">Self Publisher</span>}
                        </div>
                        <p className="text-sm font-semibold text-zinc-800 leading-snug line-clamp-2 mb-1.5">{b.title}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-500 mb-2">
                          <span>BSR <strong className="text-zinc-700">{b.bsr.toLocaleString('it-IT')}</strong></span>
                          <span>{b.currency}<strong className="text-zinc-700">{b.price.toFixed(2)}</strong></span>
                          <span>★ <strong className="text-zinc-700">{b.rating.toFixed(1)}</strong></span>
                          <span><strong className="text-zinc-700">{b.reviewCount.toLocaleString('it-IT')}</strong> rec.</span>
                          {full && <span className="text-emerald-600 font-medium">~{full.estimatedDailySalesMin}–{full.estimatedDailySalesMax} cop/g</span>}
                          {full && <span className="text-indigo-600 font-medium">${full.royalty.toFixed(2)}/copia</span>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <a href={amazonProductUrl(b.asin, report.market)} target="_blank" rel="noreferrer" className="text-[10px] px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors font-medium whitespace-nowrap">
                            Amazon →
                          </a>
                          <a href={`https://www.helium10.com/tools/xray/?asin=${b.asin}`} target="_blank" rel="noreferrer" className="text-[10px] px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors font-medium whitespace-nowrap">
                            Helium10 →
                          </a>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </SubCard>
          )}

          {report.amazon?.rawTop15 && (
            <ExcludedBooks rawTop15={report.amazon.rawTop15} topBooks={report.amazon.topBooks} />
          )}
        </div>
        <SectionNote>
          Questa sezione risponde alla domanda: chi stai per sfidare, e dove ha lasciato spazio? Tra i primi cinque libri più venduti nella nicchia, l&apos;analisi individua quello più vulnerabile — non necessariamente il più famoso, ma quello con un buon volume di vendite (BSR basso) e ancora poche recensioni, il che significa che non ha ancora consolidato la sua reputazione presso i lettori. Per entrare in una nicchia non è necessario fare il libro più completo o più lungo: basta farne uno meglio focalizzato su un problema specifico, rivolto a un sotto-segmento di lettori preciso, o con una promessa editoriale più chiara. L&apos;Angolo è la promessa principale del libro rivale — cosa promette al lettore in copertina. Il Target Reader è il pubblico a cui si rivolge. L&apos;USP è il vantaggio che lo distingue dagli altri nella stessa nicchia. Leggendo questi tre elementi capisci esattamente dove c&apos;è spazio per un posizionamento alternativo. I Punti di forza ti dicono cosa dovrai almeno eguagliare per essere preso sul serio. La tabella dei Top 5 ti mostra il panorama completo della concorrenza: clicca sul codice ASIN per aprire la pagina Amazon e leggere direttamente le recensioni dei lettori — soprattutto quelle a 1 e 2 stelle, che sono la fonte più ricca di informazioni su cosa manca ai libri esistenti.
        </SectionNote>
      </Section>

      {/* ── §4 Trend Analysis ────────────────────────────────────────────── */}
      <Section num="4" title="Trend Analysis">
        {!report.trends.available ? (
          <div className="flex items-center gap-3 text-sm text-zinc-400 italic py-2">
            <span className="text-2xl">—</span>
            <span>Dati Google Trends non disponibili per questa keyword.</span>
          </div>
        ) : (
          <div className="space-y-4">
            <SubCard title="Andamento" accent="violet">
              <div className="space-y-3">
                <div className="flex items-center gap-4 flex-wrap">
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
              </div>
            </SubCard>

            {report.trends.relatedQueries.length > 0 && (
              <SubCard title="Query correlate" accent="violet">
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
              </SubCard>
            )}
          </div>
        )}
        <SectionNote>
          Prima di investire mesi di lavoro in un libro, è fondamentale sapere se la domanda in quella nicchia sta crescendo o calando. Il dato YoY (anno su anno) confronta l&apos;interesse degli ultimi 12 mesi con quello dei 12 mesi precedenti: un valore positivo indica un mercato in espansione, uno negativo un mercato in contrazione. Una nicchia in crescita è più attrattiva perché significa che nuovi lettori si avvicinano ogni mese all&apos;argomento. Una nicchia stabile è comunque valida se ha una domanda solida. Una nicchia in calo non è automaticamente da evitare — potrebbe avere ancora un pubblico fedele — ma richiede una proposta molto più mirata. La stagionalità è un&apos;informazione pratica importante: se la tua nicchia ha picchi di interesse ricorrenti in certi periodi dell&apos;anno (es. diete e fitness a gennaio, viaggi in primavera, regali a dicembre), pianifica il lancio almeno 6–8 settimane prima del picco, così da accumulare le prime recensioni prima che la domanda salga al massimo. Le query correlate sono ricerche adiacenti in crescita: se alcune di queste descrivono meglio il tuo angolo editoriale rispetto alla keyword principale, potresti includerle nel titolo, nel sottotitolo o nelle parole chiave di pubblicazione KDP per catturare traffico aggiuntivo.
        </SectionNote>
      </Section>

      {/* ── §5 Gap Analysis & Pain Points ────────────────────────────────── */}
      <Section num="5" title="Gap Analysis & Pain Points">
        <div className="space-y-4">

          <SubCard title="Pain Points" accent="rose">
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
              <div className="rounded-xl border border-amber-100 bg-amber-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-700">
                  {!report.redditMeta?.available
                    ? 'Nessun post Reddit trovato per questa keyword nel periodo analizzato.'
                    : report.redditMeta?.insufficientCorpus
                    ? `Dati Reddit insufficienti — trovati ${report.redditMeta.threadCount} thread ma troppo pochi commenti qualificati.`
                    : 'Pain points non estratti dal corpus Reddit.'}
                </p>
                <p className="text-xs text-amber-600">
                  {!report.redditMeta?.available
                    ? 'Possibile causa: la nicchia è discussa principalmente su forum specializzati, non su Reddit, oppure i post rilevanti risalgono a oltre 12 mesi fa.'
                    : 'I pain points nella Gap Analysis sottostante sono inferiti dalle recensioni Amazon.'}
                </p>
              </div>
            )}
          </SubCard>

          <SubCard title="Problemi non risolti dai competitor" accent="zinc">
            <ul className="space-y-1.5">
              {report.gapAnalysis.passo1_problemi_non_risolti.items.map((item, i) => (
                <li key={i} className="text-sm text-zinc-700 flex gap-2 leading-relaxed">
                  <span className="text-rose-400 shrink-0 mt-0.5">→</span>{item}
                </li>
              ))}
            </ul>
          </SubCard>

          <SubCard title="Angoli non coperti" accent="indigo">
            <ul className="space-y-1.5">
              {report.gapAnalysis.passo2_angoli_mancanti.items.map((item, i) => (
                <li key={i} className="text-sm text-zinc-700 flex gap-2 leading-relaxed">
                  <span className="text-indigo-400 shrink-0 mt-0.5">→</span>{item}
                </li>
              ))}
            </ul>
          </SubCard>

          <SubCard title="Libro proposto" accent="sky">
            <p className="font-black text-xl leading-snug text-zinc-900">{report.gapAnalysis.passo5_tesi_libro.titolo_proposto}</p>
            <p className="text-sm text-zinc-600 mt-1.5 leading-relaxed">{report.gapAnalysis.passo5_tesi_libro.sottotitolo}</p>
            <p className="text-sm mt-3 italic text-zinc-500 border-l-2 border-sky-300 pl-3">{report.gapAnalysis.passo5_tesi_libro.hook}</p>
            {report.gapAnalysis.passo5_tesi_libro.differenziatori.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {report.gapAnalysis.passo5_tesi_libro.differenziatori.map((d, i) => (
                  <li key={i} className="text-xs text-zinc-600 flex gap-2 leading-relaxed">
                    <span className="shrink-0 text-sky-400 font-bold">·</span>{d}
                  </li>
                ))}
              </ul>
            )}
          </SubCard>

          <SubCard title="Gap Inventory" accent="amber">
            <div className="space-y-2">
              {report.gapAnalysis.gap_inventory_table.slice(0, 5).map((g, i) => (
                <div key={i} className="flex items-start gap-2.5 print:break-inside-avoid">
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
          </SubCard>

        </div>
        <SectionNote>
          Questa è la sezione più importante del report: ti dice cosa scrivere e perché i lettori sceglieranno il tuo libro al posto degli altri. I Pain Points sono problemi reali espressi dai lettori in prima persona, estratti da due fonti distinte: le discussioni Reddit (cosa chiedono i lettori prima di acquistare) e le recensioni Amazon dei top competitor (cosa criticano dopo aver letto). Ogni pain point ha un punteggio che riflette tre dimensioni: Frequenza (quanto spesso viene citato), Intensità (quanto è frustrante) e Solvability (quanto è risolvibile con un libro). I problemi con il simbolo ⚠ sono segnali critici ad alta intensità: non affrontarli sarebbe un&apos;opportunità sprecata. I Problemi non risolti dai competitor sono le lacune concrete dei libri esistenti, ricavate dall&apos;analisi del testo reale delle recensioni negative. Gli Angoli non coperti sono approcci editoriali completamente inesplorati: un formato diverso, un tono più pratico, un sotto-segmento ignorato. Il Libro proposto è la sintesi operativa: titolo, sottotitolo, hook e differenziatori redatti dall&apos;AI come punto di partenza concreto. La Gap Inventory classifica ogni opportunità per priorità — Alta, Media, Bassa: parti sempre dalle priorità Alta quando costruisci la scaletta del libro.
        </SectionNote>
      </Section>

      {/* ── §6 Series Strategy ───────────────────────────────────────────── */}
      <Section num="6" title="Series Strategy">
        <div className="space-y-4">

          <SubCard title="Verdetto" accent="zinc">
            <div className="flex items-start gap-4">
              <span className={`text-lg font-black px-5 py-2 rounded-xl shrink-0 ${verdettoCls(report.seriesStrategy.verdetto)}`}>
                {report.seriesStrategy.verdetto}
              </span>
              <p className="text-sm text-zinc-600 leading-relaxed pt-0.5">{report.seriesStrategy.motivazione_verdetto}</p>
            </div>
          </SubCard>

          <SubCard title="Libreria a tre volumi" accent="zinc">
            <div className="grid sm:grid-cols-3 gap-3">
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
          </SubCard>

          <SubCard title="Strategia lancio" accent="indigo">
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
          </SubCard>

        </div>
        <SectionNote>
          Pubblicare un solo libro va bene per iniziare, ma costruire un catalogo di titoli correlati è quello che trasforma un progetto occasionale in un&apos;attività editoriale sostenibile nel tempo. Questa sezione ti propone una strategia a tre volumi pensata per massimizzare il valore del tuo lavoro. Il Vol.1 è il libro da scrivere adesso: ha il posizionamento più chiaro, si basa direttamente sull&apos;analisi dei competitor e dei gap, e ha il rischio più basso perché risponde a una domanda già dimostrata. Il Vol.2 è un prodotto complementare da pianificare dopo il lancio del primo: di solito si rivolge agli stessi lettori con qualcosa di diverso — un workbook, un planner, una guida pratica — e ha il vantaggio di non dover conquistare un nuovo pubblico da zero. Il Vol.3 è uno spin-off su una nicchia adiacente da considerare solo dopo aver validato che il tuo brand funziona: evita di bruciare risorse su un terzo titolo prima di aver capito cosa ha funzionato con il primo. Il verdetto INVEST / PARTIAL / PASS ti dice in modo sintetico se la nicchia vale il tuo investimento complessivo di tempo e denaro. INVEST significa che le proiezioni giustificano pienamente il lavoro richiesto. PARTIAL significa che l&apos;opportunità c&apos;è ma con budget ridotto o una proposta ancora più mirata. PASS significa che è meglio cercare un&apos;altra nicchia. La Strategia lancio ti guida passo dopo passo nelle prime settimane dopo la pubblicazione, dalla raccolta delle prime recensioni alla gestione delle campagne pubblicitarie.
        </SectionNote>
      </Section>

      {/* ── §7 Investment & ROI ──────────────────────────────────────────── */}
      <Section num="7" title="Investment & ROI">
        <div className="space-y-4">

          <SubCard title="Proiezioni" accent="zinc">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="Vendite/giorno"  value={`${roi.avgDailySalesMin}–${roi.avgDailySalesMax}`} />
              <KpiCard label="Ricavo mensile"  value={`$${fmt(roi.avgMonthlyRevenueMin, 0)}–$${fmt(roi.avgMonthlyRevenueMax, 0)}`} />
              <KpiCard label="Break-even"      value={`${roi.breakEvenMonths} mesi`} sub={roi.bepSignal} subColor={bepColor(roi.bepSignal)} />
              <KpiCard label="ROI 12 mesi"     value={`$${fmt(roi.roiCluster12mMin, 0)}–$${fmt(roi.roiCluster12mMax, 0)}`} />
            </div>
            {(() => {
              const target = report.amazon?.topBooks.find(b => b.asin === report.competitorTarget.asin)
              if (!target) return null
              const benchRevMin = Math.round(target.estimatedDailySalesMin * target.royalty * 30)
              const benchRevMax = Math.round(target.estimatedDailySalesMax * target.royalty * 30)
              return (
                <div className="mt-3 pt-3 border-t border-zinc-100">
                  <p className="text-[10px] text-zinc-400 font-semibold uppercase tracking-widest mb-2">Benchmark — competitor target</p>
                  <div className="grid grid-cols-3 gap-3">
                    <KpiCard label="Vendite/g (target)" value={`${target.estimatedDailySalesMin}–${target.estimatedDailySalesMax}`} />
                    <KpiCard label="Ricavo/mese (target)" value={`$${fmt(benchRevMin, 0)}–$${fmt(benchRevMax, 0)}`} />
                    <KpiCard label="Royalty/copia (target)" value={`$${fmt(target.royalty)}`} />
                  </div>
                </div>
              )
            })()}
          </SubCard>

          <SubCard title="Budget" accent="zinc">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
            {report.cpc && (
              <div className="mt-3 flex items-center gap-2 text-xs text-indigo-600 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-2">
                <span className="font-semibold">CPC Amazon Ads: ${report.cpc.toFixed(2)}</span>
                <span className="text-zinc-400">·</span>
                <span>Con il budget ads di ${fmt(roi.suggestedAdsMonthly, 0)}/mese puoi acquistare circa <strong>~{Math.round(roi.suggestedAdsMonthly / report.cpc).toLocaleString('it-IT')} click/mese</strong></span>
              </div>
            )}
          </SubCard>

          <SubCard title="Narrativa" accent="zinc">
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
          </SubCard>

        </div>
        <SectionNote>
          Questa sezione traduce tutta l&apos;analisi qualitativa in numeri concreti. Le stime di vendita (copie al giorno, ricavo mensile) partono dal BSR dei competitor: un BSR basso indica un libro che vende molte copie al giorno, uno alto poche copie. Vengono mostrate fasce min-max perché le vendite reali dipendono da molte variabili — considera il valore minimo come scenario prudente e il massimo come scenario ottimistico. Il Break-even indica dopo quanti mesi recupereresti l&apos;investimento iniziale con le sole vendite organiche, senza pubblicità. Verde (entro 3 mesi) è un ottimo segnale: la nicchia ha domanda sufficiente a rientrare rapidamente. Giallo (3–6 mesi) è nella norma per molte nicchie. Rosso (oltre 6 mesi) non significa necessariamente che non valga la pena, ma che ci vorrà più tempo e forse più pubblicità per vedere i ritorni. Il budget indicato è una stima realistica dei costi di avvio: scrittura (se la esternalizzi), grafica della copertina, revisione del testo e un periodo iniziale di pubblicità. Il budget pubblicitario consigliato è il minimo per rendere visibile il libro su Amazon nei primi mesi, quando ancora non ha abbastanza recensioni per emergere organicamente. Usa queste cifre come riferimento, non come garanzia: le vendite reali dipendono dalla qualità del libro, dalla copertina, dalle recensioni che riesci a raccogliere nelle prime settimane, e dalla costanza della tua campagna pubblicitaria.
        </SectionNote>
      </Section>

    </div>
  )
}
