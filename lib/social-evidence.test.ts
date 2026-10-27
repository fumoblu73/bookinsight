import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSocialManifest } from './social-corpus'
import { attributionBatches, aggregateSocialEvidence, promptSocialAttribution, runSocialAttribution } from './social-attribution'
import { promptPainPointsReddit } from './prompts'
import { fetchRedditData } from './reddit'
import { fetchYouTubeData } from './youtube'
import type { PainPoint, RedditComment, RedditData, SocialCorpusManifest, YouTubeData } from './types'

function comment(id: string, author = 'alice', body = 'I cannot rehydrate these meals evenly.'): RedditComment {
  return { id, author, body, score: 5, createdUtc: 1, month: '1970-01' }
}
function reddit(groups: RedditComment[][]): RedditData {
  return {
    keyword: 'meals', available: true, insufficientCorpus: true,
    totalComments: groups.reduce((n, g) => n + g.length, 0), threadCount: groups.length, subredditsUsed: ['camping'],
    posts: groups.map((comments, i) => ({
      id: `p${i}`, title: 'Meals discussion', selftext: 'How can I rehydrate meals evenly?', score: 5,
      subreddit: 'camping', createdUtc: 1, month: '1970-01', comments,
      link: `https://www.reddit.com/r/camping/comments/p${i}/meals/`,
    })),
  }
}
function pain(id = 'pain1', fonte: PainPoint['fonte'] = 'reddit'): PainPoint {
  return { id, fonte, pain_point: 'Reidratazione irregolare', F: 3, I: 7, score: 4.3, solvibilita: 'affrontabile', evidence: 'legacy' }
}
function allDirect(manifest: SocialCorpusManifest, pains = [pain()]) {
  const batches = attributionBatches(manifest, pains)
  return aggregateSocialEvidence(manifest, pains, batches.map(batch => ({ batch, output: {
    decisions: batch.records.map(r => ({ recordId: r.recordId, matches: batch.painPoints.map(p => ({
      painPointId: p.id, supportType: 'direct', quote: r.transmittedText, contextRecordIds: [],
    })) })),
  } })))
}

test('U/T/M: autori, contenitori e commenti sono tre dimensioni indipendenti', () => {
  for (const [groups, expected] of [
    [[[comment('c1'), comment('c2', 'bob')]], [2, 1, 2]],
    [[[comment('c1'), comment('c2'), comment('c3')]], [1, 1, 3]],
    [[[comment('c1')], [comment('c2')]], [1, 2, 2]],
  ] as const) {
    const result = allDirect(buildSocialManifest(reddit(groups.map(g => [...g])))).metrics.pain1
    assert.deepEqual([result.U, result.T, result.M], expected)
    assert.deepEqual(result.completeness, { U: true, T: true, M: true })
  }
})

test('duplicato Reddit deduplicato; stesso testo con ID distinti rimane separato', () => {
  const manifest = buildSocialManifest(reddit([[comment('c1'), comment('t1_c1'), comment('c2', 'bob')]]))
  assert.equal(manifest.records.length, 2)
  assert.equal(manifest.records.every(r => r.possibleCopy), true)
  assert.equal(allDirect(manifest).metrics.pain1.M, 2)
})

test('autori cancellati o mancanti non diventano utenti inventati', () => {
  const result = allDirect(buildSocialManifest(reddit([[comment('c1', '[deleted]'), comment('c2', ''), comment('c3')]])))
  const metrics = result.metrics.pain1
  assert.deepEqual([metrics.U, metrics.T, metrics.M, metrics.unknownAuthorMentions], [1, 1, 3, 2])
  assert.deepEqual(metrics.completeness, { U: false, T: true, M: true })
})

test('ID sintetici restano evidenze incerte; permalink originale può recuperare l’identità', () => {
  const synthetic = comment('c_p0_0')
  synthetic.provenance = { idStatus: 'synthetic', containerId: 'p0' }
  const data = reddit([[synthetic]])
  let result = allDirect(buildSocialManifest(data))
  assert.deepEqual([result.metrics.pain1.U, result.metrics.pain1.T, result.metrics.pain1.M], [0, 0, 0])
  assert.equal(result.metrics.pain1.uncertainIdentityMentions, 1)
  synthetic.provenance.commentUrl = '/r/camping/comments/p0/meals/c1/'
  result = allDirect(buildSocialManifest(data))
  assert.equal(result.metrics.pain1.M, 1)
  assert.equal(result.manifest.records[0].commentUrlOrigin, 'received')
})

