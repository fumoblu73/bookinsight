// ─── Amazon / Apify ───────────────────────────────────────────────────────────

export type Market = 'US' | 'UK' | 'DE' | 'IT' | 'ES' | 'FR'

export interface RawBook {
  asin: string
  title: string
  subtitle?: string
  bsr: number
  bsrTimestamp: string
  price: number
  currency: string
  reviewCount: number
  rating: number
  publishedDate?: string
  pages?: number
  publisher?: string
  selfPublished: boolean
  sponsored: boolean
  format?: string
  imageUrl?: string   // thumbnail da SerpApi
}

export interface FilteredBook extends RawBook {
  royalty: number
  estimatedDailySalesMin: number
  estimatedDailySalesMax: number
  pagesEstimated: boolean
}

export interface SubNiche {
  keyword: string
  bsr: number
  reviewCount: number
  vulnerable: boolean
}

export interface AmazonReview {
  rating: number
  title: string
  body: string
  date?: string        // data recensione normalizzata (ISO o stringa SerpApi)
}

export interface BookReviews {
  asin: string
  bookTitle: string
  reviews: AmazonReview[]
}

export interface RoiPerformanceTarget {
  label: 'breakeven' | 'roi_50' | 'roi_100'
  multiplier: number
}

export interface RoiPerformanceByFixedPrice extends RoiPerformanceTarget {
  monthlySalesNeeded: number
  vsCompetitorAvg: number
  monthsToBreakeven: number
}

export interface RoiPerformanceByFixedSales extends RoiPerformanceTarget {
  royaltyNetMinPerSale: number
  minBookPrice: number
  monthsToBreakeven: number
}

export interface RoiPerformance {
  available: boolean
  monthlyAdBudget: number
  competitorAvgMonthlySales: number
  budgetProduzione: number
  bookPriceUsed: number
  bookPagesUsed: number
  royaltyNetPerSale: number
  byFixedPrice: RoiPerformanceByFixedPrice[]
  byFixedSales: RoiPerformanceByFixedSales[]
}

export interface AdsIntelligence {
  available: boolean
  recommendedMonthlyAdBudget: number
  competitorMonthlyRevenueAvg: number
  competitorMonthlyRevenueRange: { min: number; max: number }
  competitorCount: number
  weakSampleWarning: boolean
  currency: string
  roi_performance?: RoiPerformance
}

export interface AmazonData {
  market: Market
  keyword: string
  topBooks: FilteredBook[]       // max 5, post-filtri, ordinati per BSR
  rawTop15: RawBook[]            // top 15 grezzi per sub-niche detection
  subNiches: SubNiche[]
  competitorTarget: FilteredBook
  scrapedAt: string
  topBookReviews?: BookReviews[] // recensioni testuali top 2 competitor
  ads_intelligence: AdsIntelligence
}

// ─── Google Trends ────────────────────────────────────────────────────────────

export interface TrendsDataPoint {
  date: string   // YYYY-MM
  value: number  // 0-100
}

export interface RelatedQuery {
  query: string
  value: number        // interesse relativo 0-100
  growthYoY: number    // % crescita anno su anno
  isEmerging: boolean  // true se value < 10 ma growthYoY >= 50%
}

export interface TrendsData {
  keyword: string
  timelineData: TrendsDataPoint[]
  relatedQueries: RelatedQuery[]
  yoyGrowth: number          // % variazione ultimo anno vs anno precedente
  available: boolean         // false se API ha fallito (fallback attivo)
  peakMonth: string | null   // nome mese con interesse medio più alto (es. "Dicembre")
}

// ─── Reddit ───────────────────────────────────────────────────────────────────

export interface RedditComment {
  id: string
  body: string
  score: number
  author: string
  createdUtc: number
  month: string   // YYYY-MM per metadata stagionalità
}

export interface RedditPost {
  id: string
  title: string
  selftext: string
  score: number
  subreddit: string
  createdUtc: number
  month: string
  comments: RedditComment[]
  link?: string   // URL originale Google result
}

export interface RedditData {
  keyword: string
  posts: RedditPost[]
  totalComments: number
  subredditsUsed: string[]
  threadCount: number
  available: boolean
  insufficientCorpus: boolean   // true se < 20 commenti
}

// ─── YouTube ──────────────────────────────────────────────────────────────────

export interface YouTubeComment {
  id: string
  text: string
  likeCount: number
  publishedAt: string  // ISO date
}

