import { FilteredBook, PainPoint, TrendsData, RoasSignal, InvestVerdict, RoiScenario, RoiEstimate } from './types'
import { getComplianceMultiplier, ComplianceRisk } from './compliance'
import { calcRoyalty } from './amazon'
import type { Market, AdsIntelligence, RoiPerformance, RoiPerformanceByFixedPrice, RoiPerformanceByFixedSales } from './types'

export type { RoasSignal, InvestVerdict, RoiScenario, RoiEstimate }

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

// ─── ROI Re-anchor — costanti §5.2 ───────────────────────────────────────────

const CAPTURE_FRACTIONS = { pessimistico: 0.40, base: 0.70, ottimistico: 1.00 } as const

const DEFAULT_CONVERSION_RATE = 0.10

const DEFAULT_CPC: Record<Market, number> = {
  US: 0.55, UK: 0.45, DE: 0.40, FR: 0.35, IT: 0.30, ES: 0.30,
}

const DEFAULT_COSTO_SCRITTURA      = 0
const DEFAULT_COSTO_COPERTINA      = 50
const DEFAULT_COSTO_PER_RECENSIONE = 6
const DEFAULT_ARC_REVIEWS          = 30

const ADS_SHARE_START = 0.70
const ADS_SHARE_DECAY = 0.50
const ADS_SHARE_FLOOR = 0.20

const ROI_TARGETS = [
  { label: 'breakeven' as const, multiplier: 1.0 },
  { label: 'roi_50'    as const, multiplier: 1.5 },
  { label: 'roi_100'   as const, multiplier: 2.0 },
]

// ─── Investment / ROI Re-anchor ───────────────────────────────────────────────
// §7: 3 scenari ancorati al competitor target, §6.2

