import { FilteredBook, PainPoint, TrendsData } from './types'
import { getComplianceMultiplier, ComplianceRisk } from './compliance'
import { calcRoyalty } from './amazon'
import type { Market } from './types'

// ─── Pain Point scoring ───────────────────────────────────────────────────────
// Formula: F×0.2 + I×0.4 + S×0.4
// Override: Intensità (I) >= 9 → criticalSignal = true (incluso sempre)
// Soglia inclusione: score >= 3.0, min 1 evidence mention, min 2 fonti distinte

export function scorePainPoint(pp: Omit<PainPoint, 'score' | 'criticalSignal'>): PainPoint {
  const score = Math.round((pp.F * 0.2 + pp.I * 0.4 + pp.S * 0.4) * 10) / 10
  const criticalSignal = pp.I >= 9
  return { ...pp, score, criticalSignal }
}

export function filterPainPoints(
  raw: Omit<PainPoint, 'score' | 'criticalSignal'>[],
): PainPoint[] {
  const scored = raw.map(pp => scorePainPoint(pp))

  return scored
    .filter(pp => pp.criticalSignal || pp.score >= 3.0)
    .sort((a, b) => {
      // criticalSignal sempre in cima
      if (a.criticalSignal && !b.criticalSignal) return -1
      if (!a.criticalSignal && b.criticalSignal) return 1
      return b.score - a.score
    })
}

// ─── Entry Difficulty ─────────────────────────────────────────────────────────
// Basata sul LEADER (posizione 1), NON sul competitor_target
// BSR leader: <5k=facile, 5k-50k=medio, >50k=difficile
// Reviews leader: <50=facile, 50-200=medio, >200=difficile

export type DifficultyLevel = 'FACILE' | 'MEDIO' | 'DIFFICILE'

export function calcEntryDifficulty(leader: FilteredBook): DifficultyLevel {
  const bsr = leader.bsr
  const rev = leader.reviewCount

  let bsrScore: number
  if (bsr < 5_000)       bsrScore = 3  // difficile
  else if (bsr < 50_000) bsrScore = 2  // medio
  else                   bsrScore = 1  // facile

  let revScore: number
  if (rev > 200)      revScore = 3
  else if (rev >= 50) revScore = 2
  else                revScore = 1

  const total = bsrScore + revScore

  if (total >= 5) return 'DIFFICILE'
  if (total >= 3) return 'MEDIO'
  return 'FACILE'
}

// ─── Trend Signal ─────────────────────────────────────────────────────────────

export type TrendSignal = 'CRESCITA' | 'STABILE' | 'DECLINO' | 'N/A'

export function calcTrendSignal(trends: TrendsData): TrendSignal {
  if (!trends.available || trends.timelineData.length < 24) return 'N/A'
  const yoy = trends.yoyGrowth
  if (yoy >= 15)       return 'CRESCITA'
  if (yoy <= -15)      return 'DECLINO'
  return 'STABILE'
}

// ─── Profitability Score ──────────────────────────────────────────────────────
// Output: 0-100, intero
//
// Componenti (tutti 0-10, pesati):
//   A. Domanda       (30%) — BSR medio top 5
//   B. Prezzo        (25%) — prezzo medio top 5 (proxy royalty)
//   C. Competizione  (20%) — invertito da Entry Difficulty
//   D. Trend         (15%) — TrendSignal
//   E. Compliance    (10%) — compliance multiplier

export interface ProfitabilityBreakdown {
  score: number            // 0-100 intero finale
  demandScore: number      // 0-10
  priceScore: number       // 0-10
  competitionScore: number // 0-10
  trendScore: number       // 0-10
  complianceScore: number  // 0-10
  entryDifficulty: DifficultyLevel
  trendSignal: TrendSignal
  avgBsr: number           // BSR medio top 5
  avgPrice: number         // prezzo medio top 5
  minPrice: number
  maxPrice: number
  avgPages: number         // pagine medie top 5
  minPages: number
  maxPages: number
}