test('un ID duplicato con autore o testo incompatibili è escluso, anche se il preparatore tiene solo la prima copia', () => {
  const manifest = buildSocialManifest(reddit([[comment('c1'), comment('c1', 'bob', 'Another text entirely.')]]))
  assert.equal(manifest.records.length, 1)
  assert.equal(manifest.records[0].identityStatus, 'conflict')
  assert.equal(allDirect(manifest).metrics.pain1.uncertainIdentityMentions, 1)
})

test('manifest: stessi estratti e gate del prompt, nessuna mutazione, code troncate e selftext solo contesto', () => {
  const data = reddit([Array.from({ length: 40 }, (_, i) => comment(`c${i}`, 'alice', `Body ${i} ` + 'A'.repeat(350)))])
  data.posts[0].selftext = 'B'.repeat(450)
  const before = JSON.stringify(data)
  const manifest = buildSocialManifest(data)
  const prompt = promptPainPointsReddit(data.keyword, data)
  assert.equal(manifest.records.length, 30)
  assert.equal(manifest.contexts[0].transmittedText.length, 400)
  for (const r of manifest.records) { assert.equal(r.transmittedText.length, 300); assert.ok(prompt.includes(r.transmittedText)); assert.equal(r.truncated, true) }
  assert.equal(JSON.stringify(data), before)
  assert.equal(manifest.records.some(r => r.recordId.includes('selftext')), false)
})

test('la pulizia Unicode coincide con il wrapper AI', () => {
  const data = reddit([[comment('c1', 'alice', 'A'.repeat(299) + '😀TAIL')]])
  const record = buildSocialManifest(data).records[0]
  assert.equal(record.transmittedText, 'A'.repeat(299))
  assert.equal(record.text.endsWith('TAIL'), true)
})

test('citazione inventata o proveniente dalla coda non trasmessa viene rifiutata', () => {
  const manifest = buildSocialManifest(reddit([[comment('c1', 'alice', 'A'.repeat(300) + 'OMITTED_TAIL')]]))
  const batch = attributionBatches(manifest, [pain()])[0]
  for (const quote of ['inventata', 'OMITTED_TAIL']) {
    const output = { decisions: [{ recordId: batch.records[0].recordId, matches: [{ painPointId: 'pain1', supportType: 'direct', quote, contextRecordIds: [] }] }] }
    const result = aggregateSocialEvidence(manifest, [pain()], [{ batch, output }])
    assert.equal(result.associations.length, 0)
    assert.equal(result.metrics.pain1.rejectedAssociations, 1)
    assert.equal(result.metrics.pain1.M, null)
  }
})

test('stesso commento con più citazioni conta una sola volta per ciascun pain point', () => {
  const manifest = buildSocialManifest(reddit([[comment('c1')]]))
  const pains = [pain(), pain('pain2')]
  const batch = attributionBatches(manifest, pains)[0]
  const match = (id: string, quote: string) => ({ painPointId: id, supportType: 'direct', quote, contextRecordIds: [] })
  const result = aggregateSocialEvidence(manifest, pains, [{ batch, output: { decisions: [{ recordId: batch.records[0].recordId,
    matches: [match('pain1', 'rehydrate'), match('pain1', 'evenly'), match('pain2', 'meals')],
  }] } }])
  assert.equal(result.associations.length, 2)
  assert.equal(result.metrics.pain1.M, 1)
  assert.equal(result.metrics.pain2.M, 1)
})

