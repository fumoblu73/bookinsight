import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Valutazione del risultato reale, senza simulare la decisione del modello.
// node scripts/check-social-relevance.mjs /percorso/report-o-export.json
const input = process.argv[2]
assert.ok(input, 'Indicare il JSON del report o dell’export da valutare')
const report = JSON.parse(readFileSync(input, 'utf8'))
const fixture = JSON.parse(readFileSync(new URL('./fixtures/social-relevance-9.0.2.json', import.meta.url), 'utf8'))
const evidence = report.socialEvidence ?? report.social_evidence
const pains = report.painPoints ?? report.pain_points
assert.ok(evidence?.manifest && Array.isArray(pains), 'Report senza manifest o pain point')
const pain = pains.find(p => p.pain_point === fixture.painPoint && p.fonte === 'youtube')
assert.ok(pain?.id, 'Pain point del corpus congelato non presente')
const metrics = evidence.metrics[pain.id]
assert.equal(metrics?.status, 'complete', 'La valutazione richiede tutti i commenti esaminati senza errori di protocollo')
assert.equal(metrics.reviewedComments, metrics.totalComments)
for (const item of fixture.cases) {
  const record = evidence.manifest.records.find(r => r.platform === 'youtube' && r.sourceCommentId === item.commentId)
  assert.ok(record, `Commento del caso di regressione assente: ${item.commentId}`)
  const matched = evidence.associations.some(a => a.painPointId === pain.id && a.recordId === record.recordId)
  assert.equal(matched, item.expectedMatch, item.reason)
}
console.log(`Pertinenza: ${fixture.cases.length}/${fixture.cases.length} casi superati su ${metrics.totalComments} commenti esaminati.`)
