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
function parseReviewedIn(reviewedIn: string): string | undefined {
  const m = reviewedIn.match(/\b(?:on|il|am|le|el)\s+(.+)$/i)
  if (!m) return undefined
  try {
    const d = new Date(m[1])
    if (isNaN(d.getTime())) return undefined
    return d.toISOString().slice(0, 10)
  } catch {
    return undefined
  }
}

export async function fetchAmazonReviewsApify(
  asin: string,
  market: Market,
  maxReviews = 20,
): Promise<AmazonReview[]> {
  const token = process.env.APIFY_TOKEN
  if (!token) return []

  const domain = MARKET_DOMAIN[market]
  const url = `https://www.${domain}/dp/${asin}`

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/junglee~amazon-reviews-scraper/run-sync-get-dataset-items?token=${token}&timeout=45`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productUrls: [{ url }], maxReviews }),
        signal: AbortSignal.timeout(50000),
      },
    )

    console.log(`[amazon-reviews] ${asin}/${market} status:${res.status}`)
    if (!res.ok) return []

    const items = await res.json() as Record<string, unknown>[]
    console.log(`[amazon-reviews] ${asin}/${market} items:${items.length}`)

    return items
      .map(item => ({
        rating: Number(item.ratingScore ?? 0),
        title: String(item.reviewTitle ?? ''),
        body: String(item.reviewDescription ?? ''),
        date: item.reviewedIn ? parseReviewedIn(String(item.reviewedIn)) : undefined,
      }))
      .filter(r => r.body.length > 20)
  } catch (err) {
    console.log(`[amazon-reviews] FAILED ${asin}/${market} error:${err}`)
    return []
  }
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