test('conferme: padre esplicito validato, stesso autore e rifiuto dei contesti inventati', () => {
  const child = comment('c2', 'bob', 'Same here!')
  child.provenance = { originalId: 'c2', idStatus: 'original', parentId: 't1_c1', containerId: 'p0' }
  const data = reddit([[comment('c1'), child]])
  const manifest = buildSocialManifest(data)
  const batch = attributionBatches(manifest, [pain()])[0]
  const [a, b] = batch.records
  const output = (supportType: string, contextRecordIds: string[]) => ({ decisions: [
    { recordId: a.recordId, matches: [{ painPointId: 'pain1', supportType: 'direct', quote: a.transmittedText, contextRecordIds: [] }] },
    { recordId: b.recordId, matches: [{ painPointId: 'pain1', supportType, quote: b.transmittedText, contextRecordIds }] },
  ] })
  const valid = aggregateSocialEvidence(manifest, [pain()], [{ batch, output: output('confirmation', [a.recordId]) }])
  assert.deepEqual([valid.metrics.pain1.U, valid.metrics.pain1.T, valid.metrics.pain1.M], [2, 1, 2])
  for (const invalid of [output('direct', []), output('confirmation', ['invented']), output('confirmation', [batch.context.contextId])]) {
    const result = aggregateSocialEvidence(manifest, [pain()], [{ batch, output: invalid }])
    assert.equal(result.metrics.pain1.M, 1)
    assert.equal(result.metrics.pain1.ambiguousConfirmations, 1)
  }
})

test('conferma al post padre e cicli di conferme senza testimonianza diretta', () => {
  const one = comment('c1', 'alice', 'Same here!')
  const two = comment('c2', 'bob', 'Exactly!')
  one.provenance = { originalId: 'c1', idStatus: 'original', parentId: 't3_p0' }
  let manifest = buildSocialManifest(reddit([[one]]))
  let batch = attributionBatches(manifest, [pain()])[0]
  let result = aggregateSocialEvidence(manifest, [pain()], [{ batch, output: { decisions: [{ recordId: batch.records[0].recordId,
    matches: [{ painPointId: 'pain1', supportType: 'confirmation', quote: one.body, contextRecordIds: [batch.context.contextId] }],
  }] } }])
  assert.equal(result.metrics.pain1.M, 1)
  one.provenance.parentId = 't1_c2'
  two.provenance = { originalId: 'c2', idStatus: 'original', parentId: 't1_c1' }
  manifest = buildSocialManifest(reddit([[one, two]])); batch = attributionBatches(manifest, [pain()])[0]
  result = aggregateSocialEvidence(manifest, [pain()], [{ batch, output: { decisions: batch.records.map(r => ({ recordId: r.recordId,
    matches: [{ painPointId: 'pain1', supportType: 'confirmation', quote: r.transmittedText, contextRecordIds: [r.parentRecordId] }],
  })) } }])
  assert.equal(result.metrics.pain1.M, null)
  assert.equal(result.metrics.pain1.uncertainComments, 2)
  assert.equal(result.metrics.pain1.status, 'partial')
  assert.equal(result.metrics.pain1.ambiguousConfirmations, 2)
})

test('batching: nessuna omissione equivale a zero; timeout e guasti sono espliciti', async () => {
  const manifest = buildSocialManifest(reddit([[comment('c1')], [comment('c2')]]))
  let calls = 0
  const result = await runSocialAttribution(manifest, [pain()], async prompt => {
    if (calls++) throw new Error('batch failure')
    const data = JSON.parse(prompt.split('DATI:\n')[1])
    return { decisions: data.recordsToReview.map((r: { recordId: string }) => ({ recordId: r.recordId, matches: [] })) }
  }, { concurrency: 1 })
  assert.equal(result.metrics.pain1.status, 'partial')
  assert.equal(result.metrics.pain1.reviewedComments, 1)
  assert.equal(result.metrics.pain1.M, 0)
  const timedOut = await runSocialAttribution(manifest, [pain()], async () => new Promise(() => {}), { timeoutMs: 10 })
  assert.equal(timedOut.metrics.pain1.status, 'failed')
  assert.equal(timedOut.metrics.pain1.M, null)
})

