import { RawBook, FilteredBook, SubNiche, AmazonData, Market, AmazonReview, BookReviews, AdsIntelligence } from './types'

// ─── Costanti ─────────────────────────────────────────────────────────────────

export const MARKET_CURRENCY: Record<Market, string> = {
  US: 'USD', UK: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR',
}

const MARKET_AMAZON_DOMAIN: Record<Market, string> = {
  US: 'amazon.com',
  UK: 'amazon.co.uk',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
}

export function amazonProductUrl(asin: string, market: Market): string {
  return `https://www.${MARKET_AMAZON_DOMAIN[market]}/dp/${asin}`
}

const MARKET_BOOKS_CATEGORY: Record<Market, string> = {
  US: '283155',
  UK: '266239',
  DE: '186606',
  FR: '301130',
  IT: '411663031',
  ES: '599364031',
}

// SerpApi book-format refinement filter for paperback, combined with the Books category node
// via the `rh` parameter (rh=n:{categoryId},{filterValue}).
// Values retrieved live from SerpApi filters.book_format response — 2025-05-21.
// DO NOT move category_id back as a separate param: combining rh+category_id causes
// unpredictable behavior (verified empirically).
const MARKET_PAPERBACK_FILTER: Record<Market, string> = {
  // US uses p_n_feature_browse-bin — NOT p_n_binding_browse-bin like the other markets.
  // Verified empirically: NOT a typo. Using p_n_binding_browse-bin on US returns 0 results.
  US: 'p_n_feature_browse-bin:2656022011',
  UK: 'p_n_binding_browse-bin:492564011',
  DE: 'p_n_binding_browse-bin:492559011',   // Taschenbuch
  // FR: "Couverture brochée" only — "Poche" (492481011) excluded: different sub-market
  // (mass-market fiction, low-price novels), not aligned with KDP non-fiction books.
  FR: 'p_n_binding_browse-bin:3973586031',  // Couverture brochée
  IT: 'p_n_binding_browse-bin:509802031',   // Copertina flessibile
  ES: 'p_n_binding_browse-bin:831435031',   // Tapa blanda
}

const KDP_PRINT_COST: Record<Market, { fixed: number; perPage: number }> = {
  US: { fixed: 1.00, perPage: 0.012 },
  UK: { fixed: 0.85, perPage: 0.010 },
  DE: { fixed: 0.75, perPage: 0.012 },
  FR: { fixed: 0.75, perPage: 0.012 },
  IT: { fixed: 0.75, perPage: 0.012 },
  ES: { fixed: 0.75, perPage: 0.012 },
}

// Soglia royalty KDP giugno 2025: 60% se prezzo >= soglia, 50% sotto
const ROYALTY_THRESHOLD: Record<Market, number> = {
  US: 9.99, UK: 9.99, DE: 9.99, FR: 9.99, IT: 9.99, ES: 9.99,
}

const VULNERABILITY_THRESHOLD = 100

const BOOK_FORMATS = new Set([
  'Paperback', 'Hardcover', 'Kindle Edition', 'Mass Market Paperback',
  'Spiral-bound', 'Board book', 'Library Binding', 'Loose Leaf',
  'Perfect Paperback', 'Illustrated', 'Pocket Book', 'Audio CD',
  'Broché', 'Relié', 'Taschenbuch', 'Gebundene Ausgabe',
  'Tapa blanda', 'Tapa dura', 'Copertina flessibile', 'Copertina rigida',
])

// Only paperback format names — used as safety net in applyFilters after the SerpApi filter.
// item_form is never returned by SerpApi amazon_product (verified empirically 2025-05-21):
// format is derived from best_sellers_rank categories instead, so values here should match
// what fetchProductDetails assigns when it detects a physical (non-Kindle) book.
const PAPERBACK_FORMATS = new Set([
  'Paperback', 'Mass Market Paperback', 'Perfect Paperback', 'Pocket Book',
  'Broché',               // FR
  'Taschenbuch',          // DE
  'Broschiert',           // DE (brossura, sottotipo paperback)
  'Tapa blanda',          // ES
  'Copertina flessibile', // IT
])
const MIN_AGE_DAYS = 30
export const MAX_BOOKS = 5
export const MAX_PRODUCT_CALLS = 8  // cap product calls per contenere i crediti SerpApi nel free tier
export const MAX_BOOKS_FOR_ADS = 10
// Soglia "libro attivamente in vendita" nel mercato paperback.
// Oltre BSR 80k un libro vende ~1 copia ogni 3-5 giorni: includerlo
// nella media revenue inquina il dato e non rappresenta un competitor
// pubblicitariamente comparabile.
export const MAX_BSR_FOR_ADS = 80_000
export const AD_BUDGET_RULE_PERCENT = 0.30
// Con il filtro BSR < 80k il pool è più stretto: 3 competitor eleggibili
// sono sufficienti per una media non degenere. Sotto 3, il dato è troppo
// fragile e va segnalato.
export const WEAK_SAMPLE_THRESHOLD = 3

