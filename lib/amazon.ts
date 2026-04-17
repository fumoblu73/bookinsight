import { RawBook, FilteredBook, SubNiche, AmazonData, Market } from './types'

// ─── Costanti ─────────────────────────────────────────────────────────────────

const MARKET_KEEPA_CODE: Record<Market, number> = {
  US: 1, UK: 3, DE: 4, FR: 5, IT: 8, ES: 9,
}

const MARKET_CURRENCY: Record<Market, string> = {
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

const MARKET_BOOKS_CATEGORY: Record<Market, string> = {
  US: '283155',
  UK: '266239',
  DE: '186606',
  FR: '301130',
  IT: '411663031',
  ES: '599364031',
}

const KDP_PRINT_COST: Record<Market, { fixed: number; perPage: number }> = {
  US: { fixed: 1.00, perPage: 0.012 },
  UK: { fixed: 0.85, perPage: 0.010 },
  DE: { fixed: 0.75, perPage: 0.012 },
  FR: { fixed: 0.75, perPage: 0.012 },
  IT: { fixed: 0.75, perPage: 0.012 },
  ES: { fixed: 0.75, perPage: 0.012 },
}

const VULNERABILITY_THRESHOLD = 100
const MIN_AGE_DAYS = 30
const MAX_BOOKS = 5
const MAX_PRODUCT_CALLS = 8  // cap product calls per contenere i crediti SerpApi nel free tier

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

  // SerpApi Amazon engine uses `k` (not `q`) for the search keyword
  const data = await serpApiFetch({
    engine: 'amazon',
    k: keyword,
    amazon_domain: domain,
    category_id: MARKET_BOOKS_CATEGORY[market],
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

    // BSR — best rank in the "Books" category (highest-level = largest rank number,
    // but we want the best BSR = lowest number in Books root category)
    // SerpApi returns extracted_rank for each subcategory; we take the largest
    // value (Books root rank) which is the overall BSR
    let bsr = 0
    const ranks = det.best_sellers_rank ?? []
    if (ranks.length > 0) {
      const nums = ranks.map(r => {
        if (typeof r.extracted_rank === 'number') return r.extracted_rank
        const raw = String(r.rank ?? '').replace(/[^0-9]/g, '')
        return raw ? parseInt(raw) : 0
      }).filter(n => n > 0)
      // The largest rank number is the root Books BSR (overall rank)
      if (nums.length > 0) bsr = Math.max(...nums)
    }

    // Pages: "432 pages" → 432
    const printLength = det.print_length ?? ''
    const pages = parseInt(printLength.replace(/[^0-9]/g, '')) || 0

    const publisher = (det.publisher ?? '').substring(0, 60)
    const publishedDate = (det.publication_date ?? '').substring(0, 20)

    const selfPublished =
      publisher.toLowerCase().includes('independently published') ||
      publisher.toLowerCase().includes('auto-pubblicato')

    const format = (det.item_form ?? 'Paperback').trim() || 'Paperback'

    return { bsr, pages, publisher, publishedDate, selfPublished, format }
  } catch {
    return defaultProductDetails()
  }
}

function defaultProductDetails(): ProductDetails {
  return { bsr: 0, pages: 0, publisher: '', publishedDate: '', selfPublished: false, format: 'Paperback' }
}

// ─── Calcoli economici ────────────────────────────────────────────────────────

export function calcRoyalty(price: number, pages: number, market: Market): number {
  const { fixed, perPage } = KDP_PRINT_COST[market]
  const effectivePages = pages < 24 ? 0 : pages
  const printCost = fixed + perPage * effectivePages
  return Math.max(0, price * 0.6 - printCost)
}

function bsrToSales(bsr: number, market: Market): { min: number; max: number } {
  const B = -0.778151
  const marketMult: Record<Market, number> = {
    US: 1.00, UK: 0.35, DE: 0.25, FR: 0.20, IT: 0.15, ES: 0.12,
  }
  let A: number
  if (bsr < 1000)        A = 31622.78
  else if (bsr < 100000) A = 25920
  else                   A = 9331.2

  const baseKindle = A * Math.pow(bsr, B)
  const paperback = baseKindle * 0.3 * 0.9 * marketMult[market]
  return { min: Math.max(1, Math.floor(paperback * 0.7)), max: Math.ceil(paperback * 1.3) }
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
    const words = book.title.toLowerCase().split(/[\s\-–:,]+/)
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

function applyFilters(books: RawBook[]): RawBook[] {
  const now = Date.now()
  return books.filter(b => {
    if (b.sponsored) return false
    if (b.reviewCount < 1) return false
    if (b.publishedDate) {
      const ageMs = now - new Date(b.publishedDate).getTime()
      if (ageMs / (1000 * 60 * 60 * 24) < MIN_AGE_DAYS) return false
    }
    return true
  })
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

// ─── Links ───────────────────────────────────────────────────────────────────

export function keepaLink(asin: string, market: Market): string {
  return `https://keepa.com/#!product/${MARKET_KEEPA_CODE[market]}-${asin}`
}

export function helium10Link(asin: string): string {
  return `https://www.helium10.com/tools/xray/?asin=${asin}`
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function fetchAmazonData(keyword: string, market: Market): Promise<AmazonData> {
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
  const filtered = applyFilters(rawBooks)
    .filter(b => b.bsr > 0)
    .sort((a, b) => a.bsr - b.bsr)
    .slice(0, MAX_BOOKS)

  if (filtered.length < 3) {
    throw new Error(
      `Nicchia troppo piccola per "${keyword}" su ${market}. Meno di 3 libri trovati. Prova una keyword più generica o il mercato US.`
    )
  }

  const topBooks: FilteredBook[] = filtered.map(b => {
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

  const subNiches = detectSubNiches(rawBooks, keyword)
  const competitorTarget = selectCompetitorTarget(topBooks, subNiches)

  return {
    market,
    keyword,
    topBooks,
    rawTop15: rawBooks,
    subNiches,
    competitorTarget,
    scrapedAt: new Date().toISOString(),
  }
}