export function calcProfitabilityScore(
  topBooks: FilteredBook[],
  trends: TrendsData,
  complianceRisk: ComplianceRisk,
  market: Market,
): ProfitabilityBreakdown {
  if (topBooks.length === 0) {
    throw new Error('calcProfitabilityScore: topBooks è vuoto')
  }

  // ── A. Domanda (BSR medio) ─────────────────────────────────────────────────
  const avgBsr = Math.round(
    topBooks.reduce((s, b) => s + b.bsr, 0) / topBooks.length
  )
  let demandScore: number
  if (avgBsr < 2_000)        demandScore = 10
  else if (avgBsr < 5_000)   demandScore = 9
  else if (avgBsr < 10_000)  demandScore = 8
  else if (avgBsr < 20_000)  demandScore = 7
  else if (avgBsr < 40_000)  demandScore = 5
  else if (avgBsr < 80_000)  demandScore = 3
  else if (avgBsr < 150_000) demandScore = 2
  else                        demandScore = 1

  // ── B. Prezzo medio (proxy royalty) ──────────────────────────────────────
  const prices = topBooks.map(b => b.price)
  const avgPrice = Math.round((prices.reduce((s, p) => s + p, 0) / prices.length) * 100) / 100
  const minPrice = Math.min(...prices)
  const maxPrice = Math.max(...prices)
  const pagesArr = topBooks.map(b => b.pages ?? 200)
  const avgPages = Math.round(pagesArr.reduce((s, p) => s + p, 0) / pagesArr.length)
  const minPages = Math.min(...pagesArr)
  const maxPages = Math.max(...pagesArr)
  let priceScore: number
  if (avgPrice >= 25)      priceScore = 10
  else if (avgPrice >= 20) priceScore = 9
  else if (avgPrice >= 16) priceScore = 7
  else if (avgPrice >= 12) priceScore = 5
  else if (avgPrice >= 9)  priceScore = 3
  else if (avgPrice >= 6)  priceScore = 2
  else                      priceScore = 1

  // ── C. Competizione (Entry Difficulty invertita) ──────────────────────────
  const leader = topBooks[0]
  const entryDifficulty = calcEntryDifficulty(leader)
  const competitionScore: number =
    entryDifficulty === 'FACILE'    ? 9 :
    entryDifficulty === 'MEDIO'     ? 6 :
    /* DIFFICILE */                   3

  // ── D. Trend ──────────────────────────────────────────────────────────────
  const trendSignal = calcTrendSignal(trends)
  const trendScore: number =
    trendSignal === 'CRESCITA' ? 10 :
    trendSignal === 'STABILE'  ? 6  :
    trendSignal === 'DECLINO'  ? 2  :
    /* N/A */                    5   // neutro se dati non disponibili

  // ── E. Compliance ─────────────────────────────────────────────────────────
  const mult = getComplianceMultiplier(complianceRisk)
  const complianceScore: number =
    mult === 1.00 ? 10 :
    mult === 0.85 ? 7  :
    /* 0.65 */      4

  // ── Score finale pesato ───────────────────────────────────────────────────
  const raw =
    demandScore      * 0.30 +
    priceScore       * 0.25 +
    competitionScore * 0.20 +
    trendScore       * 0.15 +
    complianceScore  * 0.10

  const score = Math.round(raw * 10)  // scala 0-100

  return {
    score,
    demandScore,
    priceScore,
    competitionScore,
    trendScore,
    complianceScore,
    entryDifficulty,
    trendSignal,
    avgBsr,
    avgPrice,
    minPrice,
    maxPrice,
    avgPages,
    minPages,
    maxPages,
  }
}

// ─── Investment / ROI ─────────────────────────────────────────────────────────
// Stima deterministica per §7 del report
// ROAS fisso = 2; semaforo verde ≤2.0 BEP, giallo 2.0-3.5, rosso >3.5

export type RoasSignal = 'VERDE' | 'GIALLO' | 'ROSSO'

export interface RoiEstimate {
  avgDailySalesMin: number
  avgDailySalesMax: number
  avgMonthlyRevenueMin: number  // royalty × vendite/giorno × 30
  avgMonthlyRevenueMax: number
  breakEvenMonths: number       // budget / guadagno_mensile_mid
  bepSignal: RoasSignal
  suggestedAdsMonthly: number   // guadagno_mensile_mid × 0.3 (30% budget)
  cashflowBuffer: number        // suggestedAdsMonthly × 2 (NON guadagno × 2)
  roiCluster12mMin: number      // proiezione 12 mesi low
  roiCluster12mMax: number
  investVerdict: 'INVEST' | 'PARTIAL' | 'PASS'
}