function calculateAdsIntelligence(books: FilteredBook[], market: Market): AdsIntelligence {
  const eligible = books.filter(b =>
    b.bsr > 0 &&
    b.bsr < MAX_BSR_FOR_ADS &&
    b.estimatedDailySalesMin > 0 &&
    b.estimatedDailySalesMax > 0
  ).slice(0, MAX_BOOKS_FOR_ADS)

  const competitorCount = eligible.length
  const currency = MARKET_CURRENCY[market]

  if (competitorCount === 0) {
    return {
      available: false,
      recommendedMonthlyAdBudget: 0,
      competitorMonthlyRevenueAvg: 0,
      competitorMonthlyRevenueRange: { min: 0, max: 0 },
      competitorCount: 0,
      weakSampleWarning: false,
      currency,
    }
  }

  const monthlyRevenues = eligible.map(b => {
    const avgDailySales = (b.estimatedDailySalesMin + b.estimatedDailySalesMax) / 2
    return avgDailySales * b.price * 30
  })

  const competitorMonthlyRevenueAvg = monthlyRevenues.reduce((s, r) => s + r, 0) / competitorCount
  const recommendedMonthlyAdBudget = competitorMonthlyRevenueAvg * AD_BUDGET_RULE_PERCENT
  const min = Math.min(...monthlyRevenues)
  const max = Math.max(...monthlyRevenues)

  return {
    available: true,
    recommendedMonthlyAdBudget: Math.round(recommendedMonthlyAdBudget * 100) / 100,
    competitorMonthlyRevenueAvg: Math.round(competitorMonthlyRevenueAvg * 100) / 100,
    competitorMonthlyRevenueRange: { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 },
    competitorCount,
    weakSampleWarning: competitorCount < WEAK_SAMPLE_THRESHOLD,
    currency,
  }
}

// ─── SerpApi fetch ────────────────────────────────────────────────────────────

