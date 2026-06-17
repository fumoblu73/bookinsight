'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Market, FilteredBook, RawBook, RoiEstimate, AdsIntelligence, BonusSuggestion, ConceptDirection } from '@/lib/types'
import { calcRoiEstimate } from '@/lib/scoring'

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface FullReport {
  id: string
  keyword: string
  market: Market
  createdAt: string
  cpc?: number
  profitabilityScore: number
  scoringBreakdown: {
    demandScore: number; priceScore: number; competitionScore: number
    trendScore: number; complianceScore: number
    entryDifficulty: 'FACILE' | 'MEDIO' | 'DIFFICILE'
    trendSignal: 'CRESCITA' | 'STABILE' | 'DECLINO' | 'N/A'
    avgBsr: number; avgPrice: number; minPrice: number; maxPrice: number; avgPages: number; minPages: number; maxPages: number
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
  trends: { available: boolean; yoyGrowth: number; timelineData: { date: string; value: number }[]; relatedQueries: { query: string; value: number; growthYoY: number }[]; peakMonth?: string | null; staleData?: boolean; availability?: 'full' | 'partial' | 'none' }
  trendForecast: { classificazione: string; narrativa: string; stagionalita: string | null; query_emergenti: string[] } | null
  painPoints: { pain_point: string; score: number; F: number; I: number; S: number; evidence: string; criticalSignal?: boolean; voice_phrases?: string[]; emotional_register?: string; context?: string; evidence_quotes?: string[] }[]
  gapAnalysis: {
    passo1_problemi_non_risolti: { items: string[] }
    passo2_angoli_mancanti: { items: string[] }
    passo4_target_non_servito: { segmento: string; dimensione: string }
    passo5_tesi_libro: { titolo_proposto: string; sottotitolo: string; hook: string; differenziatori: string[] }
    gap_inventory_table: { gap: string; tipo: string; priorita: 'ALTA' | 'MEDIA' | 'BASSA'; opportunita: string; nota_utente?: string | null }[]
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
  roi: RoiEstimate
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
  competitiveDynamism?: {
    signal: 'APERTO' | 'DINAMICO' | 'CONSOLIDATO' | 'N/A'
    recent: number
    mid: number
    consolidated: number
    excluded: number
    total: number
  }
  voice_data?: {
    reddit: {
      posts: Array<{ title: string; selftext: string; subreddit: string; score: number; comments: Array<{ body: string; score: number }> }>
      available: boolean
      totalComments: number
      subredditsUsed: string[]
    }
    youtube: {
      videos: Array<{ title: string; viewCount: number; comments: Array<{ text: string; likeCount: number }> }>
      available: boolean
      totalComments: number
    } | null
    reviews: Array<{ asin: string; bookTitle: string; reviews: Array<{ rating: number; title: string; body: string }> }>
  }
  ads_intelligence?: AdsIntelligence
  bonus_suggestions?: BonusSuggestion[]
  concept_directions?: ConceptDirection[]
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
// ─── Stagionalità ─────────────────────────────────────────────────────────────

const MONTHS_IT = ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic']

const MONTH_ABBR_IDX: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
}

function parseDateMonth(date: string): number {
  // "YYYY-MM" format (normal)
  if (/^\d{4}-\d{2}/.test(date)) return parseInt(date.slice(5, 7)) - 1
  // Legacy "Jan 202" (truncated by old .slice(0,7) on "Jan 2020")
  const abbr = date.toLowerCase().slice(0, 3)
  return MONTH_ABBR_IDX[abbr] ?? -1
}

function calcSeasonality(timelineData: { date: string; value: number }[]) {
  if (timelineData.length < 12) return null
  const byMonth: number[][] = Array.from({ length: 12 }, () => [])
  for (const dp of timelineData) {
    const idx = parseDateMonth(dp.date)
    if (idx >= 0 && idx < 12) byMonth[idx].push(dp.value)
  }
  if (byMonth.filter(m => m.length > 0).length < 10) return null
  const rawAvg = byMonth.map(vals =>
    vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0
  )
  const maxVal = Math.max(...rawAvg)
  if (maxVal === 0) return null
  const nonZero = rawAvg.filter(v => v > 0)
  const minVal = nonZero.length > 0 ? Math.min(...nonZero) : 0
  const monthlyAvg = rawAvg.map(v => Math.round((v / maxVal) * 100))
  const ratio = minVal > 0 ? maxVal / minVal : 1
  const peakIdx = monthlyAvg.indexOf(Math.max(...monthlyAvg))
  const launchMonths = new Set([((peakIdx - 2 + 12) % 12), ((peakIdx - 1 + 12) % 12)])
  const classification = ratio < 1.4 ? 'EVERGREEN' : ratio < 2.5 ? 'STAGIONALE' : 'TREND'
  const yearsOfData = Math.round(timelineData.length / 12)
  return { monthlyAvg, classification, peakIdx, launchMonths, ratio, yearsOfData }
}

function SeasonalityChart({ timelineData }: { timelineData: { date: string; value: number }[] }) {
  const data = calcSeasonality(timelineData)
  if (!data) return null
  const { monthlyAvg, classification, peakIdx, launchMonths, yearsOfData } = data

  const barW = 22, gap = 8, totalBarW = barW + gap
  const W = 12 * totalBarW + 8, maxBarH = 60, baseY = 78
  const offsetX = 4

  const clsBadge = classification === 'EVERGREEN'
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : classification === 'STAGIONALE'
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-rose-50 border-rose-200 text-rose-600'

  const launch0 = (peakIdx - 2 + 12) % 12
  const launch1 = (peakIdx - 1 + 12) % 12

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-bold px-3 py-1 rounded-full border ${clsBadge}`}>
          {classification}
        </span>
        <span className="text-xs text-zinc-400">
          Picco: <strong className="text-zinc-700">{MONTHS_IT[peakIdx]}</strong>
          {' · '}Finestra lancio consigliata: <strong className="text-emerald-700">{MONTHS_IT[launch0]} – {MONTHS_IT[launch1]}</strong>
          {' · '}<span className="text-zinc-300">{yearsOfData} anni di dati</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} 100`} className="w-full" style={{ maxHeight: 110 }}>
        {monthlyAvg.map((val, i) => {
          const x = offsetX + i * totalBarW
          const barH = Math.max(3, (val / 100) * maxBarH)
          const y = baseY - barH
          const isPeak = i === peakIdx
          const isLaunch = launchMonths.has(i)
          const fill = isPeak ? '#f97316' : isLaunch ? '#86efac' : val >= 70 ? '#fbbf24' : val >= 40 ? '#93c5fd' : '#e5e7eb'
          const labelFill = isPeak ? '#ea580c' : isLaunch ? '#16a34a' : '#9ca3af'
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} rx={3} fill={fill} />
              {isPeak && <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fill="#ea580c" fontWeight="bold">▲</text>}
              <text x={x + barW / 2} y={baseY + 11} textAnchor="middle" fontSize={8} fill={labelFill} fontWeight={isPeak || isLaunch ? 'bold' : 'normal'}>
                {MONTHS_IT[i].slice(0, 3)}
              </text>
            </g>
          )
        })}
        <g transform={`translate(${offsetX},92)`}>
          <rect width={8} height={6} rx={1} fill="#f97316"/><text x={11} y={6} fontSize={7} fill="#9ca3af">Picco vendite</text>
          <rect x={72} width={8} height={6} rx={1} fill="#86efac"/><text x={83} y={6} fontSize={7} fill="#9ca3af">Finestra lancio</text>
          <rect x={155} width={8} height={6} rx={1} fill="#fbbf24"/><text x={166} y={6} fontSize={7} fill="#9ca3af">Alta domanda</text>
        </g>
      </svg>
    </div>
  )
}

