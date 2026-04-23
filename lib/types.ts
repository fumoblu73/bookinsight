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
}

export interface BookReviews {
  asin: string
  bookTitle: string
  reviews: AmazonReview[]
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