async function serpApiFetch(params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.SERPAPI_KEY
  if (!apiKey) throw new Error('SERPAPI_KEY non configurata')

  const qs = new URLSearchParams({ ...params, api_key: apiKey }).toString()
  const url = `https://serpapi.com/search?${qs}`

  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`SerpApi error ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

// ─── Step 1: SERP Amazon ──────────────────────────────────────────────────────

interface SerpBook {
  asin: string
  title: string
  price: number
  reviewCount: number
  rating: number
  sponsored: boolean
  imageUrl?: string
}

async function fetchSerpData(keyword: string, market: Market): Promise<SerpBook[]> {
  const domain = MARKET_AMAZON_DOMAIN[market]

  // Combine Books category node + paperback binding filter in a single `rh` param.
  // category_id is NOT passed separately: mixing rh + category_id yields unpredictable results.
  const rh = `n:${MARKET_BOOKS_CATEGORY[market]},${MARKET_PAPERBACK_FILTER[market]}`

  // SerpApi Amazon engine uses `k` (not `q`) for the search keyword
  const data = await serpApiFetch({
    engine: 'amazon',
    k: keyword,
    amazon_domain: domain,
    rh,
  }) as {
    organic_results?: Array<{
      asin?: string
      title?: string
      extracted_price?: number
      price?: string
      rating?: number
      reviews?: number | string
      sponsored?: boolean
      thumbnail?: string
    }>
    sponsored_results?: Array<{ asin?: string }>
    error?: string
  }

  if (data.error) throw new Error(`SerpApi: ${data.error}`)

  const sponsoredAsins = new Set(
    (data.sponsored_results ?? []).map(r => r.asin).filter(Boolean)
  )

  const results: SerpBook[] = []

  for (const item of data.organic_results ?? []) {
    const asin = item.asin ?? ''
    if (!asin || asin.length !== 10) continue

    const title = item.title ?? ''
    if (!title) continue

    const sponsored = item.sponsored === true || sponsoredAsins.has(asin)

    // extracted_price is already a number; fall back to parsing price string
    const price = item.extracted_price
      ?? (parseFloat((item.price ?? '').replace(/[^0-9.]/g, '')) || 0)

    const reviewCount = typeof item.reviews === 'number'
      ? item.reviews
      : parseInt(String(item.reviews ?? '0').replace(/[^0-9]/g, '')) || 0

    const rating = item.rating ?? 0
    const imageUrl = item.thumbnail

    results.push({ asin, title, price, reviewCount, rating, sponsored, imageUrl })
  }

  return results.slice(0, 15)
}

// ─── Step 2: Product detail via SerpApi ──────────────────────────────────────

interface ProductDetails {
  bsr: number
  pages: number
  publisher: string
  publishedDate: string
  selfPublished: boolean
  format: string
}

interface SerpBsrEntry {
  extracted_rank?: number
  rank?: string | number
  link_text?: string
  text?: string
}

interface SerpProductDetails {
  publisher?: string
  publication_date?: string
  print_length?: string
  item_form?: string
  best_sellers_rank?: SerpBsrEntry[]
}

async function fetchProductDetails(asin: string, market: Market): Promise<ProductDetails> {
  const domain = MARKET_AMAZON_DOMAIN[market]

  try {
    const data = await serpApiFetch({
      engine: 'amazon_product',
      asin,
      amazon_domain: domain,
    }) as {
      product_details?: SerpProductDetails
      error?: string
    }

    if (data.error) return defaultProductDetails()

    const det = data.product_details ?? {}

    // item_form is never returned by SerpApi amazon_product (verified empirically 2025-05-21).
    // Derive format and BSR from best_sellers_rank categories instead.
    const ranks = det.best_sellers_rank ?? []

    // Detect Kindle: any rank entry that mentions "Kindle Store"
    const isKindle = ranks.some(r => {
      const t = String(r.link_text ?? r.text ?? '')
      return t.includes('Kindle Store')
    })
    // Detect physical book: any rank entry that mentions "Books" but not "Kindle"
    const hasBooksBsr = ranks.some(r => {
      const t = String(r.link_text ?? r.text ?? '')
      return t.includes('Books') && !t.includes('Kindle')
    })

    let format: string
    if (isKindle) {
      format = 'Kindle Edition'
    } else if (hasBooksBsr) {
      // Physical book confirmed by Books BSR + SerpApi paperback filter upstream.
      // Assigning 'Paperback' here; the PAPERBACK_FORMATS safety net in applyFilters
      // will catch any non-paperback physicals that slipped through the SerpApi filter.
      format = 'Paperback'
    } else {
      format = ''  // UNKNOWN: no BSR data — could be paperback with incomplete data or other format
    }

    // BSR — take the root "Books" category rank (link_text contains "See Top 100 in Books").
    // Fallback: largest rank among non-Kindle entries (subcategory ranks are smaller numbers).
    // Using Math.max directly was wrong for Kindle: Kindle Store rank is a large number too.
    let bsr = 0
    if (ranks.length > 0) {
      const rootEntry = ranks.find(r => {
        const t = String(r.link_text ?? r.text ?? '')
        return t.includes('See Top 100') && !t.includes('Kindle')
      })
      if (rootEntry) {
        bsr = rootEntry.extracted_rank ?? 0
      } else {
        const nonKindleNums = ranks
          .filter(r => !String(r.link_text ?? r.text ?? '').includes('Kindle'))
          .map(r => {
            if (typeof r.extracted_rank === 'number') return r.extracted_rank
            const raw = String(r.rank ?? '').replace(/[^0-9]/g, '')
            return raw ? parseInt(raw) : 0
          })
          .filter(n => n > 0)
        if (nonKindleNums.length > 0) bsr = Math.max(...nonKindleNums)
      }
    }

    // Pages: "432 pages" → 432
    const printLength = det.print_length ?? ''
    const pages = parseInt(printLength.replace(/[^0-9]/g, '')) || 0

    const publisher = (det.publisher ?? '').substring(0, 60)
    const publishedDate = (det.publication_date ?? '').substring(0, 20)

    const selfPublished =
      publisher.toLowerCase().includes('independently published') ||
      publisher.toLowerCase().includes('auto-pubblicato')

    return { bsr, pages, publisher, publishedDate, selfPublished, format }
  } catch {
    return defaultProductDetails()
  }
}

function defaultProductDetails(): ProductDetails {
  return { bsr: 0, pages: 0, publisher: '', publishedDate: '', selfPublished: false, format: '' }
}

// ─── Recensioni competitor ────────────────────────────────────────────────────

const NON_ENGLISH_MARKETS_REVIEWS = new Set<Market>(['IT', 'DE', 'FR', 'ES'])

async function fetchBookReviews(asin: string, market: Market): Promise<AmazonReview[]> {
  const domain = MARKET_AMAZON_DOMAIN[market]
  try {
    const data = await serpApiFetch({
      engine: 'amazon_product',
      asin,
      amazon_domain: domain,
    }) as {
      reviews_information?: {
        authors_reviews?: Array<{ rating?: number; title?: string; text?: string; helpful_count?: number }>
        other_countries_reviews?: Array<{ rating?: number; title?: string; text?: string; helpful_count?: number }>
      }
    }
    const ri = data.reviews_information ?? {}
    const local   = ri.authors_reviews ?? []
    const foreign = ri.other_countries_reviews ?? []

    // Per mercati non-anglofoni: preferire recensioni locali (lingua del marketplace)
    const raw = NON_ENGLISH_MARKETS_REVIEWS.has(market) && local.length >= 5
      ? local
      : [...local, ...foreign]

    return raw
      .filter(r => (r.text ?? '').length >= 50)
      .sort((a, b) => (b.helpful_count ?? 0) - (a.helpful_count ?? 0))
      .slice(0, 10)
      .map(r => ({
        rating: Number(r.rating ?? 0),
        title:  String(r.title ?? '').slice(0, 100),
        body:   String(r.text  ?? '').slice(0, 500),
      }))
  } catch (err) {
    console.error(`[amazon] fetchBookReviews failed for ${asin}:`, err)
    return []
  }
}

// ─── Calcoli economici ────────────────────────────────────────────────────────

export function calcRoyalty(price: number, pages: number, market: Market): number {
  const { fixed, perPage } = KDP_PRINT_COST[market]
  const effectivePages = pages < 24 ? 0 : pages
  const printCost = fixed + perPage * effectivePages
  const royaltyRate = price >= ROYALTY_THRESHOLD[market] ? 0.60 : 0.50
  return Math.max(0, price * royaltyRate - printCost)
}

// Fattori di scala per mercato vs US (calibrati da Kindlepreneur, novembre 2026)
const MARKET_SALES_SCALE: Record<Market, number> = {
  US: 1.000,
  UK: 0.149,
  DE: 0.161,
  FR: 0.039,
  IT: 0.039,
  ES: 0.039,
}

// Soglia di switch tra le due bande della curva US
const BSR_BAND_THRESHOLD = 30_000

// Coefficienti curva US Paperback (calibrati Kindlepreneur, errore medio 9.2%)
const US_LOW_BAND_A  =         9_038.05
const US_LOW_BAND_B  =            -0.7096
const US_HIGH_BAND_A = 225_466_650.69
const US_HIGH_BAND_B =            -1.6646

/**
 * Stima vendite giornaliere di un libro paperback dato BSR e mercato.
 *
 * Curva calibrata sui dati Kindlepreneur (formato paperback, mercato US)
 * con fit power-law a due bande:
 * - Banda bassa (BSR ≤ 30.000): A=9038, B=-0.7096
 * - Banda alta (BSR > 30.000): A=2.25e8, B=-1.6646
 *
 * Per mercati non-US, si applica il fattore di scala MARKET_SALES_SCALE,
 * calibrato sui rapporti UK/US e DE/US (5 punti, ratio stabile 13-18%)
 * e su FR/IT/ES (2 punti, ratio ~4%).
 *
 * Fonte: lookup manuale Kindlepreneur, novembre 2026.
 */
export function bsrToSales(bsr: number, market: Market): { min: number; max: number } {
  if (bsr <= 0) {
    return { min: 0, max: 0 }
  }

  // Curva US base
  let usDailySales: number
  if (bsr <= BSR_BAND_THRESHOLD) {
    usDailySales = US_LOW_BAND_A * Math.pow(bsr, US_LOW_BAND_B)
  } else {
    usDailySales = US_HIGH_BAND_A * Math.pow(bsr, US_HIGH_BAND_B)
  }

  // Applica fattore di scala per mercato
  const scaledDailySales = usDailySales * MARKET_SALES_SCALE[market]

  // Banda di incertezza ±20% — il fit ha errore medio 9.2% ma restituiamo
  // un range conservativo per riflettere l'incertezza intrinseca dello
  // snapshot BSR (singolo momento, non media nel tempo)
  return {
    min: scaledDailySales * 0.80,
    max: scaledDailySales * 1.20,
  }
}

// ─── Sub-niche detection ──────────────────────────────────────────────────────

export function detectSubNiches(raw15: RawBook[], mainKeyword: string): SubNiche[] {
  const mainWords = mainKeyword.toLowerCase().split(/\s+/)
  const seen = new Map<string, { bsr: number; reviewCount: number }>()
  const stopWords = ['book', 'guide', 'beginners', 'complete', 'easy', 'simple',
    'best', 'edition', 'volume', 'part', 'step', 'the', 'for', 'and', 'with',
    'your', 'how', 'over', 'day', 'days', 'week', 'weeks', 'minute', 'minutes']

  for (const book of raw15) {
    if (book.bsr === 0) continue
    const fullText = [book.title, book.subtitle].filter(Boolean).join(' ')
    const words = fullText.toLowerCase().split(/[\s\-–:,]+/)
    for (const word of words) {
      if (word.length < 4) continue
      if (mainWords.includes(word)) continue
      if (stopWords.includes(word)) continue
      const existing = seen.get(word)
      if (!existing || book.bsr < existing.bsr) {
        seen.set(word, { bsr: book.bsr, reviewCount: book.reviewCount })
      }
    }
  }

  return [...seen.entries()]
    .filter(([, data]) => data.bsr > 0)
    .map(([keyword, data]) => ({
      keyword,
      bsr: data.bsr,
      reviewCount: data.reviewCount,
      vulnerable: data.reviewCount < VULNERABILITY_THRESHOLD,
    }))
    .sort((a, b) => a.bsr - b.bsr)
    .slice(0, 3)
}

// ─── Filtri ───────────────────────────────────────────────────────────────────

// Returns filtered books and the count of UNKNOWN-format books that were discarded.
// Three format states:
//   PAPERBACK — format in PAPERBACK_FORMATS → keep
//   KINDLE    — format === 'Kindle Edition'  → discard silently
//   UNKNOWN   — format is empty              → discard but count (incomplete SerpApi data,
//                                              possible paperback with missing BSR)
function applyFilters(books: RawBook[]): { books: RawBook[]; unknownFormatCount: number } {
  const now = Date.now()
  let unknownFormatCount = 0

  const filtered = books.filter(b => {
    if (b.sponsored) return false
    if (b.reviewCount < 1) return false
    if (b.format === 'Kindle Edition') return false  // KINDLE → discard
    if (!b.format) {
      unknownFormatCount++
      return false                                   // UNKNOWN → discard, tracked
    }
    if (!PAPERBACK_FORMATS.has(b.format)) return false  // hardcover or other non-paperback
    if (b.publishedDate) {
      const ageMs = now - new Date(b.publishedDate).getTime()
      if (ageMs / (1000 * 60 * 60 * 24) < MIN_AGE_DAYS) return false
    }
    return true
  })

  return { books: filtered, unknownFormatCount }
}

// ─── Competitor target ────────────────────────────────────────────────────────

function selectCompetitorTarget(books: FilteredBook[], subNiches: SubNiche[]): FilteredBook {
  if (subNiches.length > 0) {
    const vulnerable = books.filter(b => b.reviewCount < VULNERABILITY_THRESHOLD)
    if (vulnerable.length > 0) return vulnerable.sort((a, b) => a.bsr - b.bsr)[0]
    return books.sort((a, b) => a.bsr - b.bsr)[0]
  }
  const pos35 = books.slice(2, 5)
  if (pos35.length === 0) return books[books.length - 1]
  return pos35.sort((a, b) => a.reviewCount - b.reviewCount)[0]
}

// ─── Single product fetch ─────────────────────────────────────────────────────

export async function fetchSingleProduct(asin: string, market: Market): Promise<FilteredBook | null> {
  const domain = MARKET_AMAZON_DOMAIN[market]
  try {
    const data = await serpApiFetch({
      engine: 'amazon_product',
      asin,
      amazon_domain: domain,
    }) as {
      product_results?: {
        title?: string
        extracted_price?: number
        price?: { value?: number }
        rating?: number
        reviews?: number | string
      }
      product_details?: SerpProductDetails
      error?: string
    }

    if (data.error) return null

    const pr = data.product_results ?? {}
    const det = data.product_details ?? {}

    const title = pr.title ?? ''
    if (!title) return null

    const price = pr.extracted_price ?? (pr.price as { value?: number })?.value ?? 0
    const reviewCount = typeof pr.reviews === 'number'
      ? pr.reviews
      : parseInt(String(pr.reviews ?? '0').replace(/[^0-9]/g, '')) || 0
    const rating = pr.rating ?? 0

    const printLength = det.print_length ?? ''
    const pages = parseInt(printLength.replace(/[^0-9]/g, '')) || 200
    const pagesEstimated = !det.print_length

    const publisher = (det.publisher ?? '').substring(0, 60)
    const publishedDate = (det.publication_date ?? '').substring(0, 20)
    const selfPublished =
      publisher.toLowerCase().includes('independently published') ||
      publisher.toLowerCase().includes('auto-pubblicato')
    const format = (det.item_form ?? '').trim()

    let bsr = 0
    const ranks = det.best_sellers_rank ?? []
    if (ranks.length > 0) {
      const nums = ranks
        .map(r => {
          if (typeof r.extracted_rank === 'number') return r.extracted_rank
          const raw = String(r.rank ?? '').replace(/[^0-9]/g, '')
          return raw ? parseInt(raw) : 0
        })
        .filter(n => n > 0)
      if (nums.length > 0) bsr = Math.max(...nums)
    }

    const royalty = calcRoyalty(price || 9.99, pages, market)
    const sales = bsrToSales(bsr || 50000, market)

    return {
      asin,
      title,
      bsr,
      bsrTimestamp: new Date().toISOString(),
      price,
      currency: MARKET_CURRENCY[market],
      reviewCount,
      rating,
      publishedDate: publishedDate || undefined,
      pages,
      publisher: publisher || undefined,
      selfPublished,
      sponsored: false,
      format: format || undefined,
      pagesEstimated,
      royalty,
      estimatedDailySalesMin: sales.min,
      estimatedDailySalesMax: sales.max,
    }
  } catch {
    return null
  }
}

// ─── Links ───────────────────────────────────────────────────────────────────

export function helium10Link(asin: string): string {
  return `https://www.helium10.com/tools/xray/?asin=${asin}`
}