export interface YouTubeVideo {
  id: string
  title: string
  viewCount: number
  comments: YouTubeComment[]
}

export interface YouTubeData {
  keyword: string
  videos: YouTubeVideo[]
  totalComments: number
  available: boolean
  insufficientCorpus: boolean  // true se < 10 commenti filtrati
}

// ─── Pain Point (output Haiku) ────────────────────────────────────────────────

export interface PainPoint {
  id?: string            // identificatore stabile per selezione utente (curated mode)
  pain_point: string
  F: number
  I: number
  S: number
  score: number          // calcolato nel codice: F*0.2 + I*0.4 + S*0.4
  evidence: string
  fonte: 'reddit' | 'recensione_negativa' | 'recensione_positiva' | 'youtube'
  tipo?: 'gap_esecuzione' | 'job_confermato'
  linguaggio?: string    // solo per job_confermato
  criticalSignal?: boolean  // override: Intensità >= 9
  vocalMinority?: boolean
  vocalMinoritySuspect?: boolean
  weakSignal?: boolean   // fonte singola

  // Voice-of-customer — per copywriting del libro
  evidence_quotes?: string[]
  voice_phrases?: string[]
  emotional_register?: 'frustrazione' | 'rabbia' | 'ansia' | 'rassegnazione' | 'desiderio' | 'confusione' | 'orgoglio' | 'neutro'
  context?: string
}

// ─── Data Quality ─────────────────────────────────────────────────────────────

export interface DataQuality {
  bsrFromSnapshot: true
  trendsDataAvailable: boolean
  redditThreadsCount: number
  reviewsAvailable: boolean
  passo0Confidence: 'ALTA' | 'MEDIA' | 'BASSA' | null
}

// ─── Report Status (Redis) ────────────────────────────────────────────────────

export type ReportStatus =
  | 'complete'
  | 'partial_gap'
  | 'partial_trends'
  | 'partial_reddit'
  | 'failed'

export interface ReportRecord {
  id: string
  keyword: string
  market: Market
  createdAt: string
  status: ReportStatus
  profitabilityScore?: number
  estimatedDailyRevenue?: number
  competitionLevel?: string
  data?: unknown       // full report JSON
  log?: AnalysisLog    // pipeline execution log
  ads_intelligence?: AdsIntelligence
}

// ─── Analysis Log ─────────────────────────────────────────────────────────────

export interface LogEntry {
  step: string
  label: string
  status: 'ok' | 'warn' | 'error'
  summary: string
  details: Record<string, unknown>
  durationMs?: number   // tempo di esecuzione dello step
  error?: string        // messaggio di errore se status === 'error'
}

export interface AnalysisLog {
  entries: LogEntry[]
  startedAt: string
  completedAt: string
}

// ─── Credits ──────────────────────────────────────────────────────────────────

// ─── Target Finder ────────────────────────────────────────────────────────────

export type TargetQuadrant =
  | 'IDEALE'
  | 'TROPPO_DURO'
  | 'FACILE_BASSA_RESA'
  | 'ANOMALO'
  | 'NON_ATTACCABILE'
  | 'DATI_INSUFFICIENTI'

export type Attackability =
  | 'ATTACCABILE'
  | 'ATTACCABILE_SE_PROMOSSO'
  | 'NON_PROMOSSO'
  | 'NON_ATTACCABILE'

export interface TargetCandidate {
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
  ageMonths: number | null
  selfPublished: boolean
  estMonthlySalesMin: number
  estMonthlySalesMax: number
  estMonthlyRevenueMin: number
  estMonthlyRevenueMax: number
  attackability: Attackability
  monthsToParity: number
  promotionFactors: {
    lowReviewVelocity: boolean
    weakRating: boolean
    ratingVeto: boolean
  }
  sellsScore: number
  defenseScore: number
  attractiveness: number
  quadrant: TargetQuadrant
  dataComplete: boolean
  outOfBsrRange: boolean
  exclusionReason?: string
}

export interface TargetFinderResult {
  keyword: string
  market: Market
  scrapedAt: string
  candidates: TargetCandidate[]
  suggested: TargetCandidate[]
  nicheReviewVelocity: number
  medians: { revenue: number; defense: number }
  warning?: string
  unknownFormatCount?: number  // libri scartati per formato non identificabile (possibili hardcover o dati incompleti)
}

