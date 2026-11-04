import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fetchRedditData } from './reddit'

// 9.0.2 passo 1: origine degli ID nel collector Reddit. Fetch e variabili
// d'ambiente sono simulati: nessuna chiamata reale, nessuna credenziale.
// I nomi dei campi Apify qui usati sono quelli già letti da lib/reddit.ts,
// non i campi ancora da confermare con la sonda (parentId, autore del post).

const URL_A = 'https://www.reddit.com/r/camping/comments/aaa111/slug_a/'
const URL_B = 'https://www.reddit.com/r/hiking/comments/bbb222/slug_b/'

async function withStubs<T>(apifyItems: Record<string, unknown[]>, run: () => Promise<T>): Promise<T> {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } }
  delete process.env.ANTHROPIC_API_KEY // traduzione: fallback alla keyword originale
  process.env.APIFY_TOKEN = 'test-token'
  process.env.SERPAPI_KEY = 'test-key'
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://serpapi.com/')) {
      return new Response(JSON.stringify({ organic_results: [{ link: URL_A, title: 'A' }, { link: URL_B, title: 'B' }] }))
    }
    if (url.startsWith('https://api.apify.com/')) {
      const target = JSON.parse(String(init?.body)).urls[0] as string
      return new Response(JSON.stringify(apifyItems[target] ?? []))
    }
    throw new Error(`fetch inatteso: ${url}`)
  }) as typeof fetch
  const log = console.log
  console.log = () => {}
  try {
    return await run()
  } finally {
    console.log = log
    globalThis.fetch = saved.fetch
    process.env = saved.env
  }
}

test('ID del collector e ID sintetici sono distinti da idSource', async () => {
  const data = await withStubs({
    [URL_A]: [
      { kind: 'post', id: 'aaa111', url: URL_A, title: 'A', body: 'text', subreddit: 'camping', score: 5, author: 'op_a' },
      { kind: 'comment', id: 'c1', postId: 'aaa111', parentId: 't3_aaa111', body: 'real id comment', author: 'u1', score: 3 },
      { kind: 'comment', postId: 'aaa111', parentId: 't1_c1', body: 'comment without id', author: 'u2', score: 2 },
    ],
    [URL_B]: [
      { kind: 'post', url: URL_B, title: 'B', body: '', subreddit: 'hiking', score: 1 },
      { kind: 'comment', id: 'c9', postId: 'bbb222', body: 'post id from url', author: 'u3', score: 1 },
    ],
  }, () => fetchRedditData('test keyword'))

  const a = data.posts.find(p => p.id === 'aaa111')!
  const b = data.posts.find(p => p.id === 'bbb222')!
  assert.equal(a.idSource, 'collector')
  assert.equal(b.idSource, 'url', 'ID ricavato dal link, non fornito dal collector')
  const real = a.comments.find(c => c.id === 'c1')!
  const synthetic = a.comments.find(c => c.body === 'comment without id')!
  assert.equal(real.idSource, 'collector')
  assert.equal(synthetic.idSource, 'synthetic')
  assert.match(synthetic.id, /^c_aaa111_\d+$/, 'formato sintetico legacy invariato')
  assert.equal(b.comments[0].idSource, 'collector')
  // Campi confermati dalla sonda reale (2026-11-03): author del post, parentId t3_/t1_.
  assert.equal(a.author, 'op_a')
  assert.equal(b.author, undefined, 'autore assente nel payload → campo assente')
  assert.equal(real.parentId, 't3_aaa111')
  assert.equal(synthetic.parentId, 't1_c1')
  assert.equal(b.comments[0].parentId, undefined)
})