// ─── Target Finder: fetch candidati prima pagina (nessun cap) ────────────────

export async function fetchTargetFinderCandidates(
  keyword: string,
  market: Market,
): Promise<{ books: RawBook[]; unknownFormatCount: number }> {
  const serpResults = await fetchSerpData(keyword, market)

  if (serpResults.length === 0) {
    throw new Error(`Nessun risultato per "${keyword}" su ${market}. Prova una keyword più generica.`)
  }

  // Pre-filtro su dati SERP: rimuove sponsored e senza recensioni, nessun cap
  const serpCandidates = serpResults.filter(s => !s.sponsored && s.reviewCount >= 1)

  const productDetails = await Promise.all(
    serpCandidates.map(s => fetchProductDetails(s.asin, market))
  )

  const rawBooks: RawBook[] = serpCandidates.map((s, i) => {
    const d = productDetails[i]
    return {
      asin:          s.asin,
      title:         s.title,
      bsr:           d.bsr,
      bsrTimestamp:  new Date().toISOString(),
      price:         s.price,
      currency:      MARKET_CURRENCY[market],
      reviewCount:   s.reviewCount,
      rating:        s.rating,
      publishedDate: d.publishedDate || undefined,
      pages:         d.pages || undefined,
      publisher:     d.publisher || undefined,
      selfPublished: d.selfPublished,
      sponsored:     s.sponsored,
      format:        d.format,
      imageUrl:      s.imageUrl,
    }
  })

  return applyFilters(rawBooks)
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchAmazonData(keyword: string, market: Market, targetAsin?: string): Promise<AmazonData> {
  // Step 1: SERP
  const serpResults = await fetchSerpData(keyword, market)

  if (serpResults.length === 0) {
    throw new Error(`Nessun risultato per "${keyword}" su ${market}. Prova una keyword più generica.`)
  }

  // Step 2: pre-filtro SERP — elimina sponsored e senza recensioni prima delle product call
  // Riduce le chiamate product da 15 a ~7-8, contenendo i crediti SerpApi nel free tier
  const serpCandidates = serpResults
    .filter(s => !s.sponsored && s.reviewCount >= 1)
    .slice(0, MAX_PRODUCT_CALLS)

  const productDetails = await Promise.all(
    serpCandidates.map(s => fetchProductDetails(s.asin, market))
  )
  const rawBooks: RawBook[] = serpCandidates.map((s, i) => {
    const d = productDetails[i]
    return {
      asin:          s.asin,
      title:         s.title,
      bsr:           d.bsr,
      bsrTimestamp:  new Date().toISOString(),
      price:         s.price,
      currency:      MARKET_CURRENCY[market],
      reviewCount:   s.reviewCount,
      rating:        s.rating,
      publishedDate: d.publishedDate || undefined,
      pages:         d.pages || undefined,
      publisher:     d.publisher || undefined,
      selfPublished: d.selfPublished,
      sponsored:     s.sponsored,
      format:        d.format,
      imageUrl:      s.imageUrl,
    }
  })

  // Filtri e ordinamento
  const { books: preFiltered, unknownFormatCount } = applyFilters(rawBooks)
  if (unknownFormatCount > 0) {
    console.warn(`[amazon] fetchAmazonData: ${unknownFormatCount} libri scartati per formato sconosciuto`)
  }
  const sortedByBsr = preFiltered
    .filter(b => b.bsr > 0)
    .sort((a, b) => a.bsr - b.bsr)

  if (sortedByBsr.slice(0, MAX_BOOKS).length < 3) {
    throw new Error(
      `Nicchia troppo piccola per "${keyword}" su ${market}. Meno di 3 libri trovati. Prova una keyword più generica o il mercato US.`
    )
  }

  // Map top MAX_BOOKS_FOR_ADS once; slice to MAX_BOOKS for topBooks
  const adsFilteredBooks: FilteredBook[] = sortedByBsr.slice(0, MAX_BOOKS_FOR_ADS).map(b => {
    const pages = b.pages ?? 200
    const royalty = calcRoyalty(b.price, pages, market)
    const sales = bsrToSales(b.bsr, market)
    return {
      ...b,
      pages,
      pagesEstimated: !b.pages,
      royalty,
      estimatedDailySalesMin: sales.min,
      estimatedDailySalesMax: sales.max,
    }
  })

  const topBooks = adsFilteredBooks.slice(0, MAX_BOOKS)
  const ads_intelligence = calculateAdsIntelligence(adsFilteredBooks, market)

  const subNiches = detectSubNiches(rawBooks, keyword)
  const targetOverride = targetAsin
    ? topBooks.find(b => b.asin === targetAsin.toUpperCase())
    : undefined
  const competitorTarget = targetOverride ?? selectCompetitorTarget(topBooks, subNiches)

  // Recensioni: tutti i top 5 libri, deduplicati per ASIN
  const reviewCandidatesMap = new Map<string, FilteredBook>()
  for (const b of topBooks) reviewCandidatesMap.set(b.asin, b)
  const reviewCandidates = [...reviewCandidatesMap.values()]

  const topBookReviews: BookReviews[] = (
    await Promise.all(
      reviewCandidates.map(async b => ({
        asin: b.asin,
        bookTitle: b.title,
        reviews: await fetchBookReviews(b.asin, market),
      }))
    )
  ).filter(br => br.reviews.length > 0)

  return {
    market,
    keyword,
    topBooks,
    rawTop15: rawBooks,
    subNiches,
    competitorTarget,
    scrapedAt: new Date().toISOString(),
    topBookReviews: topBookReviews.length > 0 ? topBookReviews : undefined,
    ads_intelligence,
  }
}
