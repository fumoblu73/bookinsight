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
  staleData?: boolean        // true se i dati provengono da cache stale (fallback dopo fallimento SerpApi)
  availability?: 'full' | 'partial' | 'none'  // granularità: full=timeline+related, partial=solo related, none=nulla
}

// ─── Reddit ───────────────────────────────────────────────────────────────────

export interface RedditComment {
  id: string
  body: string
  score: number
  author: string
  createdUtc: number
  month: string   // YYYY-MM per metadata stagionalità
  provenance?: SocialCommentProvenance
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
  insufficientCorpus: boolean   // avviso legacy di copertura limitata; NON è un gate AI
  corpusQuality?: RedditCorpusQuality // opzionale per dati/report precedenti alla 9.0.1
  collectionDiagnostics?: RedditCollectionDiagnostics
}

export interface RedditSearchDiagnostic {
  query: string
  kind: 'original' | 'expanded'
  status: 'ok' | 'provider_error' | 'transport_error' | 'invalid_response'
  organicResults: number
  redditLinks: number
  recognizedThreads: number
  httpStatus?: number
}

export type RedditFetchOutcome = 'success' | 'empty_dataset' | 'http_error' | 'timeout' | 'network_error' | 'invalid_payload'

export interface RedditRawSchema {
  itemCount: number
  posts: number
  comments: number
  unrecognizedItems: number
  postFields: string[]
  commentFields: string[]
  commentFieldPresence: Record<string, number>
  authorObjectFields: string[]
}

export interface RedditFetchAttempt {
  url: string
  attempt: 1 | 2
  outcome: RedditFetchOutcome
  durationMs: number
  httpStatus?: number
  runId?: string
  datasetId?: string
  retryAfterMs?: number
  schema?: RedditRawSchema
}

export interface RedditCollectionDiagnostics {
  version: '9.0.2'
  status: 'complete' | 'partial' | 'failed' | 'not_run'
  queries: RedditSearchDiagnostic[]
  candidateUrls: number
  selectedUrls: string[]
  attempts: RedditFetchAttempt[]
  recoveredUrls: string[]
  unavailableUrls: string[]
  unattemptedUrls: string[]
  skippedRetries: string[]
  budgetExhausted: boolean
  stopReason?: 'credentials_missing' | 'no_candidates' | 'search_failed' | 'provider_rejected'
  mapping?: {
    rawPosts: number
    rawComments: number
    missingPostId: number
    removed: number
    boilerplate: number
    orphanComments: number
    unselectedPostComments: number
    overThreadLimit: number
    keptComments: number
  }
}

export interface RedditCorpusQuality {
  usable: boolean
  coverage: 'none' | 'limited' | 'diversified'
  collectedCommentCount?: number // commenti presenti nel payload, prima del filtro locale
  usableCommentCount: number
  usableThreadCount: number
  transmittedCommentCount?: number // dopo deduplica, filtro e limiti del prompt
  transmittedThreadCount?: number
  subredditCount: number // subreddit dei thread effettivamente trasmessi
  limitations: Array<'no_usable_comments' | 'few_comments' | 'few_threads' | 'few_subreddits'>
}

export type RedditMeta = Pick<RedditData,
  'available' | 'insufficientCorpus' | 'threadCount' | 'subredditsUsed' | 'corpusQuality' | 'collectionDiagnostics'>

// ─── YouTube ──────────────────────────────────────────────────────────────────

export interface YouTubeComment {
  id: string
  text: string
  likeCount: number
  publishedAt: string  // ISO date
  provenance?: SocialCommentProvenance
}

// Metadati aggiuntivi: non partecipano a filtri, ranking o scoring.
export interface SocialCommentProvenance {
  originalId?: string
  idStatus: 'original' | 'synthetic' | 'missing'
  containerId?: string
  parentId?: string
  authorId?: string
  authorName?: string
  commentUrl?: string
}

export type SocialPlatform = 'reddit' | 'youtube'

export interface SocialContext {
  contextId: string
  platform: SocialPlatform
  containerId?: string
  title: string
  transmittedText: string
  sourceUrl?: string
  sourceUrlOrigin?: 'received' | 'reconstructed'
}

export interface SocialRecord {
  recordId: string
  platform: SocialPlatform
  contextId: string
  containerId?: string
  sourceCommentId?: string
  identityStatus: 'original' | 'synthetic' | 'missing' | 'conflict'
  authorKey?: string
  authorIdentityType: 'account_id' | 'username' | 'unknown'
  authorStatus: 'identified' | 'deleted' | 'unknown'
  parentId?: string
  parentRecordId?: string
  commentUrl?: string
  commentUrlOrigin?: 'received' | 'reconstructed'
  publishedAt?: string
  text: string
  transmittedText: string
  truncated: boolean
  duplicateOf?: string
  possibleCopy: boolean
}

export interface SocialCorpusManifest {
  version: '9.0.2'
  contexts: SocialContext[]
  records: SocialRecord[]
}

export interface SocialAssociation {
  painPointId: string
  recordId: string
  supportType: 'direct' | 'confirmation'
  quote: string
  contextRecordIds: string[]
}

export interface SocialMetrics {
  U: number | null
  T: number | null
  M: number | null
  status: 'complete' | 'partial' | 'failed' | 'not_run'
  completeness: { U: boolean; T: boolean; M: boolean }
  unknownAuthorMentions: number
  uncertainIdentityMentions: number
  ambiguousConfirmations: number
  rejectedAssociations: number
  reviewedComments: number
  totalComments: number
  uncertainComments?: number
}

