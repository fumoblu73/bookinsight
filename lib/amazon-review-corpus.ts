import type { AmazonData, AmazonReview, AmazonReviewCollection, BookReviews, Market } from './types'
import { cacheGet, cacheSet } from './upstash'

const DOMAINS: Record<Market, string> = { US: 'amazon.com', UK: 'amazon.co.uk', IT: 'amazon.it', DE: 'amazon.de', FR: 'amazon.fr', ES: 'amazon.es' }
const ACTOR = 'junglee~amazon-reviews-scraper'
const MAX_REVIEWS = 10
type ReviewCache = { read: (key: string) => Promise<AmazonReview[] | null>; write: (key: string, value: AmazonReview[], seconds: number) => Promise<unknown> }
type Options = { token?: string; fetcher?: typeof fetch; cache?: ReviewCache; timeoutMs?: number }

/** Schema pubblico dell'actor: solo recensioni dei libri richiesti e nessun testo inferito. */
export function mapAmazonReviews(items: unknown, books: AmazonData['topBooks'], market: Market): BookReviews[] {
  if (!Array.isArray(items)) return []
  const byAsin = new Map(books.slice(0, 5).map(b => [b.asin, { asin: b.asin, bookTitle: b.title, reviews: [] as AmazonReview[] }]))
  const seen = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const book = byAsin.get(String(row.productAsin ?? '').toUpperCase())
    const body = typeof row.reviewDescription === 'string' ? row.reviewDescription.trim() : ''
    const rating = Number(row.ratingScore)
    if (!book || book.reviews.length >= MAX_REVIEWS || body.length < 50 || !Number.isFinite(rating) || rating < 1 || rating > 5) continue
    let id: string | undefined, url: string | undefined
    try {
      const original = new URL(String(row.reviewUrl ?? ''))
      if (original.protocol === 'https:' && ['www.' + DOMAINS[market], DOMAINS[market]].includes(original.hostname)) {
        id = original.pathname.match(/\/(?:customer-reviews|review)\/(R[A-Z0-9]+)(?:\/|$)/i)?.[1]
        if (id) url = original.toString()
      }
    } catch { /* Un URL mancante non crea un identificativo originale. */ }
    const key = `${book.asin}:${id ?? body}`
    if (seen.has(key)) continue
    seen.add(key)
    book.reviews.push({ rating, title: String(row.reviewTitle ?? '').slice(0, 100), body: body.slice(0, 500),
      ...(typeof row.reviewedIn === 'string' ? { date: row.reviewedIn } : {}), ...(id ? { id, url } : {}) })
  }
  return [...byAsin.values()].filter(b => b.reviews.length)
}

/** Fallback server: un solo run a costo e durata limitati; campioni positivi in cache 24 ore. */
export async function supplementAmazonReviews(data: AmazonData, options: Options = {}): Promise<AmazonData> {
  const cache = options.cache ?? { read: key => cacheGet<AmazonReview[]>(key), write: cacheSet }
  const token = options.token ?? process.env.APIFY_TOKEN
  const books = [...new Map(data.topBooks.slice(0, 5).map(b => [b.asin, b])).values()]
  const groups = new Map((data.topBookReviews ?? []).filter(b => b.reviews.length).map(b => [b.asin, b]))
  const cacheKey = (asin: string) => `amazon-reviews:apify:v1:${data.market}:${asin}`
  let fallback: AmazonReviewCollection['fallback'] = 'not_needed', reason: AmazonReviewCollection['reason']
  await Promise.all(books.filter(b => !groups.has(b.asin)).map(async b => {
    const reviews = await cache.read(cacheKey(b.asin)).catch(() => null)
    if (reviews?.length) { groups.set(b.asin, { asin: b.asin, bookTitle: b.title, reviews }); fallback = 'cache' }
  }))
  const missing = books.filter(b => !groups.has(b.asin))
  if (missing.length) {
    const seconds = Math.min(90, Math.floor((options.timeoutMs ?? 95_000) / 1000) - 3)
    if (!token) { fallback = 'unavailable'; reason = 'missing_token' }
    else if (seconds < 5) { fallback = 'unavailable'; reason = 'time_budget' }
    else {
      fallback = 'apify'
      try {
        const query = new URLSearchParams({ timeout: String(seconds), maxItems: String(missing.length * MAX_REVIEWS), maxTotalChargeUsd: '0.5' })
        const response = await (options.fetcher ?? fetch)(`https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?${query}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ productUrls: missing.map(b => ({ url: `https://www.${DOMAINS[data.market]}/dp/${b.asin}` })),
            maxReviews: MAX_REVIEWS, sort: 'helpful', includeGdprSensitive: false, scrapeProductDetails: false }),
          signal: AbortSignal.timeout((seconds + 3) * 1000),
        })
        if (!response.ok) throw new Error('provider_error')
        const mapped = mapAmazonReviews(await response.json(), missing, data.market)
        if (!mapped.length) reason = 'empty_dataset'
        for (const b of mapped) groups.set(b.asin, b)
        await Promise.all(mapped.map(b => cache.write(cacheKey(b.asin), b.reviews, 24 * 60 * 60).catch(() => false)))
      } catch { reason = 'provider_error' }
    }
  }
  const topBookReviews = books.flatMap(b => groups.has(b.asin) ? [groups.get(b.asin)!] : [])
  const reviewCount = topBookReviews.reduce((n, b) => n + b.reviews.length, 0)
  const reviewCollection: AmazonReviewCollection = { status: topBookReviews.length === books.length ? 'complete' : reviewCount ? 'partial' : 'unavailable',
    requestedBooks: books.length, booksWithReviews: topBookReviews.length, reviewCount, fallback, ...(reason ? { reason } : {}) }
  console.log('[amazon-reviews]', JSON.stringify(reviewCollection))
  return { ...data, topBookReviews: topBookReviews.length ? topBookReviews : undefined, reviewCollection }
}
