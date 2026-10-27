import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateSocialEvidence, attributionBatches, runSocialAttribution } from './social-attribution'
import { parseSocialVerification, promptSocialVerification, verificationCandidates } from './social-verification'
import type { PainPoint, SocialCorpusManifest } from './types'

function corpus(platform: 'reddit' | 'youtube' = 'youtube', groups = 1, size = 4): SocialCorpusManifest {
  const contexts = Array.from({ length: groups }, (_, i) => ({ contextId: `${platform}:${i}`, platform, containerId: `p${i}`, title: 'Meals', transmittedText: 'Meals' }))
  return { version: '9.0.2', contexts, records: contexts.flatMap(c => Array.from({ length: size }, (_, i) => ({
    recordId: `${c.contextId}:${i}`, contextId: c.contextId, platform, containerId: c.containerId,
    sourceCommentId: `c${c.containerId}x${i}`, identityStatus: 'original' as const,
    authorKey: `${platform}:account:${i}`, authorIdentityType: 'account_id' as const, authorStatus: 'identified' as const,
    text: ['This costs $8 per meal.', 'These meals are too expensive for me.', 'These are not expensive.', 'I cannot tell.'][i % 4],
    transmittedText: ['This costs $8 per meal.', 'These meals are too expensive for me.', 'These are not expensive.', 'I cannot tell.'][i % 4],
    truncated: false, possibleCopy: false,
  }))) }
}
const pain = (fonte: 'reddit' | 'youtube' = 'youtube'): PainPoint => ({ id: `pain-${fonte}`, fonte, pain_point: 'Pasti troppo costosi', F: 3, I: 5, score: 4, solvibilita: 'affrontabile', evidence: 'test' })
const data = (prompt: string) => JSON.parse(prompt.split('DATI:\n')[1])
const proposeAll = async (prompt: string) => {
  const d = data(prompt)
  return { decisions: d.recordsToReview.map((r: { recordId: string; text: string }) => ({ recordId: r.recordId,
    matches: [{ painPointId: d.painPoints[0].id, supportType: 'direct', quote: r.text, contextRecordIds: [] }],
  })) }
}

test('la verifica indipendente esclude topic e smentite; gli incerti non diventano assenze confermate', async () => {
  const manifest = corpus()
  const result = await runSocialAttribution(manifest, [pain()], proposeAll, { verify: async prompt => ({ checks: data(prompt).checks.map((c: { recordId: string; painPointId: string; text: string }, i: number) => ({
    recordId: c.recordId, painPointId: c.painPointId,
    verdict: ['unsupported', 'supported', 'unsupported', 'unclear'][i],
    reason: ['topic_only', 'explicit_problem', 'contradiction', 'insufficient_evidence'][i], problemQuote: c.text,
  })) }) })
  assert.deepEqual([result.metrics['pain-youtube'].U, result.metrics['pain-youtube'].T, result.metrics['pain-youtube'].M], [1, 1, 1])
  assert.equal(result.metrics['pain-youtube'].status, 'partial')
  assert.equal(result.metrics['pain-youtube'].reviewedComments, 3)
  assert.equal(result.verification?.decisions.length, 4)
  assert.equal(result.reviewedRecordIds?.['pain-youtube'].includes(manifest.records[0].recordId), true)
  assert.equal(result.reviewedRecordIds?.['pain-youtube'].includes(manifest.records[3].recordId), false)
})

test('mancanza, errore o approvazione malformata del revisore non certificano i candidati', async () => {
  for (const verify of [async () => ({}), async () => { throw new Error('Unavailable') }, async (prompt: string) => ({ checks: data(prompt).checks.map((c: { recordId: string; painPointId: string }) => ({ ...c, verdict: 'supported', reason: 'explicit_problem', problemQuote: 'Invented text' })) })]) {
    const result = await runSocialAttribution(corpus('youtube', 1, 1), [pain()], proposeAll, { verify })
    assert.equal(result.associations.length, 0)
    assert.equal(result.metrics['pain-youtube'].M, null)
    assert.equal(result.metrics['pain-youtube'].reviewedComments, 0)
  }
})