// 9.0.2: autore YouTube da authorChannelId.value e canale del video, secondo la
// struttura confermata dalla sonda reale (2026-11-03). Fetch simulato.
test('YouTube: authorChannelId dal commento, channelId dal video, mai dal thread o dal display name', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.YOUTUBE_API_KEY }
  process.env.YOUTUBE_API_KEY = 'test-key'
  const recent = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const top = (id: string, text: string, author?: { value?: string }) => ({
    snippet: {
      channelId: 'UCvideoChannel0000000000', // canale del VIDEO, non dell'autore
      topLevelComment: {
        id,
        snippet: {
          channelId: 'UCvideoChannel0000000000', textOriginal: text, textDisplay: `<b>${text}</b>`,
          authorDisplayName: '@DisplayName', likeCount: 5, publishedAt: recent,
          ...(author ? { authorChannelId: author } : {}),
        },
      },
    },
  })
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/search?')) return new Response(JSON.stringify({ items: [{ id: { videoId: 'vid1' } }] }))
    if (url.includes('/videos?')) {
      return new Response(JSON.stringify({ items: [{ snippet: { title: 'T', channelId: 'UCvideoChannel0000000000' }, statistics: { viewCount: '10' } }] }))
    }
    if (url.includes('/commentThreads?')) {
      return new Response(JSON.stringify({ items: [
        top('Ugx1', 'comment with channel id', { value: 'UCauthor00000000000000a1' }),
        top('Ugx2', 'comment without channel id'),
        top('Ugx3', 'comment with empty channel id', { value: '  ' }),
      ] }))
    }
    throw new Error(`fetch inatteso: ${url}`)
  }) as typeof fetch
  const log = console.log
  console.log = () => {}
  try {
    const { fetchYouTubeData } = await import('./youtube')
    const data = await fetchYouTubeData('k', 'US', { classify: async () => null })
    const [video] = data.videos
    assert.equal(video.channelId, 'UCvideoChannel0000000000')
    const byId = new Map(video.comments.map(c => [c.id, c]))
    assert.equal(byId.get('Ugx1')!.authorChannelId, 'UCauthor00000000000000a1')
    assert.equal(byId.get('Ugx2')!.authorChannelId, undefined, 'mai ripiegare su snippet.channelId')
    assert.equal(byId.get('Ugx3')!.authorChannelId, undefined)
    assert.equal(byId.get('Ugx1')!.text, 'comment with channel id', 'resta textOriginal, non textDisplay')
    assert.ok(!JSON.stringify(data).includes('DisplayName'), 'display name mai letto')
  } finally {
    console.log = log
    globalThis.fetch = saved.fetch
    if (saved.key === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = saved.key
  }
})

test('D6: lo snapshot intermedio non conserva gli ID dei canali YouTube', async () => {
  const { stripYouTubeIdentifiers } = await import('./youtube')
  const input = {
    keyword: 'k', totalComments: 1, available: true, insufficientCorpus: false,
    videos: [{ id: 'v1', title: 'T', viewCount: 1, channelId: 'UCvideo', comments: [
      { id: 'Ugx1', text: 'hello', likeCount: 3, publishedAt: '2026-10-01', authorChannelId: 'UCauthor' }] }],
  }
  const before = JSON.stringify(input)
  const out = stripYouTubeIdentifiers(input)!
  assert.ok(!JSON.stringify(out).includes('UCauthor') && !JSON.stringify(out).includes('UCvideo'))
  assert.equal(out.videos[0].comments[0].text, 'hello', 'testi e metriche invariati')
  assert.equal(JSON.stringify(input), before, 'input non mutato')
  assert.equal(stripYouTubeIdentifiers(undefined), undefined)
})

test('YouTube: utilità del commento (euristica deterministica)', async () => {
  const { isUsefulComment, isValidComment } = await import('./youtube')
  const useless = [
    'Great video!', 'Thanks so much for this', 'First', 'Nice tutorial man, thanks',
    'Awesome content as always friend', 'Grazie mille, bravissimo davvero', 'Check out my channel for more recipes',
    'lol same here', '2:35',
  ]
  for (const t of useless) assert.equal(isUsefulComment(t), false, t)
  const useful = [
    'Thanks! But how long do these jars last without a fridge?',
    'I tried this twice and the rice was still crunchy in the middle',
    'Great video but the portions are way too small for two adults',
    'I wish there was a version without dehydrated milk, my son is allergic',
    'Non riesco a capire quanta acqua aggiungere per ogni barattolo',
  ]
  for (const t of useful) assert.equal(isUsefulComment(t), true, t)
  assert.equal(isValidComment('see www.example.com for the recipe list here'), false)
  assert.equal(isValidComment('🔥🔥🔥 !!!'), false)
})

