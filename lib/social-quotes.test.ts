import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveSocialQuote } from './social-quotes'
import { inspectSocialDecisions } from './social-decisions'
import { attributionBatches } from './social-attribution'
import type { PainPoint, SocialCorpusManifest } from './types'

test('apostrofi tipografici: restituisce i caratteri originali, anche dopo emoji', () => {
  const source = '👍 You’re right it is cheaper, the problem is the weight to calorie ratio.'
  assert.deepEqual(resolveSocialQuote(source, "You're right it is cheaper, the problem is the weight to calorie ratio."), {
    quote: source.slice(3), adjusted: true,
  })
  assert.deepEqual(resolveSocialQuote('He said “too expensive”.', 'He said "too expensive".'), { quote: 'He said “too expensive”.', adjusted: true })
})

test('parafrasi, omissioni, punteggiatura diversa e allineamenti ambigui restano rifiutati', () => {
  for (const quote of ['These cost too much.', 'these are too expensive.', 'These…expensive.', 'These are too expensive!']) assert.equal(resolveSocialQuote('These are too expensive.', quote), undefined)
  assert.equal(resolveSocialQuote('it’s costly; it‘s costly', "it's costly"), undefined)
  assert.equal(resolveSocialQuote('not expensive', 'expensive' + ' '.repeat(301) + 'x'), undefined)
  assert.deepEqual(resolveSocialQuote('Meals are too expensive.', 'too expensive'), { quote: 'too expensive', adjusted: false })
})

test('l’estrattore conserva la citazione originale e segnala l’allineamento senza riprovare il record', () => {
  const manifest: SocialCorpusManifest = { version: '9.0.2', contexts: [{ contextId: 'ctx', platform: 'youtube', containerId: 'v', title: 'Meals', transmittedText: '' }], records: [{ recordId: 'r', contextId: 'ctx', platform: 'youtube', containerId: 'v', sourceCommentId: 'c', identityStatus: 'original', text: 'It’s too expensive.', transmittedText: 'It’s too expensive.', truncated: false, possibleCopy: false, authorStatus: 'unknown', authorIdentityType: 'unknown' }] }
  const pain: PainPoint = { id: 'p', fonte: 'youtube', pain_point: 'Costo eccessivo', F: 3, I: 5, score: 4, evidence: '', solvibilita: 'affrontabile' }
  const result = inspectSocialDecisions(attributionBatches(manifest, [pain])[0], { decisions: [{ recordId: 'r', matches: [{ painPointId: 'p', supportType: 'direct', quote: "It's too expensive.", contextRecordIds: [] }] }] })
  assert.equal(result.issues.length, 0)
  assert.deepEqual(result.adjustments, ['r'])
  assert.equal(result.decisions[0].matches[0].quote, 'It’s too expensive.')
})