export interface SocialVerificationDecision {
  recordId: string
  painPointId: string
  verdict: 'supported' | 'unsupported' | 'unclear'
  reason: 'explicit_problem' | 'explicit_need' | 'resolved_problem' | 'linked_confirmation' | 'topic_only' | 'contradiction' | 'insufficient_evidence' | 'ambiguous_referent' | 'out_of_topic' | 'unclear_topic' | 'scope_mismatch'
  problemQuote?: string
  problemExpressed?: 'yes' | 'no' | 'unclear'
  referentIdentified?: 'yes' | 'no' | 'unclear'
  topicRelevance?: 'yes' | 'no' | 'unclear'
  scopeMatched?: 'yes' | 'no' | 'unclear'
  evidenceKind?: 'stated_problem' | 'stated_need' | 'resolved_problem' | 'neutral_description' | 'hypothesis' | 'unclear'
  quoteAdjusted?: boolean
}

export interface SocialDiagnostic {
  contextId: string
  stage: 'extraction' | 'verification'
  attempt: 1 | 2
  recordIds: string[]
  painPointId?: string
  reason: 'missing_decisions' | 'missing_record' | 'duplicate_record' | 'invalid_matches' | 'unknown_pain' | 'invalid_quote' | 'invalid_support' | 'invalid_context' | 'unexpected_record' | 'missing_verification' | 'invalid_verification' | 'request_error' | 'quote_typography_aligned'
}

export interface SocialEvidenceReport {
  version: '9.0.2'
  manifest: SocialCorpusManifest
  associations: SocialAssociation[]
  metrics: Record<string, SocialMetrics>
  reviewedRecordIds?: Record<string, string[]>
  uncertainRecordIds?: Record<string, string[]>
  unresolvedRecordIds?: Record<string, string[]>
  verification?: { version: 'problem-support-v1' | 'problem-support-v2' | 'topic-problem-support-v3' | 'topic-problem-support-v4'; topic?: string; decisions: SocialVerificationDecision[] }
  processing?: {
    budgetExhausted: boolean
    attemptedRecordIds: string[]
    unstartedRecordIds: string[]
    failures: { contextId: string; stage: 'extraction' | 'verification'; reason: string; status?: number }[]
    diagnostics?: SocialDiagnostic[]
    records?: { recordId: string; status: 'valid' | 'invalid' | 'not_run'; attempts: number; reason?: SocialDiagnostic['reason'] }[]
  }
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

export const SOLVIBILITA_VALUES = ['affrontabile', 'vincolo_formato', 'mai_fatto', 'fuori_portata'] as const
export type Solvibilita = typeof SOLVIBILITA_VALUES[number]

export interface PainPoint {
  id?: string            // identificatore stabile per selezione utente (curated mode)
  pain_point: string
  F: number
  I: number
  solvibilita: Solvibilita
  requisito_forma?: string   // valorizzato solo se solvibilita === 'vincolo_formato'
  score: number          // calcolato nel codice: F*0.67 + I*0.33 (la solvibilità NON entra nella formula)
  evidence: string
  fonte: 'reddit' | 'recensione_negativa' | 'recensione_positiva' | 'youtube'
  redditCorpusQuality?: RedditCorpusQuality // contesto del campione, non componente dello score
  tipo?: 'gap_esecuzione' | 'job_confermato'
  linguaggio?: string    // solo per job_confermato
  criticalSignal?: boolean  // override: Intensità >= 9

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
  degradedFrom?: InvestVerdict    // verdetto numerico originale, se è stato degradato dalla regola contestuale
  degradeReason?: string          // motivo testuale del degrade (es. "score<50 + DIFFICILE")

  warnings: string[]
}

// ─── Things to Avoid ─────────────────────────────────────────────────────────

export interface ThingToAvoid {
  id: string
  titolo: string
  descrizione: string
  categoria: 'pricing' | 'positioning' | 'cover_design' | 'content' |
             'format' | 'marketing' | 'differentiation' | 'review_velocity'
  evidence: string
  severita: 'critica' | 'alta' | 'media'
}

// ─── Pivot Signals ────────────────────────────────────────────────────────────

export interface PivotSignal {
  id: string
  titolo: string
  descrizione: string
  threshold: string
  metrica: 'bsr' | 'review_velocity' | 'conversion_rate' | 'organic_ranking' |
           'ads_acos' | 'competitor_entry' | 'review_rating' | 'sales_velocity' | 'other'
  timing: 'pre_launch' | 'launch_30d' | 'launch_60d' | 'launch_90d' | 'ongoing'
  azione_consigliata: string
  severita: 'critica' | 'alta' | 'media'
}

// ─── Concept Directions ───────────────────────────────────────────────────────

export interface ConceptDirection {
  id: string
  titolo_concetto: string
  sotto_segmento: string
  pain_points_origine: string[]
  angolo: string
  why_could_work: string
  main_risk: string
  differenziatori_chiave: string[]
  difficolta_esecuzione: 'BASSA' | 'MEDIA' | 'ALTA'
  evidenza_score: number
  evidenza_motivo: string
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
  analyzesAvailable: number
  targetFinderAvailable: number
  // Apify — retrocompatibilità
  apifyBalanceUsd: number
  apifyAvailable: boolean
  // Apify — sistema a 3 stati
  apifyState: 'ok' | 'overage' | 'capped' | 'unknown'
  apifyPrepaidUsd: number
  apifyCapUsd: number
  apifyUsedUsd: number
  apifyOverageUsd: number
  apifyMarginToCapUsd: number
}