test('un thread lungo è suddiviso senza perdere o riesaminare commenti e mantiene il contesto', async () => {
  const manifest = buildSocialManifest(reddit([Array.from({ length: 30 }, (_, i) => comment(`c${i}`))]))
  const batches = attributionBatches(manifest, [pain()])
  assert.ok(batches.length > 1)
  const reviewed: string[] = []
  const result = await runSocialAttribution(manifest, [pain()], async prompt => {
    const data = JSON.parse(prompt.split('DATI:\n')[1])
    assert.equal(data.background.length, 30)
    const records = data.recordsToReview as { recordId: string }[]
    reviewed.push(...records.map(r => r.recordId))
    return { decisions: records.map(r => ({ recordId: r.recordId, matches: [] })) }
  })
  assert.deepEqual([...reviewed].sort(), manifest.records.map(r => r.recordId).sort())
  assert.equal(new Set(reviewed).size, 30)
  assert.equal(result.metrics.pain1.status, 'complete')
  assert.equal(result.metrics.pain1.reviewedComments, 30)
})

test('output malformati, ID inventati e decisioni duplicate non diventano conteggi completi', () => {
  const manifest = buildSocialManifest(reddit([[comment('c1')]]))
  const batch = attributionBatches(manifest, [pain()])[0]
  const valid = { recordId: batch.records[0].recordId, matches: [] }
  for (const output of [null, [], { decisions: [] }, { decisions: [valid, valid] }, { decisions: [{ recordId: 'invented', matches: [] }] }, { decisions: [{ ...valid, matches: [null] }] }]) {
    const result = aggregateSocialEvidence(manifest, [pain()], [{ batch, output }])
    assert.equal(result.metrics.pain1.M, null)
    assert.notEqual(result.metrics.pain1.status, 'complete')
  }
})

test('annullamento della finalizzazione interrompe il passaggio opzionale e i nuovi batch', async () => {
  const manifest = buildSocialManifest(reddit([[comment('c1')], [comment('c2')]]))
  const controller = new AbortController()
  let calls = 0
  const pending = runSocialAttribution(manifest, [pain()], async (_prompt, signal) => {
    calls++
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  }, { signal: controller.signal, concurrency: 1 })
  controller.abort()
  const result = await pending
  assert.equal(calls, 1)
  assert.equal(result.metrics.pain1.M, null)
})

test('YouTube: deduplica commenti, identità account e gate da 25 invariato', () => {
  const youtube: YouTubeData = { keyword: 'meals', available: true, insufficientCorpus: false, totalComments: 2, videos: [{
    id: 'video1', title: 'Meals', viewCount: 10, comments: [{
      id: 'UgComment1', text: 'I cannot rehydrate these meals evenly.', likeCount: 5, publishedAt: '2026-10-01',
      provenance: { originalId: 'UgComment1', idStatus: 'original', containerId: 'video1', authorId: 'UCAccount', authorName: 'Alice' },
    }],
  }] }
  youtube.videos[0].comments.push({ ...youtube.videos[0].comments[0] })
  let manifest = buildSocialManifest(reddit([[comment('c1', 'Alice')]]), youtube)
  const result = allDirect(manifest, [pain(), pain('yt', 'youtube')])
  assert.equal(result.metrics.yt.M, 1)
  assert.equal(result.metrics.yt.U, 1)
  assert.notEqual(manifest.records[0].authorKey, manifest.records[1].authorKey)
  assert.match(manifest.records[1].commentUrl!, /watch\?v=video1&lc=UgComment1/)
  youtube.insufficientCorpus = true
  manifest = buildSocialManifest(reddit([]), youtube)
  assert.equal(manifest.records.length, 0)
})

test('prompt supplementare non include score o identità degli autori', () => {
  const manifest = buildSocialManifest(reddit([[comment('c1', 'privateusername')]]))
  const prompt = promptSocialAttribution(attributionBatches(manifest, [pain()])[0])
  assert.ok(!prompt.includes('privateusername'))
  assert.ok(!prompt.includes('"F":'))
  assert.ok(!prompt.includes('"score":'))
})

