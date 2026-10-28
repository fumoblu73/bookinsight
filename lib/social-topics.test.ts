import assert from 'node:assert/strict'
import { test } from 'node:test'
import fixture from '../scripts/fixtures/social-topics-9.0.2.json'
import { aggregateSocialEvidence, attributionBatches, runSocialAttribution } from './social-attribution'
import { parseSocialVerification, promptSocialVerification, verificationCandidates } from './social-verification'
import type { PainPoint, SocialCorpusManifest } from './types'

function inputs(topic: typeof fixture.topics[number]) {
  const platform = topic.platform as 'reddit' | 'youtube'
  const manifest: SocialCorpusManifest = { version: '9.0.2', contexts: [{
    contextId: 'context', platform, containerId: 'container', title: topic.sourceTitle, transmittedText: '',
  }], records: topic.cases.map(c => ({
    recordId: c.id, contextId: 'context', platform, containerId: 'container', sourceCommentId: c.id,
    identityStatus: 'original', authorKey: `${platform}:account:${c.id}`, authorIdentityType: 'account_id', authorStatus: 'identified',
    text: c.text, transmittedText: c.text, truncated: false, possibleCopy: false,
  })) }
  const pain: PainPoint = { id: 'pain', pain_point: topic.painPoint, fonte: platform, F: 3, I: 5, score: 4, solvibilita: 'affrontabile', evidence: 'Synthetic regression fixture' }
  const batch = attributionBatches(manifest, [pain], topic.keyword)[0]
  const output = { decisions: manifest.records.map(r => ({ recordId: r.recordId, matches: [{ painPointId: 'pain', supportType: 'direct', quote: r.text, contextRecordIds: [] }] })) }
  return { manifest, pain, batch, output, checks: verificationCandidates(batch, output) }
}
const payload = (prompt: string) => JSON.parse(prompt.split('DATI:\n')[1])

test('quattro temi e due piattaforme: fuori tema e incerti non alimentano U/T/M, senza bloccare il report', async () => {
  // Simula le risposte: misura il contratto e l'aggregazione, non la qualità semantica del modello.
  for (const topic of fixture.topics) {
    const { manifest, pain, output } = inputs(topic)
    let verificationCalls = 0
    const result = await runSocialAttribution(manifest, [pain], async prompt => {
      assert.equal(payload(prompt).topic, topic.keyword)
      return output
    }, { topic: topic.keyword, verify: async prompt => {
      verificationCalls++
      const d = payload(prompt)
      assert.equal(d.topic, topic.keyword)
      return { checks: d.checks.map((c: { recordId: string; painPointId: string; text: string; sourceTitle: string }) => {
        const expected = topic.cases.find(item => item.id === c.recordId)!
        assert.equal(c.sourceTitle, undefined)
        return { recordId: c.recordId, painPointId: c.painPointId, topicRelevance: expected.topicRelevance,
          scopeMatched: 'yes', evidenceKind: expected.reason === 'topic_only' || expected.reason === 'contradiction' ? 'neutral_description' : 'stated_problem',
          verdict: expected.outcome, reason: expected.reason, problemExpressed: expected.reason === 'topic_only' || expected.reason === 'contradiction' ? 'no' : 'yes',
          referentIdentified: 'yes', ...(expected.outcome === 'supported' ? { problemQuote: c.text } : {}),
        }
      }) }
    } })
    assert.equal(verificationCalls, 1, 'nessun riesame per trasformare gli incerti in approvazioni')
    assert.deepEqual([result.metrics.pain.U, result.metrics.pain.T, result.metrics.pain.M], [1, 1, 1])
    assert.equal(result.metrics.pain.status, 'partial')
    assert.deepEqual(result.associations.map(a => a.recordId), [topic.cases[0].id])
    assert.deepEqual(result.uncertainRecordIds?.pain, [topic.cases[2].id])
    assert.deepEqual(result.unresolvedRecordIds?.pain, [])
    assert.ok(result.reviewedRecordIds?.pain.includes(topic.cases[1].id))
    assert.equal(result.verification?.version, 'topic-problem-support-v4')
    assert.equal(result.verification?.topic, topic.keyword)
    assert.equal(result.processing?.budgetExhausted, false)
  }
})