export function calcRoiEstimate(
  competitorTarget: FilteredBook,
  market: Market,
  opts: {
    monthsToParity?: number
    arcReviews?: number
    cpc?: number
    conversionRate?: number
    plannedPrice?: number
    plannedPages?: number
    costoScrittura?: number
    costoCopertina?: number
    costoPerRecensione?: number
  } = {},
): RoiEstimate {
  const warnings: string[] = []

  // 1. Risolvi parametri
  const cpc            = opts.cpc            ?? DEFAULT_CPC[market]
  const conversionRate = opts.conversionRate ?? DEFAULT_CONVERSION_RATE
  const plannedPrice   = opts.plannedPrice   ?? competitorTarget.price
  const plannedPages   = opts.plannedPages   ?? (competitorTarget.pages ?? 200)
  const costoScrittura     = opts.costoScrittura     ?? DEFAULT_COSTO_SCRITTURA
  const costoCopertina     = opts.costoCopertina     ?? DEFAULT_COSTO_COPERTINA
  const costoPerRecensione = opts.costoPerRecensione ?? DEFAULT_COSTO_PER_RECENSIONE
  const arcReviews         = opts.arcReviews         ?? DEFAULT_ARC_REVIEWS

  if (opts.plannedPrice === undefined) warnings.push('prezzo pianificato non fornito: usato prezzo del bersaglio')
  if (opts.plannedPages === undefined) warnings.push('pagine pianificate non fornite: usate pagine del bersaglio')

  // 2. Budget di produzione (solo produzione, no ads)
  const budgetProduzione = costoScrittura + costoCopertina + costoPerRecensione * arcReviews
  if (budgetProduzione === 0) warnings.push('budget di produzione nullo: tutti i costi sono 0')

  // 3. Royalty del nuovo libro
  const newBookRoyalty = calcRoyalty(plannedPrice, plannedPages, market)
  if (newBookRoyalty <= 0) warnings.push('royalty negativa: prezzo insufficiente a coprire il costo di stampa')

  // 4. Ramp
  let rampMonths: number
  if (opts.monthsToParity !== undefined) {
    rampMonths = Math.min(12, Math.max(1, Math.round(opts.monthsToParity)))
  } else {
    rampMonths = 3
    warnings.push('monthsToParity assente: ramp fisso a 3 mesi (non ancorato al bersaglio)')
  }

  // 5. Costo per vendita pubblicitaria
  const costPerAdSale     = cpc / conversionRate
  const adSaleIsProfitable = costPerAdSale <= newBookRoyalty

  const targetMin = competitorTarget.estimatedDailySalesMin
  const targetMax = competitorTarget.estimatedDailySalesMax
  const targetMid = (targetMin + targetMax) / 2

  // Edge case: target vendite nulle
  if (targetMid === 0) {
    warnings.push('vendite del bersaglio nulle: ROI non calcolabile')
    const zero = (label: RoiScenario['label'], captureFraction: number): RoiScenario => ({
      label, captureFraction,
      monthlyRevenue: Array(12).fill(0) as number[],
      monthlyAdCost:  Array(12).fill(0) as number[],
      netProfit12m: 0, breakEvenMonths: 999, ratioVsBudget: 0,
    })
    return {
      anchoredOnTarget: true, targetAsin: competitorTarget.asin,
      targetDailySalesMin: targetMin, targetDailySalesMax: targetMax,
      newBookRoyalty: Math.round(newBookRoyalty * 100) / 100, rampMonths,
      params: { cpc, conversionRate, plannedPrice, plannedPages, costoScrittura, costoCopertina, costoPerRecensione, arcReviews, budgetProduzione },
      scenarios: [
        zero('pessimistico', CAPTURE_FRACTIONS.pessimistico),
        zero('base',         CAPTURE_FRACTIONS.base),
        zero('ottimistico',  CAPTURE_FRACTIONS.ottimistico),
      ],
      costPerAdSale: Math.round(costPerAdSale * 100) / 100,
      adSaleIsProfitable, bepSignal: 'ROSSO', investVerdict: 'PASS', warnings,
    }
  }

  // 6. Calcola i 3 scenari mese per mese
  const scenarioLabels: RoiScenario['label'][] = ['pessimistico', 'base', 'ottimistico']
  const fractions = [CAPTURE_FRACTIONS.pessimistico, CAPTURE_FRACTIONS.base, CAPTURE_FRACTIONS.ottimistico]
  const bepThreshold = budgetProduzione > 0 ? budgetProduzione : 0.01

  const scenarios: RoiScenario[] = scenarioLabels.map((label, i) => {
    const captureFraction = fractions[i]
    const monthlyRevenue: number[] = []
    const monthlyAdCost:  number[] = []
    let netProfit12m = 0
    let cumulative   = 0
    let breakEvenMonths = 999

    for (let m = 1; m <= 12; m++) {
      const capture = m <= rampMonths
        ? captureFraction * (0.3 + 0.7 * m / rampMonths)
        : captureFraction

      const monthlySales  = targetMid * capture * 30
      const revenue       = monthlySales * newBookRoyalty
      const adsShare      = Math.min(ADS_SHARE_START, Math.max(ADS_SHARE_FLOOR, ADS_SHARE_START - ADS_SHARE_DECAY * (m / 12)))
      const adCost        = monthlySales * adsShare * costPerAdSale
      const netMonth      = revenue - adCost

      netProfit12m += netMonth
      cumulative   += netMonth

      if (breakEvenMonths === 999 && cumulative >= bepThreshold) breakEvenMonths = m

      monthlyRevenue.push(Math.round(revenue  * 100) / 100)
      monthlyAdCost.push( Math.round(adCost   * 100) / 100)
    }

    netProfit12m = Math.round(netProfit12m * 100) / 100
    const ratioVsBudget = budgetProduzione === 0
      ? (netProfit12m > 0 ? 99999 : 0)
      : Math.round((netProfit12m / budgetProduzione) * 100) / 100

    return { label, captureFraction, monthlyRevenue, monthlyAdCost, netProfit12m, breakEvenMonths, ratioVsBudget }
  })

  // 7. Verdetto dallo scenario base (indice 1)
  const baseRatio = scenarios[1].ratioVsBudget
  const investVerdict: InvestVerdict =
    baseRatio >= 2.0 ? 'INVEST' :
    baseRatio >= 1.0 ? 'PARTIAL' :
    'PASS'

  // 8. Segnale BEP dallo scenario base
  const baseBep = scenarios[1].breakEvenMonths
  const bepSignal: RoasSignal =
    baseBep <= 2.0 ? 'VERDE' :
    baseBep <= 3.5 ? 'GIALLO' :
    'ROSSO'

  return {
    anchoredOnTarget: true,
    targetAsin: competitorTarget.asin,
    targetDailySalesMin: targetMin,
    targetDailySalesMax: targetMax,
    newBookRoyalty: Math.round(newBookRoyalty * 100) / 100,
    rampMonths,
    params: { cpc, conversionRate, plannedPrice, plannedPages, costoScrittura, costoCopertina, costoPerRecensione, arcReviews, budgetProduzione },
    scenarios,
    costPerAdSale: Math.round(costPerAdSale * 100) / 100,
    adSaleIsProfitable,
    bepSignal,
    investVerdict,
    warnings,
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

// ─── ROI Ads Performance ──────────────────────────────────────────────────────

export function priceForRoyalty(
  targetRoyaltyNet: number,
  pages: number,
  market: Market,
): number {
  for (let p = 1; p <= 99.99; p += 0.50) {
    if (calcRoyalty(p, pages, market) >= targetRoyaltyNet) {
      return Math.round(p * 100) / 100
    }
  }
  return -1
}

export function calcRoiPerformance(
  adsIntelligence: AdsIntelligence,
  avgPrice: number,
  avgPages: number,
  market: Market,
  opts: {
    plannedPrice?: number
    plannedPages?: number
    costoCopertina?: number
    arcReviews?: number
    costoPerRecensione?: number
  } = {},
): RoiPerformance {
  if (!adsIntelligence.available || adsIntelligence.recommendedMonthlyAdBudget <= 0) {
    return {
      available: false,
      monthlyAdBudget: 0,
      competitorAvgMonthlySales: 0,
      budgetProduzione: 0,
      bookPriceUsed: 0,
      bookPagesUsed: 0,
      royaltyNetPerSale: 0,
      byFixedPrice: [],
      byFixedSales: [],
    }
  }

  const budget = adsIntelligence.recommendedMonthlyAdBudget
  const competitorAvg = adsIntelligence.competitorMonthlyRevenueAvg
  const competitorAvgMonthlySales = avgPrice > 0 ? competitorAvg / avgPrice : 0

  const costoCopertina    = opts.costoCopertina    ?? DEFAULT_COSTO_COPERTINA
  const costoPerRec       = opts.costoPerRecensione ?? DEFAULT_COSTO_PER_RECENSIONE
  const arcReviews        = opts.arcReviews        ?? DEFAULT_ARC_REVIEWS
  const budgetProduzione  = costoCopertina + costoPerRec * arcReviews

  const bookPrice  = opts.plannedPrice ?? avgPrice
  const bookPages  = opts.plannedPages ?? avgPages
  const royaltyNet = calcRoyalty(bookPrice, bookPages, market)

  const byFixedPrice: RoiPerformanceByFixedPrice[] = ROI_TARGETS.map(t => {
    const royaltyTotaleRichiesta = budget * t.multiplier
    const monthlySalesNeeded = royaltyNet > 0 ? Math.ceil(royaltyTotaleRichiesta / royaltyNet) : 0
    const vsCompetitorAvg = competitorAvgMonthlySales > 0
      ? monthlySalesNeeded / competitorAvgMonthlySales
      : 0
    const profittoMensile = budget * (t.multiplier - 1)
    const monthsToBreakeven = profittoMensile > 0
      ? Math.round((budgetProduzione / profittoMensile) * 10) / 10
      : 999
    return {
      label: t.label,
      multiplier: t.multiplier,
      monthlySalesNeeded,
      vsCompetitorAvg: Math.round(vsCompetitorAvg * 100) / 100,
      monthsToBreakeven,
    }
  })

  const byFixedSales: RoiPerformanceByFixedSales[] = ROI_TARGETS.map(t => {
    const royaltyTotaleRichiesta = budget * t.multiplier
    const royaltyNetMinPerSale = competitorAvgMonthlySales > 0
      ? royaltyTotaleRichiesta / competitorAvgMonthlySales
      : 0
    const minBookPrice = priceForRoyalty(royaltyNetMinPerSale, bookPages, market)
    const profittoMensile = budget * (t.multiplier - 1)
    const monthsToBreakeven = profittoMensile > 0
      ? Math.round((budgetProduzione / profittoMensile) * 10) / 10
      : 999
    return {
      label: t.label,
      multiplier: t.multiplier,
      royaltyNetMinPerSale: Math.round(royaltyNetMinPerSale * 100) / 100,
      minBookPrice,
      monthsToBreakeven,
    }
  })

  return {
    available: true,
    monthlyAdBudget: budget,
    competitorAvgMonthlySales: Math.round(competitorAvgMonthlySales * 10) / 10,
    budgetProduzione,
    bookPriceUsed: bookPrice,
    bookPagesUsed: bookPages,
    royaltyNetPerSale: Math.round(royaltyNet * 100) / 100,
    byFixedPrice,
    byFixedSales,
  }
}
