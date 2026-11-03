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
    const data = await fetchYouTubeData('k')
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