// ─── Prospetto multi-mercato ──────────────────────────────────────────────────

interface MarketTrendSummary {
  market: string
  signal: 'CRESCITA' | 'STABILE' | 'DECLINO' | 'N/A'
  yoyGrowth: number
  classification: 'EVERGREEN' | 'STAGIONALE' | 'TREND' | 'N/A'
  peakMonth: string | null
}

function MultiMarketPanel({ keyword, primaryMarket }: { keyword: string; primaryMarket: string }) {
  const [data, setData] = useState<MarketTrendSummary[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [attempted, setAttempted] = useState(false)

  function load() {
    setLoading(true)
    fetch('/api/trends-multimarket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keyword, market: primaryMarket }),
    })
      .then(r => r.ok ? r.json() as Promise<MarketTrendSummary[]> : Promise.reject())
      .then(json => setData(json))
      .catch(() => {})
      .finally(() => { setAttempted(true); setLoading(false) })
  }

  if (!attempted) {
    return (
      <button
        onClick={load}
        disabled={loading}
        className="text-xs text-violet-600 hover:text-violet-800 underline underline-offset-2 transition-colors disabled:opacity-50"
      >
        {loading ? 'Caricamento…' : 'Carica prospetto (+10 crediti SerpAPI)'}
      </button>
    )
  }

  if (!data || data.length === 0) {
    return <p className="text-xs text-zinc-400 italic">Dati non disponibili.</p>
  }

  return (
    <div className="space-y-2.5">
      {data.map(row => (
        <div key={row.market} className="flex items-center gap-3 flex-wrap text-xs">
          <span className="w-7 font-bold text-zinc-600">{row.market}</span>
          {row.signal === 'N/A' ? (
            <span className="text-zinc-300 italic">N/D</span>
          ) : (
            <>
              <span className={`w-16 font-semibold ${row.signal === 'CRESCITA' ? 'text-emerald-600' : row.signal === 'DECLINO' ? 'text-rose-500' : 'text-zinc-500'}`}>
                {row.signal}
              </span>
              <span className={`tabular-nums w-14 ${row.yoyGrowth > 0 ? 'text-emerald-600' : row.yoyGrowth < 0 ? 'text-rose-500' : 'text-zinc-400'}`}>
                {row.yoyGrowth > 0 ? '+' : ''}{row.yoyGrowth}% YoY
              </span>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${
                row.classification === 'EVERGREEN' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                row.classification === 'STAGIONALE' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                row.classification === 'TREND' ? 'bg-rose-50 border-rose-200 text-rose-600' :
                'bg-zinc-100 border-zinc-200 text-zinc-400'
              }`}>{row.classification}</span>
              {row.peakMonth && (
                <span className="text-zinc-400">Picco: <strong className="text-zinc-600">{row.peakMonth}</strong></span>
              )}
              {row.signal === 'CRESCITA' && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">Analizza</span>
              )}
            </>
          )}
        </div>
      ))}
      <p className="text-[10px] text-zinc-300 pt-1.5 border-t border-zinc-100">Google Trends · stessa keyword · ultimi 5 anni</p>
    </div>
  )
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

// ─── BonusCard ────────────────────────────────────────────────────────────────

const BONUS_TIPO_LABEL: Record<BonusSuggestion['tipo'], string> = {
  workbook: 'Workbook',
  checklist: 'Checklist',
  cheat_sheet: 'Cheat Sheet',
  template: 'Template',
  mini_corso_video: 'Mini-Corso Video',
  community: 'Community',
  quiz: 'Quiz',
  audio_companion: 'Audio Companion',
  risorse_esterne: 'Risorse Esterne',
  planner: 'Planner',
}

function BonusCard({ bonus }: { bonus: BonusSuggestion }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 print:break-inside-avoid">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-xs px-2 py-0.5 rounded bg-zinc-100 text-zinc-700 font-medium">
          {BONUS_TIPO_LABEL[bonus.tipo] ?? bonus.tipo}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">
          Efficacia {bonus.efficacia_score}/10
        </span>
        <span className="text-xs text-zinc-400">Fonte: {bonus.segnale_fonte}</span>
      </div>
      <h5 className="text-sm font-semibold text-zinc-800 mb-2">{bonus.titolo}</h5>
      <div className="space-y-1.5 text-sm text-zinc-700">
        <div>
          <span className="text-xs text-zinc-400 font-medium">Razionale: </span>
          {bonus.razionale}
        </div>
        <div>
          <span className="text-xs text-zinc-400 font-medium">Come realizzarlo: </span>
          {bonus.come_realizzarlo}
        </div>
        <div>
          <span className="text-xs text-zinc-400 font-medium">Come presentarlo: </span>
          {bonus.come_presentarlo}
        </div>
        {bonus.evidence_quote && (
          <div className="text-xs italic text-zinc-500 border-l-2 border-zinc-200 pl-2 mt-2">
            &ldquo;{bonus.evidence_quote}&rdquo;
          </div>
        )}
      </div>
      <div className="mt-2 text-xs text-zinc-400">
        Pain point collegati: {bonus.pain_points_origine.length}
      </div>
    </div>
  )
}

// ─── ConceptCard ──────────────────────────────────────────────────────────────

function ConceptCard({ concept, index }: { concept: ConceptDirection; index: number }) {
  const difficoltaCls = concept.difficolta_esecuzione === 'BASSA'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : concept.difficolta_esecuzione === 'ALTA'
    ? 'bg-rose-50 text-rose-700 border-rose-200'
    : 'bg-amber-50 text-amber-700 border-amber-200'

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3 print:break-inside-avoid">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-xs text-zinc-400 font-mono">Concept {index}</span>
        <span className={`text-xs px-2 py-0.5 rounded border font-medium ${difficoltaCls}`}>
          Difficoltà {concept.difficolta_esecuzione}
        </span>
        <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
          Evidenza {concept.evidenza_score}/10
        </span>
      </div>

      <h5 className="text-sm font-semibold text-zinc-900 leading-snug">
        {concept.titolo_concetto}
      </h5>

      <div className="text-xs text-zinc-500 italic">
        {concept.sotto_segmento}
      </div>

      <div className="space-y-2 text-sm text-zinc-700">
        <div>
          <span className="text-xs text-zinc-400 font-medium">Angolo: </span>
          {concept.angolo}
        </div>
        <div>
          <span className="text-xs text-zinc-400 font-medium">Perché potrebbe funzionare: </span>
          {concept.why_could_work}
        </div>
        <div>
          <span className="text-xs text-rose-500 font-medium">Rischio principale: </span>
          {concept.main_risk}
        </div>
      </div>

      {concept.differenziatori_chiave.length > 0 && (
        <div>
          <div className="text-xs text-zinc-400 font-medium mb-1">Differenziatori chiave:</div>
          <ul className="text-xs text-zinc-600 space-y-1 list-disc list-inside">
            {concept.differenziatori_chiave.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="text-xs text-zinc-400 mt-auto pt-2 border-t border-zinc-100">
        Pain risolti: {concept.pain_points_origine.length} · {concept.evidenza_motivo}
      </div>
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

  const [roiLocalParams, setRoiLocalParams] = useState({
    costoScrittura:     roi.params.costoScrittura,
    costoCopertina:     roi.params.costoCopertina,
    costoPerRecensione: roi.params.costoPerRecensione,
    arcReviews:         roi.params.arcReviews,
    conversionRate:     roi.params.conversionRate,
    cpc:                roi.params.cpc,
  })

  const narrativeIsStale =
    roiLocalParams.cpc               !== roi.params.cpc               ||
    roiLocalParams.conversionRate    !== roi.params.conversionRate    ||
    roiLocalParams.costoScrittura    !== roi.params.costoScrittura    ||
    roiLocalParams.costoCopertina    !== roi.params.costoCopertina    ||
    roiLocalParams.costoPerRecensione !== roi.params.costoPerRecensione ||
    roiLocalParams.arcReviews        !== roi.params.arcReviews

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const liveRoi = useMemo(() => {
    const mockTarget = {
      asin: roi.targetAsin ?? report.competitorTarget.asin,
      title: '', bsr: 0, bsrTimestamp: '', price: roi.params.plannedPrice, currency: '',
      reviewCount: 0, rating: 0, selfPublished: false, sponsored: false,
      royalty: 0, pagesEstimated: false,
      estimatedDailySalesMin: roi.targetDailySalesMin,
      estimatedDailySalesMax: roi.targetDailySalesMax,
      pages: roi.params.plannedPages,
    } as FilteredBook
    return calcRoiEstimate(mockTarget, report.market, {
      ...roiLocalParams,
      plannedPrice: roi.params.plannedPrice,
      plannedPages: roi.params.plannedPages,
      monthsToParity: roi.rampMonths,
      profitabilityScore: report.profitabilityScore,
      entryDifficulty: report.scoringBreakdown.entryDifficulty,
    })
  }, [roiLocalParams]) // eslint-disable-line react-hooks/exhaustive-deps

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
                <ScoreBar label="Prezzo (25%)" value={sb.priceScore} />
                <ScoreBar label="Competizione (20%)" value={sb.competitionScore} />
                <ScoreBar label="Trend (15%)" value={sb.trendScore} />
                <ScoreBar label="Compliance (10%)" value={sb.complianceScore} />
              </div>
            </div>
            <div className="flex flex-wrap gap-5 mt-5 pt-4 border-t border-zinc-100 text-sm">
              <span className="text-zinc-500">BSR medio: <strong className="text-zinc-800">{sb.avgBsr.toLocaleString('it-IT')}</strong></span>
              <span className="text-zinc-500">Prezzo medio: <strong className="text-zinc-800">{fmt(sb.avgPrice)} ({fmt(sb.minPrice)}–{fmt(sb.maxPrice)})</strong></span>
              <span className="text-zinc-500">Pagine medie: <strong className="text-zinc-800">{sb.avgPages} ({sb.minPages}–{sb.maxPages})</strong></span>
              <span className="text-zinc-500">📏 Lunghezza target: <strong className="text-indigo-700">~{Math.round(sb.avgPages / 10) * 10} pag.</strong></span>
              <span className="text-zinc-500">Difficoltà: <strong className={difficultyColor(sb.entryDifficulty)}>{sb.entryDifficulty}</strong></span>
              <span className="text-zinc-500">Trend: <strong className={trendColor(sb.trendSignal)}>{sb.trendSignal}</strong></span>
              <span className="text-zinc-500">Compliance: <strong className="text-zinc-800">{report.complianceCategory}</strong> <span className="text-zinc-400">({report.complianceRisk})</span></span>
            </div>
          </SubCard>

          {report.subNiches.length > 0 && (
            <SubCard title="Sub-nicchie rilevate" accent="emerald">
              <div className="space-y-2">
                {report.subNiches.map((s, i) => (
                  <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${s.vulnerable ? 'border-emerald-200 bg-emerald-50' : 'border-zinc-200'}`}>
                    <div className="flex-1 min-w-0">
                      <a
                        href={`https://www.${AMAZON_DOMAIN[report.market]}/s?k=${encodeURIComponent(s.keyword)}&i=stripbooks`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-zinc-800 hover:text-indigo-600 underline underline-offset-2 transition-colors"
                      >
                        {s.keyword}
                      </a>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-zinc-500">
                      <span>BSR <strong className="text-zinc-700">{s.bsr.toLocaleString('it-IT')}</strong></span>
                      <span><strong className="text-zinc-700">{s.reviewCount.toLocaleString('it-IT')}</strong> rec.</span>
                      {s.vulnerable && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-700">
                          Opportunità
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-400 mt-3 leading-relaxed">
                Trovate nella top 15 Amazon. <strong className="text-emerald-700">Opportunità</strong> = leader con meno di 50 recensioni — punto di ingresso a bassa resistenza. Clicca la keyword per esplorare la SERP.
              </p>
            </SubCard>
          )}
          {report.competitiveDynamism && report.competitiveDynamism.signal !== 'N/A' && (() => {
            const d = report.competitiveDynamism!
            const signalColor =
              d.signal === 'APERTO'      ? 'text-emerald-700 bg-emerald-50 border-emerald-200' :
              d.signal === 'DINAMICO'    ? 'text-amber-700 bg-amber-50 border-amber-200' :
                                           'text-zinc-600 bg-zinc-50 border-zinc-200'
            const signalLabel =
              d.signal === 'APERTO'      ? 'Mercato aperto ai nuovi entranti' :
              d.signal === 'DINAMICO'    ? 'Mercato con dinamismo moderato' :
                                           'Mercato consolidato, inerzia alta'
            const signalDesc =
              d.signal === 'APERTO'      ? "L'algoritmo Amazon sta premiando i nuovi titoli. Finestra favorevole per l'entrata — i nuovi libri riescono a rankare organicamente in questa nicchia." :
              d.signal === 'DINAMICO'    ? "Presenza significativa di nuovi entranti. Entrata fattibile con differenziazione solida e budget ads adeguato." :
                                           "La top è dominata da titoli affermati da anni. Difficile emergere senza un angolo molto distinto o un budget ads consistente."
            const barMax = Math.max(d.recent, d.mid, d.consolidated, 1)
            const Bar = ({ val, color }: { val: number; color: string }) => (
              <div className="flex items-center gap-2">
                <div className={`h-2 rounded-full ${color}`} style={{ width: `${Math.round((val / barMax) * 120)}px`, minWidth: '4px' }} />
                <span className="text-xs text-zinc-500 tabular-nums">{val}</span>
              </div>
            )
            return (
              <SubCard title="Dinamismo competitivo" accent="zinc">
                <div className="flex items-start gap-6 flex-wrap">
                  <div className="space-y-2 min-w-40">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-zinc-400 w-28">Recenti (2–12m)</span>
                      <Bar val={d.recent} color="bg-emerald-400" />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-zinc-400 w-28">Medi (1–3 anni)</span>
                      <Bar val={d.mid} color="bg-amber-300" />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs text-zinc-400 w-28">Consolidati (3+a)</span>
                      <Bar val={d.consolidated} color="bg-zinc-300" />
                    </div>
                    {d.excluded > 0 && (
                      <p className="text-xs text-zinc-300 mt-1">{d.excluded} esclusi (honeymoon &lt;60gg)</p>
                    )}
                  </div>
                  <div className="flex-1 min-w-48">
                    <span className={`inline-block text-xs font-semibold px-2 py-1 rounded-full border mb-2 ${signalColor}`}>
                      {d.signal} — {signalLabel}
                    </span>
                    <p className="text-xs text-zinc-500 leading-relaxed">{signalDesc}</p>
                  </div>
                </div>
              </SubCard>
            )
          })()}
        </div>
        <SectionNote>
          Il punteggio da 0 a 100 misura quanto sia conveniente, in questo momento, pubblicare un libro in questa nicchia. Non è un valore assoluto, ma un indicatore comparativo che tiene conto di cinque aspetti fondamentali del mercato. Punteggio verde (70 o più): la nicchia è sana, la domanda c&apos;è, i margini sono accettabili e la concorrenza è gestibile — un buon punto di partenza. Punteggio giallo (40–69): l&apos;opportunità esiste ma richiede una proposta editoriale molto differenziata per emergere; non è da escludere, ma va affrontata con più cura nel posizionamento. Punteggio rosso (sotto 40): la nicchia presenta troppe criticità per giustificare un investimento in questa forma; meglio cercare una variante della keyword o un mercato diverso. Le cinque barre ti mostrano da dove viene il punteggio: la Domanda misura quanto le persone cercano e comprano in questa nicchia; il Prezzo riflette il livello di prezzo medio dei competitor (proxy del margine potenziale — libri più costosi lasciano più spazio per coprire i costi di stampa); la Competizione riflette quanto è difficile entrare nel mercato; il Trend dice se la domanda sta crescendo o calando; la Compliance segnala se la tematica comporta rischi legali o etici (es. salute, finanza, contenuti sensibili). Le sub-nicchie in verde sono aree più specifiche con meno concorrenza: spesso rappresentano il punto di ingresso ideale per chi parte da zero.
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

          {((report.amazon?.rawTop15 ?? report.amazon?.topBooks ?? report.topBooks)?.length ?? 0) > 0 && (
            <SubCard title="Cover competitor" accent="zinc">
              <div className="grid grid-cols-5 gap-2 sm:gap-3">
                {(report.amazon?.rawTop15 ?? report.amazon?.topBooks ?? report.topBooks).slice(0, 15).map((b, i) => {
                  const isTarget = b.asin === report.competitorTarget?.asin
                  return (
                    <a
                      key={b.asin}
                      href={amazonProductUrl(b.asin, report.market)}
                      target="_blank"
                      rel="noreferrer"
                      className="flex flex-col items-center gap-1 group"
                      title={b.title}
                    >
                      <div className={`relative rounded overflow-hidden border-2 transition-all ${isTarget ? 'border-indigo-400' : 'border-zinc-200 group-hover:border-zinc-400'}`}>
                        <span className="absolute top-1 left-1 text-[9px] font-bold text-zinc-400 bg-white/80 rounded px-0.5 leading-none">#{i + 1}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={coverUrl(b.asin, b.imageUrl)}
                          alt=""
                          width={64}
                          height={92}
                          className="object-cover bg-zinc-100 block"
                          style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}
                          onError={e => {
                            const img = e.target as HTMLImageElement
                            img.style.visibility = 'hidden'
                            img.style.minHeight = '92px'
                          }}
                        />
                        {isTarget && (
                          <span className="absolute bottom-0 inset-x-0 text-center text-[8px] font-bold bg-indigo-500 text-white py-0.5">Target</span>
                        )}
                      </div>
                      <p className="text-[9px] text-zinc-600 text-center line-clamp-2 leading-snug w-full font-medium">
                        {b.title}
                      </p>
                      <div className="text-[9px] text-zinc-400 text-center leading-tight w-full space-y-0.5">
                        <p><span className="font-semibold text-zinc-600">{b.bsr.toLocaleString('it-IT')}</span> BSR</p>
                        <p>★ {b.rating.toFixed(1)} · <span className="font-semibold text-zinc-600">{b.reviewCount >= 1000 ? `${(b.reviewCount / 1000).toFixed(1)}k` : b.reviewCount}</span> rec.</p>
                      </div>
                    </a>
                  )
                })}
              </div>
            </SubCard>
          )}

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
                          {full && full.royalty > 0 && <span className="text-emerald-700 font-medium">{b.currency}{full.royalty.toFixed(2)} royalty/cop.</span>}
                          {full && (full.pages ?? 0) > 0 && <span className="text-zinc-500">{full.pages} pag.</span>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <a href={amazonProductUrl(b.asin, report.market)} target="_blank" rel="noreferrer" className="text-[10px] px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-100 transition-colors font-medium whitespace-nowrap">
                            Amazon →
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
          Questa sezione risponde alla domanda: chi stai per sfidare, e dove ha lasciato spazio? Tra i primi cinque libri più venduti nella nicchia, l&apos;analisi individua quello più vulnerabile — non necessariamente il più famoso, ma quello con un buon volume di vendite (BSR basso) e ancora poche recensioni, il che significa che non ha ancora consolidato la sua reputazione presso i lettori. Per entrare in una nicchia non è necessario fare il libro più completo o più lungo: basta farne uno meglio focalizzato su un problema specifico, rivolto a un sotto-segmento di lettori preciso, o con una promessa editoriale più chiara. L&apos;Angolo è la promessa principale del libro rivale — cosa promette al lettore in copertina. Il Target Reader è il pubblico a cui si rivolge. L&apos;USP è il vantaggio che lo distingue dagli altri nella stessa nicchia. Leggendo questi tre elementi capisci esattamente dove c&apos;è spazio per un posizionamento alternativo. I Punti di forza ti dicono cosa dovrai almeno eguagliare per essere preso sul serio. Le card dei Top 5 mostrano il panorama completo della concorrenza con prezzo, pagine e stime di vendita: clicca su "Amazon →" per aprire la pagina del libro e leggere direttamente le recensioni dei lettori — soprattutto quelle a 1 e 2 stelle, che sono la fonte più ricca di informazioni su cosa manca ai libri esistenti. Il numero di pagine ti permette di stimare manualmente il costo di stampa KDP in base al tuo mercato e al formato scelto (B&amp;W o colore).
        </SectionNote>
      </Section>

      {/* ── §4 Trend Analysis ────────────────────────────────────────────── */}
      <Section num="4" title="Trend Analysis">
        {report.trends.staleData && (
          <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
            <span>ⓘ</span>
            <span>Dati Trends da cache recente (Google Trends temporaneamente non raggiungibile)</span>
          </div>
        )}
        {(() => {
          const hasTimeline = report.trends.timelineData.length > 0
          const hasRelated  = report.trends.relatedQueries.length > 0

          if (!hasTimeline && !hasRelated) {
            return (
              <div className="flex items-center gap-3 text-sm text-zinc-400 italic py-2">
                <span className="text-2xl">—</span>
                <span>Dati Google Trends non disponibili per questa keyword.</span>
              </div>
            )
          }

          if (!hasTimeline && hasRelated) {
            return (
              <div className="space-y-4">
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-zinc-700">
                  <span className="font-semibold text-amber-700">ⓘ Timeline non disponibile.</span>{' '}
                  I dati storici di Google Trends per questa keyword/mercato non sono accessibili in questo momento,
                  ma le <strong>query correlate</strong> sono state recuperate e mostrate sotto.
                </div>
                <SubCard title="Query correlate" accent="violet">
                  <div className="flex flex-wrap gap-2">
                    {report.trends.relatedQueries.slice(0, 8).map((q, i) => (
                      <span key={i} className="text-xs px-2.5 py-1 bg-violet-50 text-violet-700 border border-violet-200 rounded-full font-medium">
                        {q.query}{q.growthYoY > 0 && <span className="ml-1 text-violet-500">+{q.growthYoY}%</span>}
                      </span>
                    ))}
                  </div>
                </SubCard>
              </div>
            )
          }

          // Caso: timeline ok (hasTimeline=true), con o senza related
          return (
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

              {report.trends.timelineData?.length >= 12 && (
                <SubCard title="Stagionalità della nicchia" accent="violet">
                  {report.trends.peakMonth && (
                    <div className="mb-3 flex items-center gap-2 text-sm text-zinc-700">
                      <span className="text-base">📅</span>
                      <span>Timing ottimale di lancio: <strong className="text-emerald-700">{report.trends.peakMonth}</strong></span>
                      <span className="text-zinc-400 text-xs">(mese di picco storico)</span>
                    </div>
                  )}
                  <SeasonalityChart timelineData={report.trends.timelineData} />
                </SubCard>
              )}

              <SubCard title="Prospetto multi-mercato" accent="violet">
                <MultiMarketPanel keyword={report.keyword} primaryMarket={report.market} />
              </SubCard>

              {hasRelated && (
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

              {!hasRelated && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-zinc-700">
                  <span className="font-semibold text-amber-700">ⓘ Query correlate non disponibili.</span>{' '}
                  Google Trends non ha restituito query correlate per questa keyword. Il dato di andamento e
                  stagionalità sopra resta affidabile.
                </div>
              )}
            </div>
          )
        })()}
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

          {/* Lessico dei Lettori — voice-of-customer per copywriting */}
          {report.painPoints.some(pp => (pp.voice_phrases?.length ?? 0) > 0) && (
            <SubCard title="Lessico dei Lettori" accent="indigo">
              <p className="text-xs text-zinc-500 mb-3 italic">
                Frasi e modi di dire estratti dalle conversazioni reali — materiale pronto per il copywriting (sottotitoli, bullet Amazon, slogan copertina).
              </p>
              <div className="space-y-3">
                {report.painPoints
                  .filter(pp => (pp.voice_phrases?.length ?? 0) > 0)
                  .slice(0, 8)
                  .map((pp, i) => (
                    <div key={i} className="border-l-2 border-indigo-200 pl-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-xs font-semibold text-zinc-700 leading-snug">{pp.pain_point}</p>
                        {pp.emotional_register && (
                          <span className="shrink-0 text-[10px] uppercase tracking-wider text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                            {pp.emotional_register}
                          </span>
                        )}
                      </div>
                      {pp.context && (
                        <p className="text-[11px] text-zinc-400 italic mb-1.5">{pp.context}</p>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {pp.voice_phrases!.map((phrase, j) => (
                          <span key={j} className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                            &ldquo;{phrase}&rdquo;
                          </span>
                        ))}
                      </div>
                      {pp.evidence_quotes && pp.evidence_quotes.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-[11px] text-zinc-400 cursor-pointer hover:text-zinc-600">
                            Citazioni complete ({pp.evidence_quotes.length})
                          </summary>
                          <ul className="mt-1 space-y-1 ml-3">
                            {pp.evidence_quotes.map((q, j) => (
                              <li key={j} className="text-[11px] text-zinc-500 italic leading-relaxed">&ldquo;{q}&rdquo;</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  ))}
              </div>
            </SubCard>
          )}

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

          {/* Confronto osservazioni utente — solo se presenti */}
          {report.gapAnalysis.gap_inventory_table.some(g => g.nota_utente) && (
            <SubCard title="Confronto con le tue osservazioni" accent="amber">
              <div className="space-y-2">
                {report.gapAnalysis.gap_inventory_table
                  .filter(g => g.nota_utente)
                  .map((g, i) => {
                    const nota = g.nota_utente!
                    const isContrast = /contraddic|contrast/i.test(nota)
                    return (
                      <div key={i} className={`rounded-lg px-3 py-2 text-xs border ${isContrast ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                        <span className="font-semibold text-zinc-700">{g.gap}:</span>
                        {' '}
                        <span className={isContrast ? 'text-amber-800' : 'text-emerald-800'}>{nota}</span>
                      </div>
                    )
                  })}
              </div>
            </SubCard>
          )}

          {/* Angoli Alternativi — solo se concept_directions presenti */}
          {report.concept_directions && report.concept_directions.length > 0 && (
            <SubCard title="Angoli Alternativi" accent="indigo">
              <div className="mb-3 text-xs text-zinc-500">
                Tre concetti di libro alternativi sulla stessa nicchia, ognuno con un sotto-segmento e angolo distinto.
                Diversi dal &ldquo;Libro Proposto&rdquo; sopra (sintesi unica) e dalla Series Strategy sotto (3 volumi della stessa serie).
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {report.concept_directions.map((concept, i) => (
                  <ConceptCard key={concept.id} concept={concept} index={i + 1} />
                ))}
              </div>
            </SubCard>
          )}

        </div>
        <SectionNote>
          Questa è la sezione più importante del report: ti dice cosa scrivere e perché i lettori sceglieranno il tuo libro al posto degli altri. I Pain Points sono problemi reali espressi dai lettori in prima persona, estratti da tre fonti distinte: le discussioni Reddit (cosa chiedono i lettori prima di acquistare), i commenti YouTube sotto video correlati alla keyword (cosa dicono mentre cercano soluzioni) e le recensioni Amazon dei top competitor (cosa criticano dopo aver letto). Ogni pain point ha un punteggio che riflette tre dimensioni: Frequenza (quanto spesso viene citato), Intensità (quanto è frustrante) e Solvability (quanto è risolvibile con un libro). I problemi con il simbolo ⚠ sono segnali critici ad alta intensità: non affrontarli sarebbe un&apos;opportunità sprecata. I Problemi non risolti dai competitor sono le lacune concrete dei libri esistenti, ricavate dall&apos;analisi del testo reale delle recensioni negative. Gli Angoli non coperti sono approcci editoriali completamente inesplorati: un formato diverso, un tono più pratico, un sotto-segmento ignorato. Il Libro proposto è la sintesi operativa: titolo, sottotitolo, hook e differenziatori redatti dall&apos;AI come punto di partenza concreto. La Gap Inventory classifica ogni opportunità per priorità — Alta, Media, Bassa: parti sempre dalle priorità Alta quando costruisci la scaletta del libro.
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

          {report.bonus_suggestions && report.bonus_suggestions.length > 0 && (
            <div className="mt-2 pt-6 border-t border-zinc-200">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-xl">🎁</span>
                <div>
                  <h4 className="text-base font-semibold text-zinc-800">
                    Bonus suggeriti per aumentare l&apos;appeal
                  </h4>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Estensioni del libro principale che risolvono i pain point più forti emersi
                    dall&apos;analisi. Aumentano il valore percepito e differenziano dai competitor.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {report.bonus_suggestions.map(bonus => (
                  <BonusCard key={bonus.id} bonus={bonus} />
                ))}
              </div>
            </div>
          )}

        </div>
        <SectionNote>
          Pubblicare un solo libro va bene per iniziare, ma costruire un catalogo di titoli correlati è quello che trasforma un progetto occasionale in un&apos;attività editoriale sostenibile nel tempo. Questa sezione ti propone una strategia a tre volumi pensata per massimizzare il valore del tuo lavoro. Il Vol.1 è il libro da scrivere adesso: ha il posizionamento più chiaro, si basa direttamente sull&apos;analisi dei competitor e dei gap, e ha il rischio più basso perché risponde a una domanda già dimostrata. Il Vol.2 è un prodotto complementare da pianificare dopo il lancio del primo: di solito si rivolge agli stessi lettori con qualcosa di diverso — un workbook, un planner, una guida pratica — e ha il vantaggio di non dover conquistare un nuovo pubblico da zero. Il Vol.3 è uno spin-off su una nicchia adiacente da considerare solo dopo aver validato che il tuo brand funziona: evita di bruciare risorse su un terzo titolo prima di aver capito cosa ha funzionato con il primo. Il verdetto INVEST / PARTIAL / PASS ti dice in modo sintetico se la nicchia vale il tuo investimento complessivo di tempo e denaro. INVEST significa che le proiezioni giustificano pienamente il lavoro richiesto. PARTIAL significa che l&apos;opportunità c&apos;è ma con budget ridotto o una proposta ancora più mirata. PASS significa che è meglio cercare un&apos;altra nicchia. La Strategia lancio ti guida passo dopo passo nelle prime settimane dopo la pubblicazione, dalla raccolta delle prime recensioni alla gestione delle campagne pubblicitarie.
        </SectionNote>
      </Section>

      {/* ── §7 Investment & ROI ──────────────────────────────────────────── */}
      <Section num="7" title="Investment & ROI">
        <div className="space-y-4">

          {/* 1. Bersaglio ROI */}
          <div className="px-4 py-3 rounded-xl bg-zinc-50 border border-zinc-200 flex items-center gap-3 flex-wrap print:break-inside-avoid">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest shrink-0">Bersaglio ROI</span>
            <a
              href={amazonProductUrl(report.competitorTarget.asin, report.market)}
              target="_blank" rel="noreferrer"
              className="text-sm font-medium text-zinc-700 hover:text-indigo-600 underline underline-offset-2 transition-colors flex-1 min-w-0 truncate"
            >
              {report.competitorTarget.title}
            </a>
            <div className="flex gap-3 text-xs text-zinc-400 shrink-0 flex-wrap">
              <span>BSR {report.competitorTarget.bsr.toLocaleString('it-IT')}</span>
              <span>{report.competitorTarget.currency}{report.competitorTarget.price}</span>
              <span>{report.competitorTarget.reviewCount} rec.</span>
              <span>{roi.targetDailySalesMin}–{roi.targetDailySalesMax} vend/g</span>
              <span>royalty {roi.newBookRoyalty.toFixed(2)}</span>
              <span className="font-mono text-zinc-300">{report.competitorTarget.asin}</span>
            </div>
            {!roi.anchoredOnTarget && (
              <span className="text-xs text-amber-600 font-medium bg-amber-50 rounded-lg px-2 py-0.5 border border-amber-100">
                stima non ancorata al bersaglio — accuratezza ridotta
              </span>
            )}
          </div>

          {/* 2. Verdetto + 3 scenari */}
          <SubCard title="Scenari di ritorno a 12 mesi" accent="zinc">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${verdettoCls(liveRoi.investVerdict)}`}>
                {liveRoi.investVerdict}
              </span>
              <span className="text-xs text-zinc-400">scenario base · ramp {liveRoi.rampMonths} {liveRoi.rampMonths === 1 ? 'mese' : 'mesi'}</span>
              <KpiCard label="BEP" value={liveRoi.bepSignal} subColor={bepColor(liveRoi.bepSignal)} />
              {narrativeIsStale && (
                <span className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-0.5 border border-amber-100">
                  valori aggiornati — la narrativa si riferisce ai parametri iniziali
                </span>
              )}
            </div>
            {liveRoi.degradedFrom && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className="text-amber-600 text-sm leading-5 flex-shrink-0">ⓘ</span>
                  <div className="text-sm text-zinc-700 leading-relaxed space-y-2">
                    <p>
                      <span className="font-semibold text-zinc-900">Verdetto corretto da {liveRoi.degradedFrom} a {liveRoi.investVerdict}.</span>{' '}
                      Il calcolo puro dei numeri darebbe <span className="font-semibold">{liveRoi.degradedFrom}</span>
                      {typeof liveRoi.scenarios?.[1]?.ratioVsBudget === 'number' && (
                        <> (ROI {Math.round(liveRoi.scenarios[1].ratioVsBudget * 100) / 100}× sul budget)</>
                      )}
                      . Però la nicchia ha un Profitability Score basso e un&apos;entry difficulty DIFFICILE: il verdetto è stato corretto a <span className="font-semibold">{liveRoi.investVerdict}</span> per riflettere il contesto strategico complessivo.
                    </p>
                    <p>
                      <span className="font-semibold text-zinc-900">Cosa significa per te:</span>{' '}
                      i numeri sono favorevoli, ma considera tempi di rientro più lunghi e budget di backup più ampio rispetto a una nicchia con verdetto pieno. Pianifica il lancio con margine, accumula recensioni nei primi 30 giorni, e tieni budget pubblicitario di riserva per le settimane in cui l&apos;ACoS dovesse salire sopra 50%.
                    </p>
                    {liveRoi.degradeReason && (
                      <p className="text-xs text-zinc-500 italic">
                        Regola applicata: {liveRoi.degradeReason}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-xs font-semibold uppercase tracking-widest border-b border-zinc-100">
                    <th className="pb-2 text-left pr-4 text-zinc-400 font-medium w-32"></th>
                    {liveRoi.scenarios.map(s => (
                      <th key={s.label} className={`pb-2 text-center ${s.label === 'base' ? 'text-indigo-600' : 'text-zinc-400'}`}>
                        {s.label.charAt(0).toUpperCase() + s.label.slice(1)}
                        <div className="text-[10px] font-normal normal-case tracking-normal">{Math.round(s.captureFraction * 100)}% cattura</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  <tr>
                    <td className="py-2.5 text-xs text-zinc-400 pr-4">Netto 12m</td>
                    {liveRoi.scenarios.map(s => (
                      <td key={s.label} className={`py-2.5 text-center font-semibold ${s.netProfit12m < 0 ? 'text-rose-500' : s.label === 'base' ? 'text-indigo-600' : 'text-zinc-700'}`}>
                        {s.netProfit12m >= 0 ? '+' : ''}{fmt(s.netProfit12m, 0)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 text-xs text-zinc-400 pr-4">Break-even</td>
                    {liveRoi.scenarios.map(s => (
                      <td key={s.label} className={`py-2.5 text-center font-semibold ${s.breakEvenMonths === 999 ? 'text-rose-500' : s.label === 'base' ? 'text-indigo-600' : 'text-zinc-700'}`}>
                        {s.breakEvenMonths === 999 ? '> 12m' : `mese ${s.breakEvenMonths}`}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-2.5 text-xs text-zinc-400 pr-4">Ratio vs budget</td>
                    {liveRoi.scenarios.map(s => (
                      <td key={s.label} className={`py-2.5 text-center font-semibold ${s.ratioVsBudget < 1 ? 'text-rose-500' : s.ratioVsBudget >= 2 ? 'text-emerald-600' : s.label === 'base' ? 'text-indigo-600' : 'text-zinc-700'}`}>
                        {s.ratioVsBudget >= 9999 ? '∞' : `${s.ratioVsBudget.toFixed(1)}×`}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-100 text-xs text-zinc-500">
              Budget produzione: <strong className="text-zinc-800">{fmt(liveRoi.params.budgetProduzione, 0)}</strong>
              <span className="text-zinc-400 ml-1">=  {liveRoi.params.costoScrittura} scrittura + {liveRoi.params.costoCopertina} copertina + {liveRoi.params.costoPerRecensione}×{liveRoi.params.arcReviews} recensioni lancio</span>
            </div>
          </SubCard>

          {/* 3. Economia pubblicitaria */}
          <SubCard title="Economia pubblicitaria" accent="zinc">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KpiCard label="CPC" value={`${liveRoi.params.cpc.toFixed(2)}`} sub="per click" />
              <KpiCard label="Tasso conversione" value={`${(liveRoi.params.conversionRate * 100).toFixed(0)}%`} sub={`1 vend. ogni ${Math.round(1 / liveRoi.params.conversionRate)} click`} />
              <KpiCard label="Costo/vendita ads" value={`${liveRoi.costPerAdSale.toFixed(2)}`} sub="CPC ÷ conversione" />
              <KpiCard label="Royalty libro" value={`${liveRoi.newBookRoyalty.toFixed(2)}`} sub="per copia" />
            </div>
            {!liveRoi.adSaleIsProfitable ? (
              <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-800 leading-relaxed">
                <strong>Vendite pubblicitarie al lancio in perdita</strong> — il costo per vendita ({liveRoi.costPerAdSale.toFixed(2)}) supera la royalty ({liveRoi.newBookRoyalty.toFixed(2)}). È normale: la pubblicità al lancio compra ranking e recensioni, non profitto immediato. La profittabilità cresce con l&apos;organico.
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-2 text-xs text-emerald-700">
                Ogni vendita pubblicitaria è sostenibile: costo ({liveRoi.costPerAdSale.toFixed(2)}) &lt; royalty ({liveRoi.newBookRoyalty.toFixed(2)}).
              </div>
            )}
          </SubCard>

          {/* 4. Pannello costi e parametri — ricalcolo live */}
          <SubCard title="Costi e parametri — ricalcolo live" accent="indigo">
            {(() => {
              const paramFields = [
                { key: 'costoScrittura'     as const, label: 'Costo scrittura',    hint: '0 = scrivi in proprio' },
                { key: 'costoCopertina'     as const, label: 'Costo copertina',    hint: 'es. 50' },
                { key: 'costoPerRecensione' as const, label: 'Costo/recensione',   hint: 'ARC, es. 6' },
                { key: 'arcReviews'         as const, label: 'Recensioni lancio',  hint: 'es. 30' },
                { key: 'conversionRate'     as const, label: 'Tasso conversione',  hint: '0.10 = 1 vendita/10 click' },
                { key: 'cpc'               as const, label: 'CPC ads',            hint: '$/€ per click' },
              ]
              return (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {paramFields.map(({ key, label, hint }) => (
                      <div key={key} className="space-y-1">
                        <label className="text-xs font-medium text-zinc-500">{label}</label>
                        <input
                          type="number" step="any"
                          value={roiLocalParams[key]}
                          onChange={e => setRoiLocalParams(p => ({ ...p, [key]: parseFloat(e.target.value) || 0 }))}
                          className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <p className="text-[10px] text-zinc-400">{hint}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-indigo-100">
                    <p className="text-xs text-zinc-600">
                      Budget produzione: <strong>{fmt(liveRoi.params.budgetProduzione, 0)}</strong>
                      <span className="text-zinc-400 ml-1">= {roiLocalParams.costoScrittura} + {roiLocalParams.costoCopertina} + {roiLocalParams.costoPerRecensione}×{roiLocalParams.arcReviews}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setRoiLocalParams({
                        costoScrittura: roi.params.costoScrittura, costoCopertina: roi.params.costoCopertina,
                        costoPerRecensione: roi.params.costoPerRecensione, arcReviews: roi.params.arcReviews,
                        conversionRate: roi.params.conversionRate, cpc: roi.params.cpc,
                      })}
                      className="text-xs text-indigo-600 hover:text-indigo-800 underline underline-offset-2 transition-colors"
                    >
                      Ripristina default
                    </button>
                  </div>
                </>
              )
            })()}
          </SubCard>

          {/* 5. Note sul calcolo */}
          {(liveRoi.warnings.length > 0 || !roi.anchoredOnTarget) && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Note sul calcolo</p>
              {!roi.anchoredOnTarget && (
                <p className="text-xs text-amber-700">Stima non ancorata al bersaglio. Esegui la valutazione dal Target Finder per ottenere il ramp ancorato alle recensioni reali.</p>
              )}
              {liveRoi.warnings.map((w, i) => (
                <p key={i} className="text-xs text-zinc-500">— {w}</p>
              ))}
            </div>
          )}

          {/* 6. Narrativa AI */}
          <SubCard title="Narrativa" accent="zinc">
            {narrativeIsStale && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                I valori nei pannelli sono stati aggiornati. La narrativa testuale si riferisce ai parametri dell&apos;analisi originale.
              </p>
            )}
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
          Il modello ROI è ancorato al libro bersaglio selezionato dal Target Finder: le vendite stimate non sono la media dei top 5 ma la posizione di mercato che il tuo libro punta a occupare. Il ramp-up riflette il tempo necessario per pareggiare le recensioni del bersaglio. I tre scenari modellano la frazione di vendite catturata: pessimistico (40%) se ti posizioni sotto di lui, base (70%) se lo affianci, ottimistico (100%) se lo raggiungi. Il costo ads al lancio spesso supera la royalty — è normale: la pubblicità nei primi mesi compra ranking e recensioni, non profitto. Il budget di produzione copre solo i costi una-tantum (scrittura + copertina + recensioni lancio); gli ads sono modellati come costo mensile ricorrente separato. I parametri del pannello &quot;Costi e parametri&quot; sono modificabili con effetto immediato sugli scenari.
        </SectionNote>
      </Section>

      {/* ── §8 Sostenibilità Ads ─────────────────────────────────────────── */}
      {(() => {
        const adsIntel = report.ads_intelligence
        const roiPerf = adsIntel?.roi_performance
        if (!adsIntel?.available || !roiPerf?.available) return null
        const cur = adsIntel.currency
        const labelMap: Record<string, string> = { breakeven: 'Breakeven', roi_50: 'ROI 50%', roi_100: 'ROI 100%' }
        return (
          <Section num="8" title="Sostenibilità Ads">
            <div className="space-y-4">

              {/* 1. Costo di Competitività */}
              <SubCard title="Costo di Competitività" accent="indigo">
                <p className="text-2xl font-bold text-zinc-900">
                  {cur}{fmt(adsIntel.recommendedMonthlyAdBudget, 0)}
                  <span className="text-sm font-normal text-zinc-500 ml-1">/mese</span>
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Calcolato come 30% del fatturato mensile medio dei top {adsIntel.competitorCount} competitor
                  {' '}(range {cur}{fmt(adsIntel.competitorMonthlyRevenueRange.min, 0)}–{cur}{fmt(adsIntel.competitorMonthlyRevenueRange.max, 0)},
                  {' '}media {cur}{fmt(adsIntel.competitorMonthlyRevenueAvg, 0)})
                </p>
                {adsIntel.weakSampleWarning && (
                  <p className="text-xs text-zinc-400 mt-1.5 italic">Sample debole: meno di 5 competitor validi</p>
                )}
              </SubCard>

              {/* 2. Box esplicativo */}
              <div className="rounded-xl border border-zinc-200 bg-white px-5 py-4">
                <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-2">Come leggere queste tabelle</p>
                <p className="text-sm text-zinc-600 leading-relaxed">
                  Il Costo di Competitivit&agrave; ({cur}{fmt(adsIntel.recommendedMonthlyAdBudget, 0)}/mese) &egrave; il budget ads necessario per posizionarsi come uno dei top competitor di questa keyword (regola del 30%).
                  {' '}Le due tabelle qui sotto rispondono a domande complementari: a parit&agrave; di prezzo del libro, quante vendite ti servono? A parit&agrave; di vendite (come il competitor medio), che prezzo deve avere il libro?
                  {' '}I 3 target ROI vanno da breakeven (le ads pagano se stesse) a ROI 100% (raddoppio dell&apos;investimento ads).
                </p>
              </div>

              {/* 3. Due tabelle affiancate */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                <SubCard title="A parità di prezzo" accent="sky">
                  <p className="text-xs text-zinc-500 mb-3">
                    Prezzo: <strong className="text-zinc-700">{cur}{fmt(roiPerf.bookPriceUsed, 2)}</strong>
                    {' · '}Pagine: <strong className="text-zinc-700">{roiPerf.bookPagesUsed}</strong>
                    {' · '}Royalty netta: <strong className="text-zinc-700">{cur}{fmt(roiPerf.royaltyNetPerSale, 2)}</strong>
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-200">
                          <th className="pb-2 text-left text-xs font-medium text-zinc-500">Target</th>
                          <th className="pb-2 text-right text-xs font-medium text-zinc-500">Vendite/mese</th>
                          <th className="pb-2 text-right text-xs font-medium text-zinc-500">vs Comp. avg</th>
                          <th className="pb-2 text-right text-xs font-medium text-zinc-500">BEP (mesi)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {roiPerf.byFixedPrice.map(row => (
                          <tr key={row.label}>
                            <td className="py-2.5 text-sm font-medium text-zinc-900">{labelMap[row.label] ?? row.label}</td>
                            <td className="py-2.5 text-right text-sm text-zinc-800">{row.monthlySalesNeeded.toLocaleString('it-IT')}</td>
                            <td className="py-2.5 text-right text-sm text-zinc-800">{row.vsCompetitorAvg.toFixed(2)}x</td>
                            <td className="py-2.5 text-right text-sm text-zinc-800">{row.monthsToBreakeven === 999 ? '—' : fmt(row.monthsToBreakeven, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SubCard>

                <SubCard title="A parità di vendite" accent="sky">
                  <p className="text-xs text-zinc-500 mb-3">
                    Vendite target: <strong className="text-zinc-700">{fmt(roiPerf.competitorAvgMonthlySales, 1)}/mese</strong>
                    {' '}(= competitor medio)
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-200">
                          <th className="pb-2 text-left text-xs font-medium text-zinc-500">Target</th>
                          <th className="pb-2 text-right text-xs font-medium text-zinc-500">Royalty min</th>
                          <th className="pb-2 text-right text-xs font-medium text-zinc-500">Prezzo min</th>
                          <th className="pb-2 text-right text-xs font-medium text-zinc-500">BEP (mesi)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100">
                        {roiPerf.byFixedSales.map(row => (
                          <tr key={row.label}>
                            <td className="py-2.5 text-sm font-medium text-zinc-900">{labelMap[row.label] ?? row.label}</td>
                            <td className="py-2.5 text-right text-sm text-zinc-800">{cur}{fmt(row.royaltyNetMinPerSale, 2)}</td>
                            <td className="py-2.5 text-right text-sm text-zinc-800">{row.minBookPrice === -1 ? 'n/d' : `${cur}${fmt(row.minBookPrice, 2)}`}</td>
                            <td className="py-2.5 text-right text-sm text-zinc-800">{row.monthsToBreakeven === 999 ? '—' : fmt(row.monthsToBreakeven, 1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SubCard>

              </div>

            </div>
            <SectionNote>
              Calcoli basati su dati osservati dei top {adsIntel.competitorCount} competitor paperback. Budget produzione assunto: {cur}{fmt(roiPerf.budgetProduzione, 0)} (cover + ARC reviews). I mesi a breakeven si applicano al recupero del budget di produzione sul profitto mensile residuo: per il target breakeven (multiplier 1×) il profitto residuo &egrave; zero e il breakeven &egrave; irraggiungibile (—). Royalty calcolata con la regola KDP standard per il mercato {report.market}.
            </SectionNote>
          </Section>
        )
      })()}

    </div>
  )
}