export interface TargetInterpretationSummary {
  totalCandidates: number
  attackableCount: number
  suggestedCount: number
  quadrantCounts: {
    IDEALE: number
    TROPPO_DURO: number
    FACILE_BASSA_RESA: number
    ANOMALO: number
  }
  nonAttackableCount: number
  nonAttackableReasons: {
    over150Reviews: number
    nonPromosso: number
  }
  excludedFromQuadrantsCount: number
  excludedReasons: {
    bsrZero: number
    outOfBsrRange: number
    ageUnknown: number
  }
  unknownFormatCount: number
  nicheReviewVelocity: number
  warnings: string[]
}

export interface TargetWeakness {
  difetto: string
  gravita: 'ALTA' | 'MEDIA' | 'BASSA'
  frequenza: number
  evidence: string
}

export type TargetVerdict =
  | 'BERSAGLIO_VALIDO'
  | 'BATTIBILE_MA_SFIDA'
  | 'BATTIBILE_MA_BASSA_RESA'
  | 'NON_ATTACCABILE'
  | 'DA_VALUTARE'

export interface TargetViability {
  asin: string
  title: string
  imageUrl?: string
  quadrant: TargetQuadrant
  attackability: Attackability
  sellsScore: number
  defenseScore: number
  estMonthlyRevenueMin: number
  estMonthlyRevenueMax: number
  reviewCount: number
  ageMonths: number | null
  rating: number
  freshnessAdvantage: boolean
  reviewsToParity: number
  monthsToParityStatic: number
  monthsToParityMoving: number
  recentReviewVelocity: number | null
  isAccelerating: boolean
  promotionFactors: {
    lowReviewVelocity: boolean
    weakRating: boolean
    exploitableWeaknesses: boolean
    ratingVeto: boolean
  }
  assumptions: {
    userReviewVelocity: number
    arcReviews: number
  }
  weaknesses: TargetWeakness[]
  verdict: TargetVerdict
  verdictReason: string
}

// ─── ROI Re-anchor ────────────────────────────────────────────────────────────

export type RoasSignal = 'VERDE' | 'GIALLO' | 'ROSSO'
export type InvestVerdict = 'INVEST' | 'PARTIAL' | 'PASS'

export interface RoiScenario {
  label: 'pessimistico' | 'base' | 'ottimistico'
  captureFraction: number
  monthlyRevenue: number[]         // 12 valori, ricavi lordi mese per mese
  monthlyAdCost: number[]          // 12 valori, costo ads mese per mese
  netProfit12m: number
  breakEvenMonths: number          // 999 se mai raggiunto entro 12 mesi
  ratioVsBudget: number
}

export interface RoiEstimate {
  anchoredOnTarget: boolean
  targetAsin?: string
  targetDailySalesMin: number
  targetDailySalesMax: number
  newBookRoyalty: number
  rampMonths: number

  params: {
    cpc: number
    conversionRate: number
    plannedPrice: number
    plannedPages: number
    costoScrittura: number
    costoCopertina: number
    costoPerRecensione: number
    arcReviews: number
    budgetProduzione: number
  }

  scenarios: RoiScenario[]         // [pessimistico, base, ottimistico]

  costPerAdSale: number
  adSaleIsProfitable: boolean
  bepSignal: RoasSignal
  investVerdict: InvestVerdict

  warnings: string[]
}

// ─── Bonus Suggestions ────────────────────────────────────────────────────────

export interface BonusSuggestion {
  id: string
  titolo: string
  tipo: 'workbook' | 'checklist' | 'cheat_sheet' | 'template' |
        'mini_corso_video' | 'community' | 'quiz' | 'audio_companion' |
        'risorse_esterne' | 'planner'
  pain_points_origine: string[]
  segnale_fonte: 'recensione' | 'reddit' | 'youtube' | 'gap_analysis' | 'misto'
  evidence_quote?: string
  razionale: string
  come_realizzarlo: string
  come_presentarlo: string
  efficacia_score: number
  efficacia_motivo: string
}

// ─── Credits ──────────────────────────────────────────────────────────────────

export interface CreditsData {
  // SerpApi account fields
  total_searches_left: number
  plan_searches_left: number
  searches_per_month: number
  plan_name: string
  account_email: string
  available: boolean
  cached: boolean
  cached_at?: string
  // Derived — due contatori distinti per flusso
  analyzesAvailable: number        // flusso /analyze (solo SerpApi): floor(total / ANALYZE_COST)
  targetFinderAvailable: number    // flusso /api/target + viability (SerpApi + Apify): min(serp, apify)
  apifyBalanceUsd: number
  apifyAvailable: boolean
}
