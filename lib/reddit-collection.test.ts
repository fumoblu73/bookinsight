import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectRedditPosts, originalRedditAccount, planRedditQueries, profileRedditItems, redditThreadId } from './reddit-collection'
import type { RedditFetchResult } from './reddit-collection'
import { fetchRedditData } from './reddit'
import type { TestContext } from 'node:test'

const success = (id: string): RedditFetchResult => ({ outcome: 'success', items: [{ kind: 'post', id }] })
const empty = (): RedditFetchResult => ({ outcome: 'empty_dataset', items: [], httpStatus: 200 })
const url = (id: string) => `https://www.reddit.com/r/test/comments/${id}/topic/`
function credentials(t: TestContext) {
  for (const key of ['APIFY_TOKEN', 'ANTHROPIC_API_KEY', 'SERPAPI_KEY']) {
    const previous = process.env[key]; process.env[key] = 'test-only'
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
}

test('query ancorata all’input: argomenti diversi e lingue diverse, senza ricerche duplicate', () => {
  for (const keyword of ['Urban balcony gardening', 'Watercolor portraits', 'Python data analysis', '窗台香草栽培']) {
    const planned = planRedditQueries('  ' + keyword + '  ', ['generic advice', keyword.toUpperCase(), 'generic   advice', 'problem one', 'problem two', 'problem three'])
    assert.equal(planned[0], keyword.toLowerCase())
    assert.equal(planned.length, 5)
    assert.equal(new Set(planned).size, planned.length)
    assert.ok(planned.includes('generic advice'))
  }
})

test('URL Reddit autentici anche senza slash finale; domini contraffatti e schemi arbitrari esclusi', () => {
  assert.equal(redditThreadId('https://www.reddit.com/r/gardening/comments/abc123'), 'abc123')
  assert.equal(redditThreadId('https://old.reddit.com/r/Python/comments/ABC123/topic/?x=y'), 'abc123')
  for (const link of ['https://evilreddit.com/r/test/comments/abc/', 'https://reddit.com.evil.test/r/test/comments/abc/', 'https://example.com/?x=reddit.com/r/test/comments/abc/', 'javascript:reddit.com/r/test/comments/abc/']) assert.equal(redditThreadId(link), null)
})

test('coda: massimo cinque richieste, primi tentativi prima dei recuperi, ordine originale dei risultati', async () => {
  const urls = Array.from({ length: 12 }, (_, i) => url(`p${i}`)), counts = new Map<string, number>(), calls: string[] = []
  let active = 0, peak = 0
  const result = await collectRedditPosts(urls, async u => {
    calls.push(u); counts.set(u, (counts.get(u) ?? 0) + 1); active++; peak = Math.max(peak, active)
    await new Promise(r => setTimeout(r, u === urls[0] ? 12 : 2)); active--
    return u === urls[2] && counts.get(u) === 1 ? empty() : success(String(urls.indexOf(u)))
  }, Date.now(), { retryDelayMs: 0 })
  assert.equal(peak, 5)
  assert.deepEqual(calls.slice(0, 12), urls)
  assert.deepEqual(calls.slice(12), [urls[2]])
  assert.deepEqual(result.allItems.map(p => p.id), urls.map((_, i) => String(i)))
  assert.deepEqual(result.diagnostics.recoveredUrls, [urls[2]])
  assert.equal(result.diagnostics.status, 'complete')
})

test('dataset sempre vuoti: un solo recupero per URL, zero risultati non diventa raccolta completa', async () => {
  let calls = 0
  const result = await collectRedditPosts([url('a'), url('b')], async () => { calls++; return empty() }, Date.now(), { retryDelayMs: 0 })
  assert.equal(calls, 4)
  assert.equal(result.diagnostics.status, 'failed')
  assert.equal(result.diagnostics.unavailableUrls.length, 2)
  assert.ok(result.diagnostics.attempts.every(a => a.attempt <= 2))
  assert.equal(result.allItems.length, 0)
})

test('rifiuto del provider: nessun recupero inutile, URL non avviati separati dagli errori', async () => {
  let calls = 0
  const result = await collectRedditPosts([url('a'), url('b'), url('c')], async () => { calls++; return { outcome: 'http_error', httpStatus: 403, items: [] } }, Date.now(), { concurrency: 1, retryDelayMs: 0 })
  assert.equal(calls, 1)
  assert.equal(result.diagnostics.stopReason, 'provider_rejected')
  assert.equal(result.diagnostics.unattemptedUrls.length, 2)
  assert.equal(result.diagnostics.budgetExhausted, false)
})

test('budget e Retry-After impediscono nuove richieste senza perdere quelle riuscite', async () => {
  let clock = 0
  const result = await collectRedditPosts([url('a'), url('b')], async () => { clock = 10; return success('a') }, 0, { now: () => clock, budgetMs: 10, concurrency: 1 })
  assert.equal(result.diagnostics.status, 'partial')
  assert.equal(result.successCount, 1)
  assert.equal(result.diagnostics.unattemptedUrls.length, 1)
  assert.equal(result.diagnostics.budgetExhausted, true)
  const limited = await collectRedditPosts([url('a')], async () => ({ items: [], outcome: 'http_error', httpStatus: 429, retryAfterMs: 1000 }), 0, { now: () => 0, budgetMs: 100, retryDelayMs: 0 })
  assert.equal(limited.diagnostics.attempts.length, 1)
  assert.deepEqual(limited.diagnostics.skippedRetries, [url('a')])
})

test('trasporto che non termina: timeout effettivo e due tentativi al massimo', async () => {
  const result = await collectRedditPosts([url('a')], async () => new Promise<RedditFetchResult>(() => {}), Date.now(), { requestTimeoutMs: 5, retryDelayMs: 0, budgetMs: 1000 })
  assert.equal(result.diagnostics.attempts.length, 2)
  assert.ok(result.diagnostics.attempts.every(a => a.outcome === 'timeout'))
  assert.equal(result.diagnostics.status, 'failed')
})

test('schema grezzo: conserva nomi e presenza dei campi, senza testi o identità nei diagnostici', () => {
  const schema = profileRedditItems([{ kind: 'post', title: 'PRIVATE_POST_TEXT' }, { kind: 'comment', id: 'c1', body: 'PRIVATE_COMMENT_TEXT', author: { id: 'PRIVATE_ACCOUNT', name: 'PRIVATE_NAME' }, author_fullname: 't2_abc', parent_id: 't3_p' }, { error: 'PRIVATE_ERROR' }, null])
  assert.equal(schema.posts, 1); assert.equal(schema.comments, 1); assert.equal(schema.unrecognizedItems, 2)
  assert.equal(schema.commentFieldPresence.author_fullname, 1)
  assert.deepEqual(schema.authorObjectFields, ['id', 'name'])
  assert.ok(!JSON.stringify(schema).includes('PRIVATE_'))
  assert.equal(originalRedditAccount({ author_fullname: 'T2_AbC' }), 't2_abc')
  for (const value of ['abc', 't1_abc', 'UCAccount', '', null]) assert.equal(originalRedditAccount({ authorId: value }), undefined)
})

test('errori SerpApi HTTP 200 distinti da assenza di risultati, senza corpo errore nei diagnostici', async t => {
  credentials(t)
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const target = String(input)
    if (target.includes('anthropic.com')) return Response.json({ content: [{ text: '[]' }] })
    assert.ok(target.includes('serpapi.com'))
    return Response.json({ error: 'PRIVATE_CREDENTIAL_MESSAGE' })
  })
  const result = await fetchRedditData('balcony gardening')
  assert.equal(result.available, false)
  assert.equal(result.collectionDiagnostics?.status, 'failed')
  assert.equal(result.collectionDiagnostics?.queries[0].status, 'provider_error')
  assert.equal(result.collectionDiagnostics?.stopReason, 'search_failed')
  assert.ok(!JSON.stringify(result).includes('PRIVATE_CREDENTIAL_MESSAGE'))
})