test('il revisore vede il singolo commento diretto, senza autori, score o contesto altrui', () => {
  const manifest = corpus('reddit', 1, 1)
  manifest.records[0].parentId = 't3_p0'
  manifest.contexts[0].transmittedText = 'PRIVATE_PARENT_TEXT'
  const batch = attributionBatches(manifest, [pain('reddit')])[0]
  const output = { decisions: [{ recordId: batch.records[0].recordId, matches: [{ painPointId: 'pain-reddit', supportType: 'direct', quote: batch.records[0].transmittedText, contextRecordIds: [] }] }] }
  const checks = verificationCandidates(batch, output)
  const prompt = promptSocialVerification(checks)
  assert.ok(!prompt.includes('PRIVATE_PARENT_TEXT'))
  assert.ok(!prompt.includes('reddit:account:'))
  assert.ok(!prompt.includes('"F":'))
  for (const raw of [{ checks: [{ recordId: 'invented', painPointId: 'pain-reddit', verdict: 'supported' }] }, { checks: [...checks, ...checks] }]) assert.equal(parseSocialVerification(checks, raw).length, 0)
})

test('una conferma richiede il problema del padre verificato, non soltanto la relazione', () => {
  const manifest = corpus('reddit', 1, 2)
  const [parent, child] = manifest.records
  parent.text = parent.transmittedText = 'These meals are too expensive.'
  child.text = child.transmittedText = 'Same here!'
  child.parentRecordId = parent.recordId; child.parentId = 't1_' + parent.sourceCommentId
  const batch = attributionBatches(manifest, [pain('reddit')])[0]
  const output = { decisions: [
    { recordId: parent.recordId, matches: [{ painPointId: 'pain-reddit', supportType: 'direct', quote: parent.text, contextRecordIds: [] }] },
    { recordId: child.recordId, matches: [{ painPointId: 'pain-reddit', supportType: 'confirmation', quote: child.text, contextRecordIds: [parent.recordId] }] },
  ] }
  const checks = verificationCandidates(batch, output)
  const verified = parseSocialVerification(checks, { checks: checks.map(c => ({ recordId: c.recordId, painPointId: c.painPointId, verdict: 'supported', reason: c.supportType === 'direct' ? 'explicit_problem' : 'linked_confirmation', problemQuote: parent.text })) })
  const result = aggregateSocialEvidence(manifest, [pain('reddit')], [{ batch, output, verification: verified }], { requireVerification: true })
  assert.equal(result.metrics['pain-reddit'].M, 2)
  const rejectedParent = verified.map(v => v.recordId === parent.recordId ? { ...v, verdict: 'unsupported' as const, reason: 'topic_only' as const } : v)
  assert.equal(aggregateSocialEvidence(manifest, [pain('reddit')], [{ batch, output, verification: rejectedParent }], { requireVerification: true }).metrics['pain-reddit'].M, 0)
})

test('budget limitato: entrambe le fonti e piu contenitori ricevono lavoro prima dei secondi gruppi', async () => {
  const r = corpus('reddit', 15, 30), y = corpus('youtube', 8, 50)
  const manifest = { ...r, contexts: [...r.contexts, ...y.contexts], records: [...r.records, ...y.records] }
  const batches = attributionBatches(manifest, [pain('reddit'), pain()])
  assert.deepEqual(batches.slice(0, 4).map(b => b.context.contextId), ['reddit:0', 'youtube:0', 'reddit:1', 'youtube:1'])
  assert.equal(new Set(batches.flatMap(b => b.records.map(r => r.recordId))).size, 850)
  const result = await runSocialAttribution(manifest, [pain('reddit'), pain()], async prompt => {
    const d = data(prompt); await new Promise(r => setTimeout(r, 20))
    return { decisions: d.recordsToReview.map((r: { recordId: string }) => ({ recordId: r.recordId, matches: [] })) }
  }, { timeoutMs: 100 })
  assert.ok(result.metrics['pain-reddit'].reviewedComments > 0)
  assert.ok(result.metrics['pain-youtube'].reviewedComments > 0)
  assert.equal(result.processing?.budgetExhausted, true)
  assert.ok(result.processing!.unstartedRecordIds.length > 0)
})

test('un gruppo mai avviato per budget e distinto da un errore del provider', async () => {
  const r = corpus('reddit', 1, 1), y = corpus('youtube', 1, 1)
  const result = await runSocialAttribution({ ...r, contexts: [...r.contexts, ...y.contexts], records: [...r.records, ...y.records] }, [pain('reddit'), pain()], async () => new Promise(() => {}), { concurrency: 1, timeoutMs: 10 })
  assert.equal(result.metrics['pain-reddit'].status, 'failed')
  assert.equal(result.metrics['pain-youtube'].status, 'not_run')
  assert.equal(result.metrics['pain-youtube'].M, null)
  assert.deepEqual(result.processing?.unstartedRecordIds, [y.records[0].recordId])
})
