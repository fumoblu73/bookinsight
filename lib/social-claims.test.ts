import assert from 'node:assert/strict'
import { test } from 'node:test'
import fixture from '../scripts/fixtures/social-claims-9.0.2.json'
import { aggregateSocialEvidence, attributionBatches, runSocialAttribution } from './social-attribution'
import { parseSocialVerification, verificationCandidates } from './social-verification'
import type { PainPoint, SocialCorpusManifest } from './types'

function inputs(topic = fixture.topics[0]) {
  const platform = topic.platform as 'reddit' | 'youtube'
  const manifest: SocialCorpusManifest = { version: '9.0.2', contexts: [{ contextId: 'ctx', platform, containerId: 'container', title: topic.sourceTitle, transmittedText: '' }], records: topic.cases.map(c => ({
    recordId: c.id, contextId: 'ctx', platform, containerId: 'container', sourceCommentId: c.id, identityStatus: 'original',
    authorKey: `${platform}:account:${c.id}`, authorStatus: 'identified', authorIdentityType: 'account_id',
    text: c.text, transmittedText: c.text, truncated: false, possibleCopy: false,
  })) }
  const pain: PainPoint = { id: 'pain', fonte: platform, pain_point: topic.painPoint, F: 3, I: 5, score: 4, solvibilita: 'affrontabile', evidence: 'Synthetic fixture' }
  const batch = attributionBatches(manifest, [pain], topic.keyword)[0]
  const output = { decisions: manifest.records.map(r => ({ recordId: r.recordId, matches: [{ painPointId: pain.id, supportType: 'direct', quote: r.text, contextRecordIds: [] }] })) }
  return { manifest, pain, batch, output, checks: verificationCandidates(batch, output) }
}

test('quattro ambiti: diverso oggetto e dati neutrali esclusi; ipotesi incerte; esperienza e problema risolto contati', async () => {
  // Risposte simulate: verifica le regole del programma, non l'accuratezza del modello.
  for (const topic of fixture.topics) {
    const { manifest, pain, output } = inputs(topic)
    let calls = 0
    const result = await runSocialAttribution(manifest, [pain], async () => output, { topic: topic.keyword, verify: async prompt => {
      calls++
      const d = JSON.parse(prompt.split('DATI:\n')[1])
      return { checks: d.checks.map((c: { recordId: string; painPointId: string; text: string }) => {
        const item = topic.cases.find(x => x.id === c.recordId)!
        return { recordId: c.recordId, painPointId: c.painPointId, verdict: item.outcome, reason: item.reason,
          topicRelevance: item.topicRelevance, scopeMatched: item.scopeMatched, evidenceKind: item.evidenceKind,
          problemExpressed: item.problemExpressed, referentIdentified: 'yes', ...(item.outcome === 'supported' ? { problemQuote: c.text } : {}),
        }
      }) }
    } })
    assert.equal(calls, 1, 'ipotesi e incertezze valide non provocano tentativi ulteriori')
    assert.deepEqual([result.metrics.pain.U, result.metrics.pain.T, result.metrics.pain.M], [2, 1, 2])
    assert.deepEqual(result.associations.map(a => a.recordId), [topic.cases[0].id, topic.cases[4].id])
    assert.deepEqual(result.uncertainRecordIds?.pain, [topic.cases[3].id])
    assert.deepEqual(result.unresolvedRecordIds?.pain, [])
    assert.equal(result.verification?.version, fixture.version)
    assert.equal(result.metrics.pain.reviewedComments, 4)
  }
})

test('il solo verdetto positivo non supera perimetro ignoto, descrizione neutra o ipotesi', () => {
  const { checks, manifest, pain, batch, output } = inputs(), c = checks[0]
  const base = { recordId: c.recordId, painPointId: c.painPointId, verdict: 'supported', reason: 'explicit_problem',
    problemExpressed: 'yes', referentIdentified: 'yes', topicRelevance: 'yes', scopeMatched: 'yes', evidenceKind: 'stated_problem', problemQuote: c.text }
  for (const scopeMatched of [undefined, 'no', 'unclear', true]) assert.equal(parseSocialVerification(checks, { checks: [{ ...base, scopeMatched }] }, 'topic').length, 0)
  for (const evidenceKind of [undefined, 'neutral_description', 'hypothesis', 'unclear', 'guess']) assert.equal(parseSocialVerification(checks, { checks: [{ ...base, evidenceKind }] }, 'topic').length, 0)
  for (const evidenceKind of ['stated_problem', 'stated_need', 'resolved_problem']) assert.equal(parseSocialVerification(checks, { checks: [{ ...base, evidenceKind }] }, 'topic').length, 1)
  // Anche l'aggregazione rifiuta un'approvazione importata senza le condizioni richieste.
  const verification = [{ recordId: c.recordId, painPointId: c.painPointId, verdict: 'supported' as const, reason: 'explicit_problem' as const,
    topicRelevance: 'yes' as const, scopeMatched: 'yes' as const, evidenceKind: 'hypothesis' as const, problemQuote: c.text }]
  const result = aggregateSocialEvidence(manifest, [pain], [{ batch, output, verification }], { requireVerification: true, topic: 'topic' })
  assert.equal(result.associations.length, 0)
})

test('un bisogno attuale resta ammissibile anche se riguarda un evento futuro', () => {
  const { checks } = inputs(), c = checks[0]
  const text = 'My first solo backpacking trip is next month and I already need help planning meals because I am anxious.'
  const candidate = { ...c, text, quote: text, problem: 'Ansia attuale da pianificazione dei pasti per il primo viaggio' }
  const result = parseSocialVerification([candidate], { checks: [{ recordId: c.recordId, painPointId: c.painPointId,
    verdict: 'supported', reason: 'explicit_need', problemExpressed: 'yes', referentIdentified: 'yes',
    topicRelevance: 'yes', scopeMatched: 'yes', evidenceKind: 'stated_need', problemQuote: text,
  }] }, 'backpacking meal planning')
  assert.equal(result.length, 1)
})