test('collector: scarti riconciliabili, fullname autore valido preservato e schema disponibile', async t => {
  credentials(t)
  const comments = Array.from({ length: 35 }, (_, i) => ({ kind: 'comment', id: `c${i}`, postId: 'abc123', body: `Real experience ${i}`, score: 100 - i, author: 'Reader', author_fullname: 't2_user', parent_id: 't3_abc123' }))
  const items = [{ kind: 'post', id: 'abc123', url: url('abc123'), title: 'Topic', body: '', score: 1, subreddit: 'test' }, ...comments,
    { kind: 'comment', id: 'removed', postId: 'abc123', body: '[deleted]' },
    { kind: 'comment', id: 'bot', postId: 'abc123', body: 'Rules', author: 'AutoModerator' },
    { kind: 'comment', id: 'missing', body: 'No parent container' },
    { kind: 'comment', id: 'orphan', postId: 'other', body: 'Orphan experience' }]
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const target = String(input)
    if (target.includes('anthropic.com')) return Response.json({ content: [{ text: '["broader needs"]' }] })
    if (target.includes('serpapi.com')) return Response.json({ organic_results: [{ link: url('abc123') }, { link: 'https://evilreddit.com/r/test/comments/forged/' }] })
    assert.ok(target.includes('api.apify.com')); return Response.json(items)
  })
  const result = await fetchRedditData('watercolor portraits')
  const mapping = result.collectionDiagnostics!.mapping!
  assert.deepEqual(mapping, { rawPosts: 1, rawComments: 39, missingPostId: 1, removed: 1, boilerplate: 1, orphanComments: 1, unselectedPostComments: 0, overThreadLimit: 5, keptComments: 30 })
  assert.equal(mapping.rawComments, mapping.missingPostId + mapping.removed + mapping.boilerplate + mapping.orphanComments + mapping.unselectedPostComments + mapping.overThreadLimit + mapping.keptComments)
  assert.equal(result.posts[0].comments[0].provenance?.authorId, 't2_user')
  assert.equal(result.collectionDiagnostics?.queries[0].kind, 'original')
  assert.equal(result.collectionDiagnostics?.queries[0].query, 'watercolor portraits')
  assert.equal(result.collectionDiagnostics?.attempts[0].schema?.comments, 39)
  assert.equal(result.totalComments, 30)
})