test('YouTube: risposte incluse con parentId, niente minimo di like, ordine per thread', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.YOUTUBE_API_KEY }
  process.env.YOUTUBE_API_KEY = 'test-key'
  const recent = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const old = new Date(Date.now() - 40 * 30 * 86_400_000).toISOString() // ~40 mesi: oltre il limite di 36
  const c = (id: string, text: string, likeCount: number, publishedAt = recent, parentId?: string) => ({
    id, snippet: { textOriginal: text, likeCount, publishedAt, ...(parentId ? { parentId } : {}), authorChannelId: { value: `UC_${id}` } },
  })
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/search?')) return new Response(JSON.stringify({ items: [{ id: { videoId: 'vid1' } }] }))
    if (url.includes('/videos?')) return new Response(JSON.stringify({ items: [{ snippet: { title: 'T', channelId: 'UCv' }, statistics: { viewCount: '10' } }] }))
    if (url.includes('/commentThreads?')) {
      assert.ok(url.includes('part=snippet,replies'), 'richiede anche le risposte')
      return new Response(JSON.stringify({ items: [
        { snippet: { topLevelComment: c('A', 'The rice stays crunchy no matter how long I wait', 0) },
          replies: { comments: [c('A.r2', 'Thanks!', 1, recent, 'A'), c('A.r1', 'Same problem here, I had to add boiling water twice', 0, recent, 'A')] } },
        { snippet: { topLevelComment: c('B', 'Great video!', 50) },
          replies: { comments: [c('B.r1', 'Does anyone know how long these keep in a hot car?', 2, recent, 'B')] } },
        { snippet: { topLevelComment: c('C', 'This recipe never worked for me at altitude', 9, old) } },
      ] }))
    }
    throw new Error(`fetch inatteso: ${url}`)
  }) as typeof fetch
  const log = console.log
  console.log = () => {}
  try {
    const { fetchYouTubeData } = await import('./youtube')
    const data = await fetchYouTubeData('k', 'US', { classify: async () => null })
    const ids = data.videos[0].comments.map(x => x.id)
    // B (50 like) ordinato per primo ma scartato perché generico; la sua risposta utile resta.
    assert.deepEqual(ids, ['B.r1', 'A', 'A.r1'])
    const reply = data.videos[0].comments.find(x => x.id === 'A.r1')!
    assert.equal(reply.parentId, 'A')
    assert.equal(data.videos[0].comments.find(x => x.id === 'A')!.parentId, undefined)
    assert.equal(data.totalComments, 3)
  } finally {
    console.log = log
    globalThis.fetch = saved.fetch
    if (saved.key === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = saved.key
  }
})

test('Reddit labrat011: adattamento al formato del collector, parentId solo per depth 0', async () => {
  const { adaptLabratItems } = await import('./reddit')
  const out = adaptLabratItems([
    { type: 'post', id: 'abc1234', title: 'T', selftext: 'body', author: 'op', score: 3, subreddit: 'camping', created: '2026-05-01T10:00:00Z', url: 'https://www.reddit.com/r/camping/comments/abc1234/t/' },
    { type: 'comment', id: 'c000001', postId: 'abc1234', body: 'top level', author: 'u1', score: 2, subreddit: 'camping', created: '2026-05-02T10:00:00Z', depth: 0 },
    { type: 'comment', id: 'c000002', postId: 't3_abc1234', body: 'nested', author: 'u2', score: 1, subreddit: 'camping', created: 1777777777, depth: 1 },
    { type: 'other', id: 'x' },
  ])
  assert.equal(out.length, 3)
  assert.deepEqual(
    { kind: out[0].kind, id: out[0].id, body: out[0].body, author: out[0].author },
    { kind: 'post', id: 'abc1234', body: 'body', author: 'op' },
  )
  assert.equal(out[1].kind, 'comment')
  assert.equal(out[1].postId, 'abc1234')
  assert.equal(out[1].parentId, 't3_abc1234')
  assert.equal(out[2].postId, 'abc1234', 'prefisso t3_ rimosso')
  assert.equal(out[2].parentId, undefined, 'genitore delle risposte annidate non ricostruito')
  assert.match(String(out[2].created_utc), /^\d{4}-\d{2}-\d{2}T/, 'epoch convertito in ISO')
})

test('Reddit: labrat011 per primo, fatihtahta solo come riserva', async () => {
  const { fetchSinglePost } = await import('./reddit')
  let fallbackCalls = 0
  const fallback = async () => { fallbackCalls++; return { items: [{ kind: 'post' }], success: true } }
  const ok = await fetchSinglePost('u', 't', { primary: async () => ({ items: [{ kind: 'post' }, { kind: 'comment' }], success: true }), fallback })
  assert.equal(ok.items.length, 2)
  assert.equal(fallbackCalls, 0)
  const fb = await fetchSinglePost('u', 't', { primary: async () => ({ items: [], success: false }), fallback })
  assert.equal(fb.success, true)
  assert.equal(fallbackCalls, 1)
})

