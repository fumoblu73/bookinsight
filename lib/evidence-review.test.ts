import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evidenceCatalog, groupEvidence, manualSocialEvidence, selectedPainEvidence, selectedSources, validateEvidenceSelection } from './evidence-review'
import { buildSocialManifest } from './social-corpus'
import type { AmazonData, PainPoint, RedditData, YouTubeData } from './types'

const pain = (id: string, fonte: PainPoint['fonte']): PainPoint => ({ id, fonte, pain_point: 'Problema del campione', F: 4, I: 7, score: 5, solvibilita: 'affrontabile', evidence: 'DROP_REDDIT', evidence_quotes: ['DROP_REDDIT'], voice_phrases: ['DROP_REDDIT', 'KEEP_REDDIT'], context: 'DROP_REDDIT' })
const pains = [pain('r', 'reddit'), pain('y', 'youtube'), pain('a', 'recensione_negativa')]
const c = (id: string, body: string) => ({ id, body: body + ' full testimony', author: 'alice', score: 1, createdUtc: 1, month: '1970-01' })
const reddit: RedditData = { keyword: 'topic', available: true, insufficientCorpus: true, totalComments: 4, threadCount: 1, subredditsUsed: ['test'],
  posts: [{ id: 'p1', title: 'Title', selftext: 'DROP_REDDIT from parent context', score: 1, subreddit: 'test', createdUtc: 1, month: '1970-01', comments: [c('c1', 'KEEP_REDDIT'), c('c2', 'DROP_REDDIT'), c('c3', 'KEEP_REDDIT second reply'), c('c1', 'KEEP_REDDIT')] }] }
const youtube: YouTubeData = { keyword: 'topic', available: true, insufficientCorpus: false, totalComments: 2, videos: [{ id: 'video', title: 'Video', viewCount: 1,
  comments: ['KEEP_YOUTUBE', 'DROP_YOUTUBE'].map((text, i) => ({ id: `yt${i}`, text: text + ' full testimony', likeCount: 1, publishedAt: '2026-01-01', provenance: { idStatus: 'original', originalId: `yt${i}`, authorId: `channel${i}` } })) }] }
const amazon = { keyword: 'topic', market: 'US', topBookReviews: [{ asin: 'TEST000001', bookTitle: 'Book', reviews: [{ rating: 2, title: 'One', body: 'KEEP_AMAZON full testimony' }, { rating: 2, title: 'Two', body: 'DROP_AMAZON full testimony' }] }] } as AmazonData

