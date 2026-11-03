import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchAmazonReviewsApifyPartial, parseHelpfulVotes } from './amazon-reviews'
import { fetchBookReviews } from './amazon'

// Nessuna chiamata reale: fetch iniettato. Il token è fittizio.

type Call = { url: string; init?: RequestInit }
function stubFetch(routes: (url: string, init?: RequestInit) => Response | undefined, calls: Call[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    const res = routes(url, init)
    if (!res) throw new Error(`fetch inatteso: ${url}`)
    return res
  }) as typeof fetch
}

async function withToken<T>(run: () => Promise<T>): Promise<T> {
  const saved = process.env.APIFY_TOKEN
  process.env.APIFY_TOKEN = 'test-token'
  const log = console.log
  console.log = () => {}
  try { return await run() } finally {
    console.log = log
    if (saved === undefined) delete process.env.APIFY_TOKEN
    else process.env.APIFY_TOKEN = saved
  }
}

const ITEM = {
  ratingScore: 2, reviewTitle: 'Too vague', reviewDescription: 'The recipes never say how much water to add per jar.',
  reviewedIn: 'Reviewed in the United States on May 1, 2026', reviewReaction: '5 people found this helpful',
}

test('parseHelpfulVotes: testo SerpApi/Apify, numeri e valori assenti', () => {
  assert.equal(parseHelpfulVotes('17 people found this helpful'), 17)
  assert.equal(parseHelpfulVotes('1,234 people found this helpful'), 1234)
  assert.equal(parseHelpfulVotes('One person found this helpful'), 1)
  assert.equal(parseHelpfulVotes(8), 8)
  assert.equal(parseHelpfulVotes(undefined), 0)
  assert.equal(parseHelpfulVotes('Helpful'), 0)
})

test('Apify: legge il dataset anche se l\'esecuzione va in TIMED-OUT', async () => {
  const calls: Call[] = []
  const fetchImpl = stubFetch(url => {
    if (url.includes('/acts/junglee~amazon-reviews-scraper/runs?')) {
      return new Response(JSON.stringify({ data: { id: 'run1', status: 'TIMED-OUT', defaultDatasetId: 'ds1' } }))
    }
    if (url.includes('/datasets/ds1/items')) return new Response(JSON.stringify([ITEM, { ...ITEM, reviewDescription: 'short' }]))
    return undefined
  }, calls)
  const res = await withToken(() => fetchAmazonReviewsApifyPartial('1612431631', 'US', { fetchImpl }))
  assert.equal(res.status, 'TIMED-OUT')
  assert.equal(res.reviews.length, 1, 'testi troppo brevi scartati')
  assert.deepEqual(res.reviews[0], { rating: 2, title: 'Too vague', body: ITEM.reviewDescription, date: '2026-05-01' })
  const body = JSON.parse(String(calls[0].init?.body))
  assert.deepEqual(body.productUrls, [{ url: 'https://www.amazon.com/dp/1612431631' }])
  assert.equal(body.maxReviews, 10)
  assert.equal(body.includeGdprSensitive, false, 'nessun dato personale dei recensori')
  assert.deepEqual(body.filterByRatings, ['critical', 'fourStar'], 'recensioni negative e miste per i pain point')
  assert.ok(!calls[0].url.includes('run-sync'), 'non usa run-sync, che scarta i dati dei timeout')
  assert.ok(!calls[0].url.includes('token='), 'token nell\'header, non nell\'URL')
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer test-token')
})

test('Apify: esecuzione ancora in corso → interrotta, dati parziali comunque letti', async () => {
  const calls: Call[] = []
  const fetchImpl = stubFetch(url => {
    if (url.includes('/runs?')) return new Response(JSON.stringify({ data: { id: 'run2', status: 'RUNNING', defaultDatasetId: 'ds2' } }))
    if (url.includes('/actor-runs/run2/abort')) return new Response('{}')
    if (url.includes('/datasets/ds2/items')) return new Response(JSON.stringify([ITEM]))
    return undefined
  }, calls)
  const res = await withToken(() => fetchAmazonReviewsApifyPartial('B000', 'UK', { fetchImpl }))
  assert.equal(res.reviews.length, 1)
  assert.ok(calls.some(c => c.url.includes('/actor-runs/run2/abort')))
  assert.ok(String(JSON.parse(String(calls[0].init?.body)).productUrls[0].url).startsWith('https://www.amazon.co.uk/'))
})

test('Apify: errori e token assente non bloccano e sono descritti', async () => {
  const saved = process.env.APIFY_TOKEN
  delete process.env.APIFY_TOKEN
  try {
    assert.deepEqual(await fetchAmazonReviewsApifyPartial('B000', 'US'), { reviews: [], status: 'no_token' })
  } finally { if (saved !== undefined) process.env.APIFY_TOKEN = saved }
  const http403 = stubFetch(() => new Response('{}', { status: 403 }), [])
  assert.deepEqual(await withToken(() => fetchAmazonReviewsApifyPartial('B000', 'US', { fetchImpl: http403 })), { reviews: [], status: 'http_403' })
  const boom = (async () => { throw new Error('network') }) as unknown as typeof fetch
  assert.deepEqual(await withToken(() => fetchAmazonReviewsApifyPartial('B000', 'US', { fetchImpl: boom })), { reviews: [], status: 'error' })
})

test('fetchBookReviews: SerpApi per primo, Apify solo se SerpApi è vuoto', async () => {
  const review = { rating: 3, title: 't', body: 'b'.repeat(60) }
  let apifyCalls = 0
  const apify = async () => { apifyCalls++; return { reviews: [review], status: 'SUCCEEDED' } }

  const fromSerp = await fetchBookReviews('A1', 'IT', { serp: async () => [review], apify })
  assert.equal(fromSerp.source, 'serpapi')
  assert.equal(apifyCalls, 0, 'nessun costo Apify se SerpApi basta')
  assert.deepEqual(fromSerp.attempt, { asin: 'A1', serpapiCount: 1, apifyCount: null })

  const fromApify = await fetchBookReviews('A2', 'US', { serp: async () => [], apify })
  assert.equal(fromApify.source, 'apify')
  assert.deepEqual(fromApify.attempt, { asin: 'A2', serpapiCount: 0, apifyCount: 1, apifyStatus: 'SUCCEEDED' })

  const none = await fetchBookReviews('A3', 'US', { serp: async () => [], apify: async () => ({ reviews: [], status: 'TIMED-OUT' }) })
  assert.equal(none.source, undefined)
  assert.equal(none.reviews.length, 0)
  assert.equal(none.attempt.apifyStatus, 'TIMED-OUT')
})