test('Reddit end-to-end: dati labrat011 → RedditData con autore del post e parentId', async () => {
  const items = [
    { type: 'post', id: 'aaa111', title: '', selftext: 'post text here', author: 'op_a', score: 5, subreddit: 'camping', created: '2026-05-01T10:00:00Z', url: URL_A },
    { type: 'comment', id: 'k1', postId: 'aaa111', body: 'top level comment text', author: 'u1', score: 3, subreddit: 'camping', created: '2026-05-02T10:00:00Z', depth: 0 },
    { type: 'comment', id: 'k2', postId: 'aaa111', body: 'nested reply text', author: 'u2', score: 1, subreddit: 'camping', created: '2026-05-03T10:00:00Z', depth: 1 },
  ]
  const saved = { fetch: globalThis.fetch, env: { ...process.env } }
  delete process.env.ANTHROPIC_API_KEY
  process.env.APIFY_TOKEN = 'test-token'
  process.env.SERPAPI_KEY = 'test-key'
  let fatihtahtaCalls = 0
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://serpapi.com/')) return new Response(JSON.stringify({ organic_results: [{ link: URL_A, title: 'Camping meals : r/camping - Reddit' }] }))
    if (url.includes('/acts/labrat011~reddit-scraper/runs')) {
      if (JSON.parse(String(init?.body)).mode === 'search') return new Response(JSON.stringify({ data: { id: 's', status: 'SUCCEEDED', defaultDatasetId: 'dsEmpty' } }))
      assert.deepEqual(JSON.parse(String(init?.body)).postUrls, [URL_A])
      return new Response(JSON.stringify({ data: { id: 'r1', status: 'SUCCEEDED', defaultDatasetId: 'ds1' } }))
    }
    if (url.includes('/datasets/ds1/items')) return new Response(JSON.stringify(items))
    if (url.includes('/datasets/dsEmpty/items')) return new Response('[]')
    if (url.includes('fatihtahta')) { fatihtahtaCalls++; return new Response('[]') }
    throw new Error(`fetch inatteso: ${url}`)
  }) as typeof fetch
  const log = console.log
  console.log = () => {}
  try {
    const data = await fetchRedditData('k')
    assert.equal(fatihtahtaCalls, 0, 'riserva non usata se labrat011 restituisce dati')
    const post = data.posts.find(p => p.id === 'aaa111')!
    assert.equal(post.author, 'op_a')
    assert.equal(post.title, 'Camping meals', 'titolo vuoto di labrat sostituito da quello di Google')
    assert.equal(post.selftext, 'post text here')
    assert.deepEqual(post.comments.map(c => [c.id, c.parentId]), [['k1', 't3_aaa111'], ['k2', undefined]])
    assert.equal(post.comments[0].month, '2026-05')
    assert.equal(data.available, true)
  } finally {
    console.log = log
    globalThis.fetch = saved.fetch
    process.env = saved.env
  }
})

test('Reddit: titolo dal risultato Google quando labrat011 lo restituisce vuoto', async () => {
  const { cleanGoogleRedditTitle } = await import('./reddit')
  assert.equal(cleanGoogleRedditTitle('No cook ideas : r/EatCheapAndHealthy - Reddit'), 'No cook ideas')
  assert.equal(cleanGoogleRedditTitle('Dehydrated meals advice - r/backpacking'), 'Dehydrated meals advice')
  assert.equal(cleanGoogleRedditTitle('Plain title'), 'Plain title')
})

test('Reddit: testi [deleted] sospetti in labrat011 → prova fatihtahta e tiene il più leggibile', async () => {
  const { fetchSinglePost, hasSuspectDeletedBodies } = await import('./reddit')
  const c = (body: string, author = 'someone') => ({ kind: 'comment', body, author })
  const suspect = [{ kind: 'post' }, c('[deleted]'), c('[deleted]'), c('real text'), c('[deleted]', '[deleted]')]
  assert.equal(hasSuspectDeletedBodies(suspect), true)
  assert.equal(hasSuspectDeletedBodies([{ kind: 'post' }, c('a'), c('b'), c('[deleted]', '[deleted]')]), false, 'cancellazioni vere: autore [deleted]')
  const log = console.log
  console.log = () => {}
  try {
    const better = { items: [{ kind: 'post' }, c('one'), c('two'), c('three')], success: true }
    const picked = await fetchSinglePost('u', 't', { primary: async () => ({ items: suspect, success: true }), fallback: async () => better })
    assert.equal(picked, better)
    const worse = { items: [], success: false }
    const kept = await fetchSinglePost('u', 't', { primary: async () => ({ items: suspect, success: true }), fallback: async () => worse })
    assert.equal(kept.items, suspect, 'se la riserva non dà di più resta labrat011')
  } finally { console.log = log }
})