test('tre fonti: raggruppamento, scelte vincolate al server, esclusioni dai dati AI e numeri invariati', async () => {
  const manifest = buildSocialManifest(reddit, youtube), records = evidenceCatalog(manifest, amazon.topBookReviews!, 'US')
  assert.equal(records.length, 7, 'il commento duplicato non diventa una seconda scelta')
  const review = await groupEvidence(records, pains, 'topic', async prompt => {
    const d = JSON.parse(prompt.split('DATI:\n')[1])
    return { decisions: d.recordsToReview.map((r: { recordId: string; text: string; allowedPainPointIds: string[] }) => ({ recordId: r.recordId, matches: r.allowedPainPointIds.map(painPointId => ({ painPointId, quote: r.text.slice(0, 200), kind: 'problem', topicRelevant: true, problemExpressed: true, scopeMatched: true })) })) }
  })
  assert.equal(review.processing.status, 'complete')
  const selection = validateEvidenceSelection(JSON.parse(JSON.stringify(review)), ['r', 'y', 'a'], {
    r: ['reddit:post:0:comment:0', 'reddit:post:0:comment:2'], y: ['youtube:video:0:comment:0'], a: ['amazon:book:0:review:0'],
  })
  const before = JSON.stringify({ reddit, youtube, amazon, pains, review })
  const sources = selectedSources(selection, amazon, reddit, youtube)
  const selected = selectedPainEvidence(pains, review, selection)
  const aiInput = JSON.stringify({ sources, selected })
  assert.ok(!aiInput.includes('DROP_REDDIT'))
  assert.ok(!aiInput.includes('DROP_YOUTUBE'))
  assert.ok(!aiInput.includes('DROP_AMAZON'))
  assert.ok(aiInput.includes('KEEP_REDDIT') && aiInput.includes('KEEP_YOUTUBE') && aiInput.includes('KEEP_AMAZON'))
  assert.deepEqual(selected.map(p => [p.F, p.I, p.score, p.solvibilita]), pains.map(p => [p.F, p.I, p.score, p.solvibilita]))
  const social = manualSocialEvidence(manifest, pains, review, selection)
  assert.deepEqual([social.metrics.r.U, social.metrics.r.T, social.metrics.r.M], [1, 1, 2])
  assert.deepEqual([social.metrics.y.U, social.metrics.y.T, social.metrics.y.M], [1, 1, 1])
  assert.equal(social.metrics.a, undefined, 'nessun autore Amazon inventato')
  assert.equal(social.reviewMode, 'manual')
  assert.ok(social.associations.every(a => a.supportType === 'manual'))
  assert.equal(JSON.stringify({ reddit, youtube, amazon, pains, review }), before, 'originali e proposte non mutati')
  for (const input of [{ r: [] }, { r: ['invented'] }, { r: [review.groups.y[0]] }, { r: review.groups.r, other: [] }]) {
    assert.throws(() => validateEvidenceSelection(review, ['r'], input))
  }
  assert.throws(() => validateEvidenceSelection(review, [], {}), 'una selezione vuota non torna implicitamente a tutti')
})

test('deadline o output invalido: originali disponibili e raggruppamento dichiarato parziale', async () => {
  const records = evidenceCatalog(buildSocialManifest(reddit, youtube), amazon.topBookReviews!, 'US')
  let calls = 0
  const exhausted = await groupEvidence(records, pains, 'topic', async () => { calls++; return {} }, 0)
  assert.equal(calls, 0)
  assert.equal(exhausted.processing.status, 'partial')
  assert.equal(exhausted.records.length, records.length)
  assert.deepEqual(exhausted.groups.r, [], 'citazioni iniziali non diventano abbinamenti senza verifica del sostegno')
  const bad = await groupEvidence(records, pains, 'topic', async () => ({ decisions: [{ recordId: records[0].id, painPointIds: ['invented'] }] }))
  assert.equal(bad.processing.status, 'partial')
  assert.deepEqual(bad.processing.processedRecordIds, [])
})

test('selezioni per pain point indipendenti e autore cancellato senza utenti inventati', async () => {
  const manifest = buildSocialManifest(reddit), records = evidenceCatalog(manifest, [], 'US')
  const both = [pains[0], pain('r2', 'reddit')]
  const review = await groupEvidence(records, both, 'topic', async prompt => ({ decisions: JSON.parse(prompt.split('DATI:\n')[1]).recordsToReview.map((r: { recordId: string; text: string }) => ({ recordId: r.recordId, matches: ['r', 'r2'].map(painPointId => ({ painPointId, quote: r.text.slice(0, 200), kind: 'problem', topicRelevant: true, problemExpressed: true, scopeMatched: true })) })) }))
  const second = manifest.records[1]
  second.authorKey = undefined; second.authorStatus = 'deleted'
  const selection = validateEvidenceSelection(review, ['r', 'r2'], { r: [records[0].id], r2: [records[0].id, second.recordId] })
  const result = manualSocialEvidence(manifest, both, review, selection)
  assert.deepEqual([result.metrics.r.U, result.metrics.r.M], [1, 1])
  assert.deepEqual([result.metrics.r2.U, result.metrics.r2.T, result.metrics.r2.M], [1, 1, 2])
  assert.equal(result.metrics.r2.unknownAuthorMentions, 1)
  assert.equal(result.metrics.r2.completeness.U, false)
})
