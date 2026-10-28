import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// node scripts/check-social-outcomes.mjs report.json fixture-preregistrata.json [painPointId]
const [input, fixturePath, selectedId] = process.argv.slice(2)
assert.ok(input && fixturePath, 'Indicare report e fixture con definizione del problema congelata prima dell’attribuzione')
const report = JSON.parse(readFileSync(input, 'utf8'))
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const evidence = report.socialEvidence ?? report.social_evidence
const pains = report.painPoints ?? report.pain_points
assert.ok(['problem-support-v2', 'topic-problem-support-v3'].includes(evidence?.verification?.version), 'Serve il protocollo con problema e referente separati')
if (evidence.verification.version === 'topic-problem-support-v3') assert.equal(evidence.verification.topic, (report.keyword ?? report.meta?.topic)?.trim(), 'Il tema verificato deve coincidere con la keyword originale')
const pain = pains.find(p => selectedId ? p.id === selectedId : p.pain_point === fixture.painPoint && p.fonte === fixture.platform)
assert.ok(pain?.id, 'Pain point della fixture non presente')
assert.equal(pain.pain_point, fixture.painPoint, 'La definizione del problema deve coincidere con quella preregistrata')
assert.equal(pain.fonte, fixture.platform)
const cases = []
for (const item of fixture.cases) {
  const record = evidence.manifest.records.find(r => r.platform === fixture.platform && r.sourceCommentId === item.commentId)
  assert.ok(record, `Commento assente: ${item.commentId}`)
  const associated = evidence.associations.some(a => a.recordId === record.recordId && a.painPointId === pain.id)
  const reviewed = evidence.reviewedRecordIds[pain.id].includes(record.recordId)
  const uncertain = evidence.uncertainRecordIds[pain.id].includes(record.recordId)
  const unresolved = evidence.unresolvedRecordIds[pain.id].includes(record.recordId)
  assert.equal(Number(reviewed) + Number(uncertain) + Number(unresolved), 1, 'Ogni record deve avere un esito distinto')
  const actual = associated && reviewed ? 'supported' : reviewed ? 'unsupported' : uncertain ? 'uncertain' : 'unresolved'
  assert.equal(actual, item.expectedOutcome, `${item.commentId}: ${item.reason}`)
  const verification = evidence.verification.decisions.find(v => v.recordId === record.recordId && v.painPointId === pain.id)
  if (associated) assert.equal(verification?.verdict, 'supported')
  if (uncertain && verification) assert.equal(verification.verdict, 'unclear')
  cases.push({ commentId: item.commentId, outcome: actual, verifierReason: verification?.reason ?? null })
}
console.log(JSON.stringify({ passed: cases.length, total: fixture.cases.length, painPointId: pain.id, painPoint: pain.pain_point, cases }, null, 2))
