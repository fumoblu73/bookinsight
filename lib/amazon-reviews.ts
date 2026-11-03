import { AmazonReview, Market } from './types'

const MARKET_DOMAIN: Record<Market, string> = {
  US: 'amazon.com',
  UK: 'amazon.co.uk',
  DE: 'amazon.de',
  FR: 'amazon.fr',
  IT: 'amazon.it',
  ES: 'amazon.es',
}

// Handles "Reviewed in Italy on November 19, 2023" — English markets parse reliably.
// Non-English date strings (il, am, le…) may return undefined; callers handle null gracefully.
export function parseReviewedIn(reviewedIn: string): string | undefined {
  const m = reviewedIn.match(/\b(?:on|il|am|le|el)\s+(.+)$/i)
  if (!m) return undefined
  try {
    // Interpretata in UTC: con l'ora locale la data poteva slittare di un giorno.
    const d = new Date(`${m[1]} UTC`)
    if (isNaN(d.getTime())) return undefined
    return d.toISOString().slice(0, 10)
  } catch {
    return undefined
  }
}

const ACTOR = 'junglee~amazon-reviews-scraper'

/** Recensioni per libro. Piano gratuito Apify: 10 per esecuzione (dal log dell'actor);
 * con un piano a pagamento si alza con la variabile d'ambiente APIFY_AMAZON_MAX_REVIEWS
 * (massimo 100, limite dell'actor per filtro di stelle). */
export function amazonReviewsMax(): number {
  const n = parseInt(process.env.APIFY_AMAZON_MAX_REVIEWS ?? '', 10)
  return Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 10
}

export interface ApifyReviewsResult {
  reviews: AmazonReview[]
  status: string // stato dell'esecuzione Apify o descrizione dell'errore
}

type FetchLike = typeof fetch

/**
 * Recensioni Amazon via Apify (junglee~amazon-reviews-scraper).
 *
 * Da ottobre 2026 amazon.com mostra le recensioni solo a utenti con login: SerpApi
 * (segnalazione pubblica serpapi/public-roadmap#4505) non le restituisce più. L'actor
 * le raggiunge con i propri mezzi, senza account dell'utente.
 *
 * Log reali (2026-11-03): l'actor salva le prime 10 recensioni dopo la prima pagina
 * e poi continua a paginare, rallentato dai 429 di Amazon, fino al timeout, anche
 * con maxReviews 10. run-sync-get-dataset-items scarterebbe i dati di un TIMED-OUT:
 * qui l'esecuzione parte con timeout breve, si attende la fine e si legge comunque
 * il dataset. Piano gratuito Apify: 1 URL e 10 recensioni per esecuzione.
 * includeGdprSensitive false: nessun nome, ID o immagine dei recensori.
 */
export async function fetchAmazonReviewsApifyPartial(
  asin: string,
  market: Market,
  opts: { maxReviews?: number; actorTimeoutS?: number; fetchImpl?: FetchLike; filterByRatings?: string[]; sort?: 'helpful' | 'recent' } = {},
): Promise<ApifyReviewsResult> {
  const token = process.env.APIFY_TOKEN
  if (!token) return { reviews: [], status: 'no_token' }
  const doFetch = opts.fetchImpl ?? fetch
  const maxReviews = opts.maxReviews ?? amazonReviewsMax()
  const actorTimeoutS = opts.actorTimeoutS ?? 40
  const auth = { Authorization: `Bearer ${token}` }
  const url = `https://www.${MARKET_DOMAIN[market]}/dp/${asin}`

  try {
    const runRes = await doFetch(
      `https://api.apify.com/v2/acts/${ACTOR}/runs?timeout=${actorTimeoutS}&memory=1024&waitForFinish=${Math.min(60, actorTimeoutS + 5)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        // Su richiesta: solo 1-3 stelle ("critical" nell'OpenAPI dell'actor), dalle più
        // recenti (sort "recent"). Con allStars + helpful la prima analisi reale aveva 28
        // recensioni da 5★ su 41.
        body: JSON.stringify({
          productUrls: [{ url }], maxReviews, sort: opts.sort ?? 'recent', includeGdprSensitive: false,
          filterByRatings: opts.filterByRatings ?? ['critical'],
        }),
        signal: AbortSignal.timeout((actorTimeoutS + 15) * 1000),
      },
    )
    if (!runRes.ok) {
      // Il corpo dell'errore Apify dice il motivo (es. 402: credito o limite mensile esaurito).
      const detail = (await runRes.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
      console.log(`[amazon-reviews] ${asin}/${market} avvio Apify status:${runRes.status} body:${detail}`)
      return { reviews: [], status: `http_${runRes.status}` }
    }
    const run = await runRes.json() as { data?: { id?: string; status?: string; defaultDatasetId?: string } }
    const status = run.data?.status ?? 'unknown'
    const datasetId = run.data?.defaultDatasetId
    // Se l'attesa scade prima della fine, si interrompe l'esecuzione per non pagare oltre.
    if (run.data?.id && (status === 'RUNNING' || status === 'READY')) {
      doFetch(`https://api.apify.com/v2/actor-runs/${run.data.id}/abort`, { method: 'POST', headers: auth, signal: AbortSignal.timeout(5000) })
        .catch(() => {})
    }
    if (!datasetId) return { reviews: [], status }

    const itemsRes = await doFetch(
      `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json&limit=${maxReviews}`,
      { headers: auth, signal: AbortSignal.timeout(10_000) },
    )
    if (!itemsRes.ok) return { reviews: [], status: `${status}/dataset_http_${itemsRes.status}` }
    const items = await itemsRes.json() as Record<string, unknown>[]
    const reviews = (Array.isArray(items) ? items : [])
      .map(item => ({
        rating: Number(item.ratingScore ?? 0),
        title: String(item.reviewTitle ?? '').slice(0, 100),
        body: String(item.reviewDescription ?? '').slice(0, 500),
        date: item.reviewedIn ? parseReviewedIn(String(item.reviewedIn)) : undefined,
      }))
      .filter(r => r.body.length > 20)
    console.log(`[amazon-reviews] ${asin}/${market} apify status:${status} items:${reviews.length}`)
    return { reviews, status }
  } catch (err) {
    console.log(`[amazon-reviews] FAILED ${asin}/${market} error:${err}`)
    return { reviews: [], status: 'error' }
  }
}

