import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evidenceCatalog, groupEvidence, selectedSources, validateEvidenceSelection } from './evidence-review'
import { painReviews } from './amazon-review-filter'
import { promptPainPointsAmazonReviews } from './prompts'
import type { AmazonData, PainPoint, RedditData } from './types'
import type { EvidenceRecord } from './evidence-review'

const recipe = 'Add two chicken breasts, 1 jar of chunky salsa, and one can of drained black beans to crockpot. Cook on low 6-7 hours.'
const complaint = 'I cannot cook these just-add-water meals at work because I have no equipment or refrigerator.'
const record = (id: string, text: string): EvidenceRecord => ({ id, text, excerpt: text, source: 'reddit', title: 'Easy meals for a busy work life', identityStatus: 'original' })
const pain: PainPoint = { id: 'p', fonte: 'reddit', pain_point: 'Difficoltà a preparare pasti senza strumenti o frigorifero', F: 4, I: 6, score: 5, solvibilita: 'affrontabile', evidence: 'old', evidence_quotes: [recipe] }
const supported = (quote: string, extra = {}) => ({ painPointId: 'p', quote, kind: 'problem', topicRelevant: true, problemExpressed: true, scopeMatched: true, ...extra })

test('nessun recupero cieco delle citazioni; perimetro non coincidente e ipotesi non entrano nel gruppo', async () => {
  const review = await groupEvidence([record('recipe', recipe), record('direct', complaint)], [pain], 'just add water meals cookbook', async () => ({ decisions: [
    { recordId: 'recipe', matches: [supported(recipe, { problemExpressed: false, scopeMatched: false })] },
    { recordId: 'direct', matches: [supported(complaint)] },
  ] }))
  assert.deepEqual(review.groups.p, ['direct'])
  assert.equal(review.groupingPolicy, 'explicit-support-v1')
  assert.equal(review.proposals?.[0].quote, complaint)
  assert.equal(review.processing.status, 'complete')
  assert.throws(() => validateEvidenceSelection({ ...review, groups: { p: [] } }, ['p'], { p: [] }), /Mantieni almeno/)
  for (const match of [supported('This sentence is not in the source text.'), supported(complaint, { kind: 'hypothesis' }),
    { painPointId: 'p', quote: complaint, kind: 'problem' }, supported(complaint, { painPointId: 'invented' })]) {
    const bad = await groupEvidence([record('direct', complaint)], [pain], 'topic', async () => ({ decisions: [{ recordId: 'direct', matches: [match] }] }))
    assert.deepEqual(bad.groups.p, [])
    assert.equal(bad.processing.status, 'partial')
  }
})

test('filtro 1–3 stelle in catalogo, prompt e finalizzazione, con indici originali conservati', () => {
  const reviews = [{ asin: 'B000000001', bookTitle: 'Book', reviews: [
    { rating: 5, title: 'POSITIVE_5', body: 'POSITIVE_5 praise without a problem' },
    { rating: 3, title: 'NEGATIVE_3', body: 'NEGATIVE_3 missing detailed instructions' },
    { rating: 4, title: 'POSITIVE_4', body: 'POSITIVE_4 praise without a problem' },
    { rating: 1, title: 'NEGATIVE_1', body: 'NEGATIVE_1 unclear preservation techniques' },
    { rating: 2, title: 'NEGATIVE_2', body: 'NEGATIVE_2 incorrect quantities in recipes' },
  ] }]
  const filtered = painReviews(reviews)
  assert.deepEqual(filtered[0].reviews.map(r => r.rating), [3, 1, 2])
  const catalog = evidenceCatalog({ version: '9.0.2', contexts: [], records: [] }, reviews, 'US')
  assert.deepEqual(catalog.map(r => r.id), ['amazon:book:0:review:1', 'amazon:book:0:review:3', 'amazon:book:0:review:4'])
  const prompt = promptPainPointsAmazonReviews('topic', reviews, 'US')!
  assert.ok(prompt.includes('NEGATIVE_1') && prompt.includes('NEGATIVE_3'))
  assert.ok(!prompt.includes('POSITIVE_4') && !prompt.includes('POSITIVE_5'))
  const emptyReddit = { posts: [] } as unknown as RedditData
  const sources = selectedSources({ p: ['amazon:book:0:review:0', 'amazon:book:0:review:1'] }, { topBookReviews: reviews } as AmazonData, emptyReddit)
  assert.deepEqual(sources.amazon.topBookReviews[0].reviews.map(r => r.rating), [3])
})

test('una selezione da snapshot precedente non può riabilitare recensioni oltre 3 stelle', async () => {
  const r = { ...record('a5', complaint), source: 'amazon' as const, rating: 5 }
  const review = { version: 'manual-selection-v1' as const, records: [r], painPoints: [{ id: 'p', pain_point: 'Problem', fonte: 'recensione_negativa' as const }],
    groups: { p: ['a5'] }, processing: { status: 'complete' as const, requested: 1, processedRecordIds: ['a5'] } }
  assert.throws(() => validateEvidenceSelection(review, ['p'], { p: ['a5'] }), /1 a 3 stelle/)
  const grouped = await groupEvidence([r], [{ ...pain, fonte: 'recensione_negativa' }], 'topic', async () => { throw Error('No eligible record') })
  assert.deepEqual(grouped.records, [])
})