test('YouTube: ID canale disponibile identifica l’autore anche con nome visualizzato [deleted]', () => {
  const youtube: YouTubeData = {
    keyword: 'meals', available: true, insufficientCorpus: false, totalComments: 3,
    videos: [{ id: 'video1', title: 'Meals', viewCount: 10, comments: [
      { id: 'Ug1', text: 'I cannot rehydrate meals.', likeCount: 5, publishedAt: '2026-10-01',
        provenance: { originalId: 'Ug1', idStatus: 'original', authorId: 'UCAccountA', authorName: '[deleted]' } },
      { id: 'Ug2', text: 'My meals remain dry.', likeCount: 5, publishedAt: '2026-10-01',
        provenance: { originalId: 'Ug2', idStatus: 'original', authorId: 'UCAccountB', authorName: '[deleted]' } },
      { id: 'Ug3', text: 'Uneven hydration is a problem.', likeCount: 5, publishedAt: '2026-10-01',
        provenance: { originalId: 'Ug3', idStatus: 'original', authorName: '[deleted]' } },
    ] }],
  }
  const result = allDirect(buildSocialManifest(reddit([]), youtube), [pain('yt', 'youtube')])
  assert.deepEqual([result.metrics.yt.U, result.metrics.yt.T, result.metrics.yt.M], [2, 1, 3])
  assert.equal(result.metrics.yt.unknownAuthorMentions, 1)
  assert.deepEqual(result.manifest.records.map(r => r.authorStatus), ['identified', 'identified', 'deleted'])
})

test('Reddit: il prefisso di un post non può diventare un ID commento e viceversa', () => {
  const wrongComment = buildSocialManifest(reddit([[comment('t3_c1')]]))
  assert.equal(allDirect(wrongComment).metrics.pain1.M, 0)
  assert.equal(allDirect(wrongComment).metrics.pain1.uncertainIdentityMentions, 1)
  const data = reddit([[comment('c1')]])
  data.posts[0].id = 't1_p0'
  delete data.posts[0].link
  const wrongThread = buildSocialManifest(data)
  assert.equal(allDirect(wrongThread).metrics.pain1.T, 0)
  assert.equal(allDirect(wrongThread).metrics.pain1.uncertainIdentityMentions, 1)
})

test('collector simulati preservano metadati senza cambiare selezione o raccogliere risposte YouTube', async t => {
  for (const name of ['APIFY_TOKEN', 'SERPAPI_KEY', 'YOUTUBE_API_KEY'] as const) {
    const previous = process.env[name]
    process.env[name] = 'test-only'
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous })
  }
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const url = String(input); calls.push(url)
    let body: unknown
    if (url.includes('api.anthropic.com')) body = { content: [{ text: '["camp meals"]' }] }
    else if (url.includes('serpapi.com')) body = { organic_results: [{ link: 'https://www.reddit.com/r/camping/comments/p0/meals/' }] }
    else if (url.includes('api.apify.com')) body = [
      { kind: 'post', id: 'p0', url: 'https://www.reddit.com/r/camping/comments/p0/meals/', body: 'Meals', title: 'Meals', score: 1 },
      { kind: 'comment', id: 'c1', postId: 'p0', parent_id: 't3_p0', author: 'alice', body: 'A real problem with meals', score: 3, permalink: '/r/camping/comments/p0/meals/c1/' },
      { kind: 'comment', postId: 'p0', author: '[deleted]', body: 'Another real problem', score: 2 },
    ]
    else if (url.includes('/search?')) body = { items: [{ id: { videoId: 'video1' } }] }
    else if (url.includes('/videos?')) body = { items: [{ snippet: { title: 'Meals' }, statistics: { viewCount: '50' } }] }
    else if (url.includes('/commentThreads?')) body = { items: [{ snippet: { topLevelComment: { id: 'UgComment1', snippet: {
      textOriginal: 'A real problem with meals', likeCount: 3, publishedAt: new Date().toISOString(), authorChannelId: { value: 'UCAccount' }, authorDisplayName: 'Alice',
    } } } }] }
    else throw new Error('Unexpected mocked endpoint')
    return Response.json(body)
  })
  const rd = await fetchRedditData('meals')
  assert.equal(rd.posts[0].comments[0].provenance?.originalId, 'c1')
  assert.equal(rd.posts[0].comments[0].provenance?.parentId, 't3_p0')
  assert.equal(rd.posts[0].comments[1].provenance?.idStatus, 'synthetic')
  const yt = await fetchYouTubeData('meals')
  assert.equal(yt.videos[0].comments[0].provenance?.authorId, 'UCAccount')
  assert.equal(yt.insufficientCorpus, true)
  assert.ok(!calls.some(url => url.includes('/comments?')))
})
