import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Manutenzione: quattro richieste al modello reale, nessuna nuova raccolta.
// Usa i moduli di produzione compilati con tsconfig.tests.json e la normale
// ANTHROPIC_API_KEY del contesto di esecuzione. Non stampa credenziali o prompt.
// node scripts/evaluate-social-topics.mjs /percorso/compilato /percorso/risultati
const [compiledDir, outputDir, fixturePath] = process.argv.slice(2)
assert.ok(compiledDir && outputDir, 'Indicare directory compilata e directory dei risultati')
assert.ok(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY non configurata nel contesto del benchmark live')
const require = createRequire(import.meta.url)
const { attributionBatches, aggregateSocialEvidence } = require(join(resolve(compiledDir), 'lib/social-attribution.js'))
const { verificationCandidates, promptSocialVerification, parseSocialVerification } = require(join(resolve(compiledDir), 'lib/social-verification.js'))
const { callSocialVerification } = require(join(resolve(compiledDir), 'lib/ai.js'))
const fixture = JSON.parse(readFileSync(fixturePath ? resolve(fixturePath) : fileURLToPath(new URL('./fixtures/social-claims-9.0.2.json', import.meta.url)), 'utf8'))
const out = resolve(outputDir)
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'preregistered-fixture.json'), JSON.stringify(fixture, null, 2))
const results = []
for (const topic of fixture.topics) {
  const manifest = { version: '9.0.2', contexts: [{ contextId: 'context', platform: topic.platform, containerId: 'container', title: topic.sourceTitle, transmittedText: '' }],
    records: topic.cases.map(c => ({ recordId: c.id, contextId: 'context', platform: topic.platform, containerId: 'container', sourceCommentId: c.id,
      identityStatus: 'original', authorKey: `${topic.platform}:account:${c.id}`, authorIdentityType: 'account_id', authorStatus: 'identified',
      text: c.text, transmittedText: c.text, truncated: false, possibleCopy: false,
    })),
  }
  const pain = { id: 'pain', pain_point: topic.painPoint, fonte: topic.platform, F: 3, I: 5, score: 4, solvibilita: 'affrontabile', evidence: 'Synthetic maintenance fixture' }
  const batch = attributionBatches(manifest, [pain], topic.keyword)[0]
  // Propone volutamente tutti i casi: il revisore deve respingere anche
  // falsi positivi plausibili, non solo confermare le proposte dell'estrattore.
  const output = { decisions: manifest.records.map(r => ({ recordId: r.recordId, matches: [{ painPointId: pain.id, supportType: 'direct', quote: r.text, contextRecordIds: [] }] })) }
  const checks = verificationCandidates(batch, output)
  let decisions = [], error = null
  try {
    decisions = parseSocialVerification(checks, await callSocialVerification(promptSocialVerification(checks, topic.keyword), AbortSignal.timeout(45_000)), topic.keyword)
  } catch (err) { error = err instanceof Error ? err.name : 'UnknownError' }
  const evidence = aggregateSocialEvidence(manifest, [pain], [{ batch, output, verification: decisions }], { requireVerification: true, topic: topic.keyword })
  const cases = topic.cases.map(c => {
    const d = decisions.find(v => v.recordId === c.id)
    return { id: c.id, expected: c.outcome, actual: d?.verdict ?? 'unresolved', topicRelevance: d?.topicRelevance ?? null,
      scopeMatched: d?.scopeMatched ?? null, evidenceKind: d?.evidenceKind ?? null,
      reason: d?.reason ?? null, passed: d?.verdict === c.outcome && d?.topicRelevance === c.topicRelevance }
  })
  results.push({ topic: topic.keyword, error, passed: cases.filter(c => c.passed).length, total: cases.length, cases, metrics: evidence.metrics.pain })
  writeFileSync(join(out, topic.id + '.json'), JSON.stringify({ results: results.at(-1), evidence }, null, 2))
  console.log(JSON.stringify({ topic: topic.id, passed: cases.filter(c => c.passed).length, total: cases.length, error }))
}
const summary = { version: 'topic-problem-support-v4', fixtureVersion: fixture.version, evaluatedAt: new Date().toISOString(), fixtureType: 'synthetic',
  passed: results.reduce((n, r) => n + r.passed, 0), total: results.reduce((n, r) => n + r.total, 0), results }
writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2))
if (summary.passed !== summary.total) process.exitCode = 1
