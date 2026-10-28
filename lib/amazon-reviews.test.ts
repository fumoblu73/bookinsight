import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapAmazonReviews, supplementAmazonReviews } from './amazon-review-corpus'
import type { AmazonData, AmazonReview } from './types'

const data = { market: 'US', keyword: 'topic', topBooks: [{ asin: 'B000000001', title: 'One' }, { asin: 'B000000002', title: 'Two' }],
  scrapedAt: '2026-10-28', rawTop15: [], subNiches: [], competitorTarget: { asin: 'B000000001' }, ads_intelligence: { available: false } } as unknown as AmazonData
const row = { productAsin: 'B000000001', ratingScore: 2, reviewTitle: 'Needs examples', reviewDescription: 'I cannot follow the instructions because the book does not include any worked examples.',
  reviewUrl: 'https://www.amazon.com/gp/customer-reviews/R123ABC/', reviewedIn: 'Reviewed in the United States on October 1, 2026' }
const emptyCache = { read: async () => null, write: async () => true }

test('normalizzazione: ASIN, ID e link originali; duplicati, rating e URL arbitrari', () => {
  const got = mapAmazonReviews([row, row, { ...row, productAsin: 'B000000099' }, { ...row, ratingScore: 0 },
    { ...row, productAsin: 'B000000002', reviewUrl: 'https://attacker.example/review/R123ABC' }], data.topBooks, 'US')
  assert.equal(got.length, 2)
  assert.equal(got[0].reviews.length, 1)
  assert.equal(got[0].reviews[0].id, 'R123ABC')
  assert.equal(got[0].reviews[0].url, row.reviewUrl)
  assert.equal(got[1].reviews[0].id, undefined)
  assert.equal(got[1].reviews[0].url, undefined)
  assert.equal(mapAmazonReviews([{ ...row, reviewDescription: 'summary' }], data.topBooks, 'US').length, 0)
})

test('un solo fallback limitato ai libri mancanti, senza token in URL; dati di mercato intatti', async () => {
  const original = structuredClone({ ...data, topBookReviews: [{ asin: 'B000000002', bookTitle: 'Two', reviews: [{ rating: 3, title: 'Existing', body: row.reviewDescription }] }] })
  const before = JSON.stringify(original), writes: { key: string; seconds: number }[] = []
  let calls = 0
  const result = await supplementAmazonReviews(original, { token: 'test-token', cache: { read: emptyCache.read, write: async (key, _reviews, seconds) => { writes.push({ key, seconds }); return true } },
    fetcher: (async (url, init) => {
      calls++
      const parsed = new URL(String(url))
      assert.equal(parsed.searchParams.has('token'), false)
      assert.equal(parsed.searchParams.get('maxTotalChargeUsd'), '0.5')
      assert.equal(parsed.searchParams.get('maxItems'), '10')
      assert.equal(Number(parsed.searchParams.get('timeout')) <= 90, true)
      assert.equal((init!.headers as Record<string, string>).Authorization, 'Bearer test-token')
      const body = JSON.parse(init!.body as string)
      assert.deepEqual(body.productUrls, [{ url: 'https://www.amazon.com/dp/B000000001' }])
      assert.equal(body.includeGdprSensitive, false)
      return Response.json([row])
    }) as typeof fetch })
  assert.equal(calls, 1)
  assert.equal(result.reviewCollection?.status, 'complete')
  assert.equal(result.reviewCollection?.reviewCount, 2)
  assert.equal(writes[0].seconds, 86400)
  assert.equal(JSON.stringify(original), before)
  assert.deepEqual(result.topBooks, original.topBooks)
  assert.deepEqual(result.ads_intelligence, original.ads_intelligence)
})

test('cache positiva evita il run; guasti e campioni vuoti restano espliciti', async () => {
  const reviews: AmazonReview[] = [{ rating: 2, title: 'Review', body: row.reviewDescription }]
  const cached = await supplementAmazonReviews(data, { token: 'test', cache: { read: async () => reviews, write: emptyCache.write }, fetcher: (async () => { throw Error('No network expected') }) as typeof fetch })
  assert.equal(cached.reviewCollection?.fallback, 'cache')
  assert.equal(cached.reviewCollection?.status, 'complete')
  const failed = await supplementAmazonReviews(data, { token: 'test', cache: emptyCache, fetcher: (async () => new Response('private provider details', { status: 403 })) as typeof fetch })
  assert.equal(failed.reviewCollection?.reason, 'provider_error')
  assert.equal(failed.reviewCollection?.status, 'unavailable')
  assert.equal(JSON.stringify(failed).includes('private provider details'), false)
  const empty = await supplementAmazonReviews(data, { token: 'test', cache: emptyCache, fetcher: (async () => Response.json([])) as typeof fetch })
  assert.equal(empty.reviewCollection?.reason, 'empty_dataset')
  assert.equal(empty.topBookReviews, undefined)
  const noTime = await supplementAmazonReviews(data, { token: 'test', cache: emptyCache, timeoutMs: 0 })
  assert.equal(noTime.reviewCollection?.reason, 'time_budget')
})