test('Reddit b: la ricerca interna di Reddit aggiunge discussioni che Google non trova', async () => {
  const saved = { fetch: globalThis.fetch, env: { ...process.env } }
  delete process.env.ANTHROPIC_API_KEY
  process.env.APIFY_TOKEN = 'test-token'
  process.env.SERPAPI_KEY = 'test-key'
  const bodies: Record<string, unknown>[] = []
  const thread = (id: string, url: string) => [
    { type: 'post', id, title: `T ${id}`, selftext: 'post text', author: 'op', score: 1, subreddit: 'camping', created: '2026-05-01T10:00:00Z', url },
    { type: 'comment', id: `${id}c`, postId: id, body: `a real comment in ${id}`, author: 'u', score: 1, subreddit: 'camping', created: '2026-05-02T10:00:00Z', depth: 0 },
  ]
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://serpapi.com/')) return new Response(JSON.stringify({ organic_results: [{ link: URL_A, title: 'A' }] }))
    if (url.includes('/acts/labrat011~reddit-scraper/runs')) {
      const body = JSON.parse(String(init?.body))
      bodies.push(body)
      const ds = body.mode === 'search' ? 'dsSearch' : (body.postUrls[0] === URL_A ? 'dsA' : 'dsB')
      return new Response(JSON.stringify({ data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: ds } }))
    }
    if (url.includes('/datasets/dsSearch/items')) return new Response(JSON.stringify([{ type: 'post', id: 'bbb222', url: URL_B, title: '' }]))
    if (url.includes('/datasets/dsA/items')) return new Response(JSON.stringify(thread('aaa111', URL_A)))
    if (url.includes('/datasets/dsB/items')) return new Response(JSON.stringify(thread('bbb222', URL_B)))
    if (url.includes('fatihtahta')) return new Response('[]')
    throw new Error(`fetch inatteso: ${url}`)
  }) as typeof fetch
  const log = console.log
  console.log = () => {}
  try {
    const data = await fetchRedditData('just add water meals')
    const search = bodies.find(b => b.mode === 'search')!
    assert.equal(search.searchQuery, '"just add water meals"', 'keyword tra virgolette')
    assert.equal(search.maxResults, 25)
    assert.deepEqual(data.posts.map(p => p.id).sort(), ['aaa111', 'bbb222'], 'Google + ricerca Reddit')
  } finally {
    console.log = log
    globalThis.fetch = saved.fetch
    process.env = saved.env
  }
})

test('Reddit a: frasi fuori tema scartate, frasi salvate e riusate per la stessa keyword', async () => {
  const { filterQueriesByKeyword, getRedditQueries } = await import('./reddit')
  const generated = ['camping food that needs water', 'easy meals for busy people', 'quick dinner ideas no cooking',
    'backpacking meals that rehydrate', 'what to eat when lazy']
  assert.deepEqual(filterQueriesByKeyword(generated, 'just add water meals'),
    ['camping food that needs water', 'easy meals for busy people', 'backpacking meals that rehydrate'])
  assert.deepEqual(filterQueriesByKeyword(['a b c', 'd e f'], 'just add water meals'), ['a b c', 'd e f'], 'mai meno di 2: si tengono tutte')

  const store = new Map<string, string[]>()
  let translations = 0
  const deps = {
    translate: async () => { translations++; return generated },
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string[]) => { store.set(k, v); return true },
  }
  const log = console.log
  console.log = () => {}
  try {
    const first = await getRedditQueries('Just Add Water Meals', deps)
    const second = await getRedditQueries('just add water meals ', deps)
    assert.deepEqual(first, second, 'stesse frasi alla seconda analisi')
    assert.equal(translations, 1, 'una sola traduzione AI')
    assert.ok(store.has('reddit:queries:v1:just add water meals'))
    await getRedditQueries('other keyword', { ...deps, translate: async () => ['other keyword'] })
    assert.ok(!store.has('reddit:queries:v1:other keyword'), 'il ripiego sulla sola keyword non si salva')
  } finally { console.log = log }
})
