import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Valutazione del risultato reale, senza simulare la decisione del modello.
// node scripts/check-social-relevance.mjs /percorso/report-o-export.json [painPointId] [fixture.json]
const input = process.argv[2]
assert.ok(input, 'Indicare il JSON del report o dell’export da valutare')
const report = JSON.parse(readFileSync(input, 'utf8'))
const fixture = JSON.parse(readFileSync(process.argv[4] ?? new URL('./fixtures/social-relevance-9.0.2.json', import.meta.url), 'utf8'))
const evidence = report.socialEvidence ?? report.social_evidence
const pains = report.painPoints ?? report.pain_points
assert.ok(evidence?.manifest && Array.isArray(pains), 'Report senza manifest o pain point')
// Dopo una nuova estrazione la stessa descrizione può essere parafrasata:
// l'operatore può indicare l'ID del problema equivalente dopo averlo verificato.
const selectedId = process.argv[3]
const pain = pains.find(p => p.fonte === 'youtube' && (selectedId ? p.id === selectedId : p.pain_point === fixture.painPoint))
assert.ok(pain?.id, 'Pain point del corpus congelato non presente')
const metrics = evidence.metrics[pain.id]
assert.ok(metrics, 'Conteggi del pain point assenti')
// I report nuovi dichiarano quali record hanno una decisione valida per il pain point.
// Una mancata elaborazione dei controlli non vale come esclusione corretta.
const reviewed = evidence.reviewedRecordIds?.[pain.id]
if (!reviewed) {
  assert.equal(metrics.status, 'complete', 'Il report legacy deve avere tutti i commenti esaminati')
  assert.equal(metrics.reviewedComments, metrics.totalComments)
}
for (const item of fixture.cases) {
  const record = evidence.manifest.records.find(r => r.platform === 'youtube' && r.sourceCommentId === item.commentId)
  assert.ok(record, `Commento del caso di regressione assente: ${item.commentId}`)
  if (reviewed) assert.ok(reviewed.includes(record.recordId), `Caso non verificato: ${item.commentId}`)
  const matched = evidence.associations.some(a => a.painPointId === pain.id && a.recordId === record.recordId)
  assert.equal(matched, item.expectedMatch, item.reason)
}
console.log(`Pertinenza: ${fixture.cases.length}/${fixture.cases.length} casi superati; ${metrics.reviewedComments}/${metrics.totalComments} commenti con decisione valida.`)
console.log(`Pain point verificato: ${pain.id} — ${pain.pain_point}`)