export function calcRoiEstimate(
  topBooks: FilteredBook[],
  budget: number,            // budget totale investimento (scrittura + copertina + ads)
  market: Market,
): RoiEstimate {
  const avgDailySalesMin = Math.round(
    topBooks.reduce((s, b) => s + b.estimatedDailySalesMin, 0) / topBooks.length
  )
  const avgDailySalesMax = Math.round(
    topBooks.reduce((s, b) => s + b.estimatedDailySalesMax, 0) / topBooks.length
  )

  const avgRoyalty = topBooks.reduce(
    (s, b) => s + calcRoyalty(b.price, b.pages ?? 200, market), 0
  ) / topBooks.length

  const avgMonthlyRevenueMin = Math.round(avgDailySalesMin * avgRoyalty * 30 * 100) / 100
  const avgMonthlyRevenueMax = Math.round(avgDailySalesMax * avgRoyalty * 30 * 100) / 100
  const avgMonthlyRevenueMid = (avgMonthlyRevenueMin + avgMonthlyRevenueMax) / 2

  const breakEvenMonths = avgMonthlyRevenueMid > 0
    ? Math.round((budget / avgMonthlyRevenueMid) * 10) / 10
    : 999

  const bepSignal: RoasSignal =
    breakEvenMonths <= 2.0 ? 'VERDE' :
    breakEvenMonths <= 3.5 ? 'GIALLO' :
    'ROSSO'

  // Buffer cashflow = spesa_ads × 2 (NON guadagno × 2)
  const suggestedAdsMonthly = Math.round(avgMonthlyRevenueMid * 0.3 * 100) / 100
  const cashflowBuffer = Math.round(suggestedAdsMonthly * 2 * 100) / 100

  // Proiezione cluster 12 mesi (conservative: mese 1-3 ramp-up al 50%)
  const rampMonths = 3
  const fullMonths = 9
  const roiCluster12mMin = Math.round(
    (avgMonthlyRevenueMin * 0.5 * rampMonths + avgMonthlyRevenueMin * fullMonths) * 100
  ) / 100
  const roiCluster12mMax = Math.round(
    (avgMonthlyRevenueMax * 0.5 * rampMonths + avgMonthlyRevenueMax * fullMonths) * 100
  ) / 100

  // INVEST soglia: ROI cluster 12m >= 2× budget cluster
  const roiMid = (roiCluster12mMin + roiCluster12mMax) / 2
  const investVerdict: 'INVEST' | 'PARTIAL' | 'PASS' =
    roiMid >= budget * 2   ? 'INVEST' :
    roiMid >= budget * 1.0 ? 'PARTIAL' :
    'PASS'

  return {
    avgDailySalesMin,
    avgDailySalesMax,
    avgMonthlyRevenueMin,
    avgMonthlyRevenueMax,
    breakEvenMonths,
    bepSignal,
    suggestedAdsMonthly,
    cashflowBuffer,
    roiCluster12mMin,
    roiCluster12mMax,
    investVerdict,
  }
}

// ─── Dinamismo Competitivo ─────────────────────────────────────────────────────

export type DynamismSignal = 'APERTO' | 'DINAMICO' | 'CONSOLIDATO' | 'N/A'

export interface CompetitiveDynamism {
  signal: DynamismSignal
  recent: number      // libri 60gg–12m
  mid: number         // libri 1–3 anni
  consolidated: number // libri >3 anni
  excluded: number    // libri <60gg (honeymoon)
  total: number       // totale validi (esclusi <60gg)
}

export function calcCompetitiveDynamism(
  rawTop15: { publishedDate?: string }[],
  scrapedAt: string,
): CompetitiveDynamism {
  const now = new Date(scrapedAt)
  let recent = 0, mid = 0, consolidated = 0, excluded = 0

  for (const book of rawTop15) {
    if (!book.publishedDate) continue
    const pub = new Date(book.publishedDate)
    if (isNaN(pub.getTime())) continue
    const diffDays   = (now.getTime() - pub.getTime()) / (1000 * 60 * 60 * 24)
    const diffMonths = diffDays / 30.44
    const diffYears  = diffDays / 365.25

    if (diffDays < 60)      excluded++
    else if (diffMonths <= 12) recent++
    else if (diffYears <= 3)   mid++
    else                       consolidated++
  }

  const total = recent + mid + consolidated
  let signal: DynamismSignal = 'N/A'
  if (total >= 5) {
    const ratio = recent / total
    if (ratio > 0.33)      signal = 'APERTO'
    else if (ratio >= 0.20) signal = 'DINAMICO'
    else                    signal = 'CONSOLIDATO'
  }

  return { signal, recent, mid, consolidated, excluded, total }
}