test('approvazione del problema insufficiente: tema assente, negativo, incerto o incoerente non supera il controllo', () => {
  const topic = fixture.topics[0], { checks } = inputs(topic)
  const c = checks[0]
  const valid = { recordId: c.recordId, painPointId: c.painPointId, verdict: 'supported', reason: 'explicit_problem',
    problemExpressed: 'yes', referentIdentified: 'yes', problemQuote: c.text, topicRelevance: 'yes', scopeMatched: 'yes', evidenceKind: 'stated_problem' }
  for (const value of [undefined, 'no', 'unclear', 'probably', true]) {
    assert.equal(parseSocialVerification(checks, { checks: [{ ...valid, topicRelevance: value }] }, topic.keyword).length, 0)
  }
  assert.equal(parseSocialVerification(checks, { checks: [valid] }, topic.keyword).length, 1)
  assert.equal(parseSocialVerification(checks, { checks: [{ ...valid, verdict: 'unsupported', reason: 'out_of_topic' }] }, topic.keyword).length, 0)
  assert.equal(parseSocialVerification(checks, { checks: [{ ...valid, verdict: 'unclear', reason: 'unclear_topic' }] }, topic.keyword).length, 0)
  assert.equal(parseSocialVerification(checks, { checks: [{ ...valid, topicRelevance: 'no', verdict: 'unclear', reason: 'unclear_topic' }] }, topic.keyword).length, 0)
  // I dati storici non vengono spacciati per una nuova verifica del tema.
  assert.equal(parseSocialVerification(checks, { checks: [{ ...valid, topicRelevance: undefined }] }).length, 1)
})

test('un problema chiaramente fuori tema è un’esclusione valida anche se espresso; l’incertezza non diventa zero', () => {
  const topic = fixture.topics[0], { manifest, pain, batch, output, checks } = inputs(topic)
  const only = { ...batch, records: [manifest.records[0]] }
  const oneOutput = { decisions: [output.decisions[0]] }
  const base = { recordId: checks[0].recordId, painPointId: 'pain', problemExpressed: 'yes', referentIdentified: 'yes', scopeMatched: 'yes', evidenceKind: 'stated_problem' }
  for (const [topicRelevance, verdict, reason, expected] of [
    ['no', 'unsupported', 'out_of_topic', 0], ['unclear', 'unclear', 'unclear_topic', null],
  ] as const) {
    const verification = parseSocialVerification(checks, { checks: [{ ...base, topicRelevance, verdict, reason }] }, topic.keyword)
    const result = aggregateSocialEvidence({ ...manifest, records: only.records }, [pain], [{ batch: only, output: oneOutput, verification }], { requireVerification: true, topic: topic.keyword })
    assert.equal(result.metrics.pain.M, expected)
    assert.equal(result.metrics.pain.status, expected === 0 ? 'complete' : 'partial')
  }
})

test('il revisore riceve il tema ma non titolo, identità o F/I/S che possano prestare un problema al commento', () => {
  const topic = fixture.topics[0], { checks } = inputs(topic)
  const prompt = promptSocialVerification(checks, topic.keyword)
  assert.equal(payload(prompt).topic, topic.keyword)
  assert.equal(payload(prompt).checks[0].sourceTitle, undefined)
  assert.ok(!prompt.includes(topic.sourceTitle))
  assert.ok(!prompt.includes('reddit:account:'))
  assert.ok(!prompt.includes('"F":'))
  assert.match(prompt, /non costituiscono un antecedente per i pronomi/)
  assert.match(prompt, /non richiedere le stesse parole della keyword/)
})

test('risposte senza giudizio sul tema: un recupero delle sole coppie mancanti e conteggi indisponibili se manca ancora', async () => {
  for (const recover of [true, false]) {
    const topic = fixture.topics[0], { manifest, pain, output } = inputs(topic)
    const subset = { ...manifest, records: manifest.records.slice(0, 2) }
    const calls: string[][] = []
    const result = await runSocialAttribution(subset, [pain], async () => ({ decisions: output.decisions.slice(0, 2) }), {
      topic: topic.keyword, verify: async prompt => {
        const cs = payload(prompt).checks as { recordId: string; painPointId: string; text: string }[]
        calls.push(cs.map(c => c.recordId))
        return { checks: cs.map(c => ({ recordId: c.recordId, painPointId: c.painPointId, problemExpressed: 'yes', referentIdentified: 'yes',
          scopeMatched: 'yes', evidenceKind: 'stated_problem',
          verdict: c.recordId === subset.records[0].recordId ? 'supported' : 'unsupported',
          reason: c.recordId === subset.records[0].recordId ? 'explicit_problem' : 'out_of_topic',
          problemQuote: c.text,
          ...(c.recordId === subset.records[0].recordId || (recover && calls.length > 1)
            ? { topicRelevance: c.recordId === subset.records[0].recordId ? 'yes' : 'no' } : {}),
        })) }
      },
    })
    assert.deepEqual(calls, [subset.records.map(r => r.recordId), [subset.records[1].recordId]])
    assert.equal(result.metrics.pain.M, 1)
    assert.equal(result.metrics.pain.status, recover ? 'complete' : 'partial')
    assert.equal(result.unresolvedRecordIds?.pain.length, recover ? 0 : 1)
    assert.equal(result.verification?.decisions.length, recover ? 2 : 1)
  }
})
