import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { buildUsefulnessPrompt, classifyUsefulComments, USEFULNESS_MODEL } from './youtube-usefulness'

// Client Anthropic simulato: nessuna chiamata reale, nessuna chiave.
function fakeClient(reply: (params: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = []
  const client = { messages: { create: async (params: Record<string, unknown>) => { calls.push(params); return reply(params) } } }
  return { client: client as unknown as Anthropic, calls }
}
const text = (t: string, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: t }] })
const COMMENTS = [
  { id: 'Ugx1', text: 'The rice is always crunchy, how long should it soak?' },
  { id: 'Ugx2', text: 'We need these videos 🎉' },
  { id: 'Ugx3', text: 'I add powdered milk and it clumps every time' },
]

test('classificazione: alias mappati agli ID, alias inventati ignorati, richiesta vincolata', async () => {
  const { client, calls } = fakeClient(() => text(JSON.stringify({ useful_ids: ['c1', 'c3', 'c99', 'x', 7] })))
  const res = await classifyUsefulComments('just add water meals', COMMENTS, client)
  assert.deepEqual([...res!].sort(), ['Ugx1', 'Ugx3'])
  const req = calls[0] as { model: string; output_config: { effort: string; format: { type: string } }; messages: { content: string }[] }
  assert.equal(req.model, USEFULNESS_MODEL)
  assert.equal(req.output_config.effort, 'low')
  assert.equal(req.output_config.format.type, 'json_schema')
  assert.ok(req.messages[0].content.includes('c2: We need these videos'))
  assert.ok(!req.messages[0].content.includes('Ugx'), 'nessun ID YouTube nel prompt')
})

test('fail-open: rifiuto, troncamento, JSON non valido, errore, nessuna chiave → null', async () => {
  for (const reply of [
    () => text('{}', 'refusal'),
    () => text('{"useful_ids": ["c1"', 'max_tokens'),
    () => text('not json'),
    () => text('{"other": []}'),
    () => { throw new Error('timeout') },
  ]) {
    const log = console.log
    console.log = () => {}
    try { assert.equal(await classifyUsefulComments('k', COMMENTS, fakeClient(reply).client), null) } finally { console.log = log }
  }
  assert.equal(await classifyUsefulComments('k', COMMENTS, null), null)
  assert.equal(await classifyUsefulComments('k', [], fakeClient(() => text('{"useful_ids":[]}')).client), null)
})

test('prompt: testo troncato a 300 caratteri e su una riga', () => {
  const p = buildUsefulnessPrompt('k', [{ id: 'a', text: `line one\nline two ${'x'.repeat(400)}` }])
  const line = p.split('\n').find(l => l.startsWith('c1: '))!
  assert.ok(line.length <= 'c1: '.length + 300)
  assert.ok(line.startsWith('c1: line one line two'))
})

test('fetchYouTubeData: tiene solo i commenti utili per l\'AI, altrimenti l\'euristica', async () => {
  const saved = { fetch: globalThis.fetch, key: process.env.YOUTUBE_API_KEY }
  process.env.YOUTUBE_API_KEY = 'test-key'
  const recent = new Date(Date.now() - 86_400_000).toISOString()
  const top = (id: string, t: string) => ({ snippet: { topLevelComment: { id, snippet: { textOriginal: t, likeCount: 1, publishedAt: recent } } } })
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/search?')) return new Response(JSON.stringify({ items: [{ id: { videoId: 'v1' } }] }))
    if (url.includes('/videos?')) return new Response(JSON.stringify({ items: [{ snippet: { title: 'T' }, statistics: { viewCount: '1' } }] }))
    if (url.includes('/commentThreads?')) return new Response(JSON.stringify({ items: COMMENTS.map(c => top(c.id, c.text)) }))
    throw new Error(url)
  }) as typeof fetch
  const log = console.log
  console.log = () => {}
  try {
    const { fetchYouTubeData } = await import('./youtube')
    let seen = 0
    const ai = await fetchYouTubeData('k', 'US', { classify: async (_k, c) => { seen = c.length; return new Set(['Ugx1', 'Ugx3']) } })
    assert.equal(seen, 3, 'l\'euristica ha già scartato nulla di questi tre')
    assert.deepEqual(ai.videos[0].comments.map(c => c.id), ['Ugx1', 'Ugx3'])
    assert.deepEqual(ai.usefulnessFilter, { method: 'ai', model: USEFULNESS_MODEL, evaluated: 3, kept: 2 })
    const fallback = await fetchYouTubeData('k', 'US', { classify: async () => null })
    assert.equal(fallback.videos[0].comments.length, 3)
    assert.equal(fallback.usefulnessFilter?.method, 'heuristic')
  } finally {
    console.log = log
    globalThis.fetch = saved.fetch
    if (saved.key === undefined) delete process.env.YOUTUBE_API_KEY
    else process.env.YOUTUBE_API_KEY = saved.key
  }
})