// ─── Più recensioni sul piano gratuito: un'esecuzione per numero di stelle ────
// Il piano gratuito Apify limita ogni esecuzione a 10 recensioni: con tre esecuzioni
// (1, 2 e 3 stelle) si arriva fino a 30 recensioni negative per libro. Le esecuzioni
// contemporanee sono limitate (APIFY_MAX_CONCURRENT_RUNS, default 5: valore già
// osservato funzionare nell'analisi reale con 5 libri in parallelo).

const STAR_FILTERS = ['oneStar', 'twoStar', 'threeStar'] as const

function maxConcurrentRuns(): number {
  const n = parseInt(process.env.APIFY_MAX_CONCURRENT_RUNS ?? '', 10)
  return Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 5
}

let activeRuns = 0
const waiting: Array<() => void> = []
async function withRunSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeRuns >= maxConcurrentRuns()) await new Promise<void>(resolve => waiting.push(resolve))
  activeRuns++
  try {
    return await task()
  } finally {
    activeRuns--
    waiting.shift()?.()
  }
}

/** Fino a 3 × maxReviews recensioni da 1-3 stelle, dalle più recenti, senza duplicati. */
export async function fetchAmazonNegativeReviewsByStars(
  asin: string,
  market: Market,
  opts: { maxReviewsPerStar?: number; fetchImpl?: FetchLike } = {},
): Promise<ApifyReviewsResult> {
  const results = await Promise.all(STAR_FILTERS.map(filter =>
    withRunSlot(() => fetchAmazonReviewsApifyPartial(asin, market, {
      maxReviews: opts.maxReviewsPerStar, fetchImpl: opts.fetchImpl, filterByRatings: [filter], sort: 'recent',
    })),
  ))
  const seen = new Set<string>()
  const reviews: AmazonReview[] = []
  // Alternanza 1★, 2★, 3★: se un prompt usa solo una parte, restano rappresentate tutte.
  const longest = Math.max(0, ...results.map(r => r.reviews.length))
  for (let i = 0; i < longest; i++) {
    for (const r of results) {
      const review = r.reviews[i]
      if (!review) continue
      const key = `${review.title}\u0000${review.body}`
      if (seen.has(key)) continue
      seen.add(key)
      reviews.push(review)
    }
  }
  const status = STAR_FILTERS.map((f, i) => `${f}:${results[i].status}/${results[i].reviews.length}`).join(',')
  return { reviews, status: results.every(r => r.status === 'no_token') ? 'no_token' : status }
}

/** Compatibilità con /api/target/viability: stessa fonte, stessa firma di prima. */
export async function fetchAmazonReviewsApify(
  asin: string,
  market: Market,
  maxReviews = 10,
): Promise<AmazonReview[]> {
  // Valutazione del concorrente: tutte le stelle (debolezze e velocità recente).
  return (await fetchAmazonReviewsApifyPartial(asin, market, { maxReviews, filterByRatings: ['allStars'], sort: 'helpful' })).reviews
}

/** "17 people found this helpful" → 17; "One person found this helpful" → 1. */
export function parseHelpfulVotes(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return 0
  if (/^\s*one person/i.test(value)) return 1
  const m = value.replace(/[.,](?=\d{3}\b)/g, '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 0
}

// Returns reviews per month in the last `windowDays` days, or null if no dated reviews found.
export function calcRecentReviewVelocity(
  reviews: AmazonReview[],
  windowDays = 90,
): number | null {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
  const recent = reviews.filter(r => {
    if (!r.date) return false
    return new Date(r.date).getTime() >= cutoff
  })
  if (recent.length === 0) return null
  return recent.length / (windowDays / 30)
}
