import { Market, TargetCandidate, TargetFinderResult, Attackability, TargetViability, TargetVerdict, TargetWeakness } from './types'
import { bsrToSales, calcRoyalty } from './amazon'

// ─── Costanti (§6.2) ──────────────────────────────────────────────────────────

export const REVIEW_GATE_HARD = 100
export const REVIEW_GATE_SOFT = 150

export const RATING_WEAK = 4.3
export const RATING_VETO = 4.8

export const PARITY_COMFORTABLE = 8
export const PARITY_CHALLENGE = 18

export const MARKET_BSR_MAX: Record<Market, number> = {
  US: 50000, UK: 15000, DE: 20000, FR: 10000, IT: 4000, ES: 8000,
}

export const MARKET_BSR_IDEAL: Record<Market, number> = {
  US: 15000, UK: 10000, DE: 10000, FR: 5000, IT: 4000, ES: 4000,
}

export const HONEYMOON_DAYS = 75

// ─── RawCandidate ─────────────────────────────────────────────────────────────

export interface RawCandidate {
  asin: string
  title: string
  imageUrl?: string
  price: number
  currency: string
  reviewCount: number
  rating: number
  bsr: number
  pages: number
  publishedDate?: string
  selfPublished: boolean
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

function calcAgeMonths(publishedDate: string | undefined): number | null {
  if (!publishedDate) return null
  const pub = new Date(publishedDate)
  if (isNaN(pub.getTime())) return null
  return (Date.now() - pub.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
}

// ─── Stima velocità recensioni nicchia (§3.6) ─────────────────────────────────

export function estimateNicheReviewVelocity(
  candidates: Array<{ reviewCount: number; publishedDate?: string }>,
): { velocity: number; warning?: string } {
  const FALLBACK = 6
  const valid = candidates.filter(c => {
    if (!c.publishedDate) return false
    const pub = new Date(c.publishedDate)
    if (isNaN(pub.getTime())) return false
    const ageDays = (Date.now() - pub.getTime()) / (1000 * 60 * 60 * 24)
    return ageDays >= HONEYMOON_DAYS
  })

  if (valid.length === 0) {
    return {
      velocity: FALLBACK,
      warning: 'Nessun candidato valido per stima velocità nicchia: usato fallback 6 rec/mese',
    }
  }

  const velocities = valid.map(c => {
    const ageDays = (Date.now() - new Date(c.publishedDate!).getTime()) / (1000 * 60 * 60 * 24)
    const ageMonths = ageDays / 30.44
    return ageMonths > 0 ? c.reviewCount / ageMonths : 0
  })

  return { velocity: median(velocities) }
}

// ─── Gate recensioni + fattori promozione (§3.1, §3.2) ───────────────────────

function calcAttackability(
  reviewCount: number,
  monthsToParity: number,
  rating: number,
): { attackability: Attackability; promotionFactors: TargetCandidate['promotionFactors'] } {
  const ratingVeto = rating > RATING_VETO
  const lowReviewVelocity = monthsToParity <= PARITY_COMFORTABLE
  const weakRating = rating <= RATING_WEAK

  let attackability: Attackability

  if (reviewCount <= REVIEW_GATE_HARD) {
    attackability = 'ATTACCABILE'
  } else if (reviewCount <= REVIEW_GATE_SOFT) {
    const promotedCount = [lowReviewVelocity, weakRating].filter(Boolean).length
    attackability = (!ratingVeto && promotedCount >= 2)
      ? 'ATTACCABILE_SE_PROMOSSO'
      : 'NON_PROMOSSO'
  } else {
    attackability = 'NON_ATTACCABILE'
  }

  return { attackability, promotionFactors: { lowReviewVelocity, weakRating, ratingVeto } }
}

// ─── Defense score D (§3.3) ──────────────────────────────────────────────────

function calcDefenseScore(reviewCount: number, monthsToParity: number): number {
  const reviewWall = clamp(
    Math.log10(reviewCount + 1) / Math.log10(REVIEW_GATE_SOFT + 1),
    0, 1,
  )
  const parityHeight = clamp(monthsToParity / PARITY_CHALLENGE, 0, 1)
  return Math.round((reviewWall * 0.5 + parityHeight * 0.5) * 100)
}

// ─── buildTargetFinderResult (§6.2) ──────────────────────────────────────────

export function buildTargetFinderResult(
  rawCandidates: RawCandidate[],
  keyword: string,
  market: Market,
  scrapedAt: string,
): TargetFinderResult {
  const warnings: string[] = []

  const { velocity: nicheReviewVelocity, warning: velocityWarning } =
    estimateNicheReviewVelocity(rawCandidates)
  if (velocityWarning) warnings.push(velocityWarning)

  // Prima passata: costruisce candidati con gate, scoring base, quadrante placeholder
  const candidates: TargetCandidate[] = rawCandidates.map(raw => {
    const ageMonths = calcAgeMonths(raw.publishedDate)
    const outOfBsrRange = raw.bsr > MARKET_BSR_MAX[market]
    let dataComplete = raw.bsr > 0 && ageMonths !== null

    let estMonthlySalesMin = 0
    let estMonthlySalesMax = 0
    let estMonthlyRevenueMin = 0
    let estMonthlyRevenueMax = 0

    if (raw.bsr > 0) {
      const sales = bsrToSales(raw.bsr, market)
      estMonthlySalesMin = sales.min * 30
      estMonthlySalesMax = sales.max * 30
      const royalty = calcRoyalty(raw.price || 9.99, raw.pages || 200, market)
      estMonthlyRevenueMin = Math.round(estMonthlySalesMin * royalty * 100) / 100
      estMonthlyRevenueMax = Math.round(estMonthlySalesMax * royalty * 100) / 100
    } else {
      dataComplete = false
    }

    const monthsToParity = nicheReviewVelocity > 0
      ? raw.reviewCount / nicheReviewVelocity
      : 999

    const { attackability, promotionFactors } = calcAttackability(
      raw.reviewCount, monthsToParity, raw.rating,
    )

    const defenseScore = calcDefenseScore(raw.reviewCount, monthsToParity)

    return {
      asin: raw.asin,
      title: raw.title,
      imageUrl: raw.imageUrl,
      price: raw.price,
      currency: raw.currency,
      reviewCount: raw.reviewCount,
      rating: raw.rating,
      bsr: raw.bsr,
      pages: raw.pages,
      publishedDate: raw.publishedDate,
      ageMonths,
      selfPublished: raw.selfPublished,
      estMonthlySalesMin,
      estMonthlySalesMax,
      estMonthlyRevenueMin,
      estMonthlyRevenueMax,
      attackability,
      monthsToParity,
      promotionFactors,
      defenseScore,
      sellsScore: 0,
      attractiveness: 0,
      quadrant: 'DATI_INSUFFICIENTI',
      dataComplete,
      outOfBsrRange,
    }
  })

  // Subset attaccabili validi per mediane e normalizzazione sells score
  const attackableValid = candidates.filter(c =>
    (c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO') &&
    c.dataComplete &&
    !c.outOfBsrRange,
  )

  const revMids = attackableValid.map(c => (c.estMonthlyRevenueMin + c.estMonthlyRevenueMax) / 2)
  const minRev = revMids.length > 0 ? Math.min(...revMids) : 0
  const maxRev = revMids.length > 0 ? Math.max(...revMids) : 0
  const medianRevenue = median(revMids)
  const medianDefense = median(attackableValid.map(c => c.defenseScore))

  // Seconda passata: sellsScore, attractiveness, quadrante
  for (const c of candidates) {
    const revMid = (c.estMonthlyRevenueMin + c.estMonthlyRevenueMax) / 2
    const isAttackableValid =
      (c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO') &&
      c.dataComplete &&
      !c.outOfBsrRange

    c.sellsScore = (isAttackableValid && maxRev > minRev)
      ? Math.round((revMid - minRev) / (maxRev - minRev) * 100)
      : 0

    c.attractiveness = (c.sellsScore / 100) * (1 - c.defenseScore / 100)

    if (c.attackability === 'NON_ATTACCABILE' || c.attackability === 'NON_PROMOSSO') {
      c.quadrant = 'NON_ATTACCABILE'
    } else if (!c.dataComplete || c.outOfBsrRange) {
      c.quadrant = 'DATI_INSUFFICIENTI'
    } else if (revMid >= medianRevenue && c.defenseScore < medianDefense) {
      c.quadrant = 'IDEALE'
    } else if (revMid >= medianRevenue && c.defenseScore >= medianDefense) {
      c.quadrant = 'TROPPO_DURO'
    } else if (revMid < medianRevenue && c.defenseScore < medianDefense) {
      c.quadrant = 'FACILE_BASSA_RESA'
    } else {
      c.quadrant = 'ANOMALO'
    }
  }

  // Selezione suggeriti (§6.2)
  let suggested = candidates
    .filter(c => c.quadrant === 'IDEALE')
    .sort((a, b) => b.attractiveness - a.attractiveness)
    .slice(0, 3)

  if (suggested.length < 3) {
    const fallbacks = candidates
      .filter(c => c.quadrant === 'FACILE_BASSA_RESA')
      .sort((a, b) => b.attractiveness - a.attractiveness)
      .slice(0, 3 - suggested.length)
    suggested = [...suggested, ...fallbacks]
    if (fallbacks.length > 0) {
      warnings.push('Pochi bersagli ideali: aggiunti ripieghi a bassa resa — valutare una keyword diversa')
    }
  }

  // Edge case: tutti fuori soglia BSR
  if (candidates.length > 0 && candidates.every(c => c.outOfBsrRange || c.bsr === 0)) {
    warnings.push('Nessun libro sopra la soglia di mercato — nicchia debole o keyword da rivedere')
  }

  // Avviso pochi attaccabili
  const attackableCount = candidates.filter(
    c => c.attackability === 'ATTACCABILE' || c.attackability === 'ATTACCABILE_SE_PROMOSSO',
  ).length
  if (attackableCount < 5) {
    warnings.push('Pochi competitor attaccabili in questa nicchia')
  }

  const sortedCandidates = [...candidates].sort((a, b) => {
    const aAtt = a.attackability === 'ATTACCABILE' || a.attackability === 'ATTACCABILE_SE_PROMOSSO'
    const bAtt = b.attackability === 'ATTACCABILE' || b.attackability === 'ATTACCABILE_SE_PROMOSSO'
    if (aAtt && !bAtt) return -1
    if (!aAtt && bAtt) return 1
    return b.attractiveness - a.attractiveness
  })

  return {
    keyword,
    market,
    scrapedAt,
    candidates: sortedCandidates,
    suggested,
    nicheReviewVelocity,
    medians: { revenue: medianRevenue, defense: medianDefense },
    warning: warnings.length > 0 ? warnings.join(' | ') : undefined,
  }
}

// ─── calcTargetViability (§7) ─────────────────────────────────────────────────

const DEFAULT_USER_REVIEW_VELOCITY = 3  // rec/mese — ipotesi conservativa per autore nuovo
const FRESHNESS_AGE_MONTHS = 24         // competitor > 24 mesi → vantaggio freschezza

function calcVerdict(
  candidate: TargetCandidate,
  monthsToParityStatic: number,
): TargetVerdict {
  if (!candidate.dataComplete) return 'DA_VALUTARE'
  if (candidate.attackability === 'NON_ATTACCABILE' || candidate.attackability === 'NON_PROMOSSO') {
    return 'NON_ATTACCABILE'
  }
  if (candidate.quadrant === 'FACILE_BASSA_RESA') return 'BATTIBILE_MA_BASSA_RESA'
  if (monthsToParityStatic <= PARITY_COMFORTABLE) return 'BERSAGLIO_VALIDO'
  if (monthsToParityStatic <= PARITY_CHALLENGE) return 'BATTIBILE_MA_SFIDA'
  return 'DA_VALUTARE'
}

function verdictReason(
  verdict: TargetVerdict,
  candidate: TargetCandidate,
  monthsToParityStatic: number,
  isAccelerating: boolean,
): string {
  switch (verdict) {
    case 'BERSAGLIO_VALIDO':
      return `Competitor attaccabile: ${candidate.reviewCount} recensioni, raggiungibili in ~${Math.round(monthsToParityStatic)} mesi.${isAccelerating ? ' Attenzione: sta accelerando.' : ''}`
    case 'BATTIBILE_MA_SFIDA':
      return `Battibile ma richiede ${Math.round(monthsToParityStatic)} mesi per raggiungere la parità di recensioni — pianifica ads e ARC.`
    case 'BATTIBILE_MA_BASSA_RESA':
      return `Competitor attaccabile ma la nicchia genera ricavi bassi (${candidate.currency}${candidate.estMonthlyRevenueMin.toFixed(0)}–${candidate.estMonthlyRevenueMax.toFixed(0)}/mese).`
    case 'NON_ATTACCABILE':
      return `Troppo difeso: ${candidate.reviewCount} recensioni, attackability ${candidate.attackability}.`
    case 'DA_VALUTARE':
      return !candidate.dataComplete
        ? 'Dati insufficienti per valutare il competitor (BSR o data di pubblicazione mancanti).'
        : `Parità stimata in oltre ${PARITY_CHALLENGE} mesi — considera una keyword alternativa.`
  }
}

export function calcTargetViability(
  candidate: TargetCandidate,
  nicheReviewVelocity: number,
  weaknesses: TargetWeakness[],
  recentReviewVelocity: number | null,
  userReviewVelocity: number = DEFAULT_USER_REVIEW_VELOCITY,
  arcReviews: number = 0,
): TargetViability {
  const reviewsToParity = Math.max(0, candidate.reviewCount - arcReviews)

  const uvr = userReviewVelocity > 0 ? userReviewVelocity : DEFAULT_USER_REVIEW_VELOCITY
  const monthsToParityStatic = uvr > 0 ? reviewsToParity / uvr : 999

  const targetVelocity = recentReviewVelocity ?? nicheReviewVelocity
  const netCatchUp = uvr - targetVelocity
  const monthsToParityMoving = netCatchUp > 0 ? reviewsToParity / netCatchUp : 999

  const freshnessAdvantage = candidate.ageMonths !== null && candidate.ageMonths > FRESHNESS_AGE_MONTHS
  const isAccelerating = recentReviewVelocity !== null
    ? recentReviewVelocity > nicheReviewVelocity
    : false
  const exploitableWeaknesses = weaknesses.some(w => w.gravita === 'ALTA' || w.gravita === 'MEDIA')

  const verdict = calcVerdict(candidate, monthsToParityStatic)

  return {
    asin: candidate.asin,
    title: candidate.title,
    imageUrl: candidate.imageUrl,
    quadrant: candidate.quadrant,
    attackability: candidate.attackability,
    sellsScore: candidate.sellsScore,
    defenseScore: candidate.defenseScore,
    estMonthlyRevenueMin: candidate.estMonthlyRevenueMin,
    estMonthlyRevenueMax: candidate.estMonthlyRevenueMax,
    reviewCount: candidate.reviewCount,
    ageMonths: candidate.ageMonths,
    rating: candidate.rating,
    freshnessAdvantage,
    reviewsToParity,
    monthsToParityStatic: Math.round(monthsToParityStatic * 10) / 10,
    monthsToParityMoving: Math.round(monthsToParityMoving * 10) / 10,
    recentReviewVelocity,
    isAccelerating,
    promotionFactors: {
      ...candidate.promotionFactors,
      exploitableWeaknesses,
    },
    assumptions: {
      userReviewVelocity: uvr,
      arcReviews,
    },
    weaknesses,
    verdict,
    verdictReason: verdictReason(verdict, candidate, monthsToParityStatic, isAccelerating),
  }
}
