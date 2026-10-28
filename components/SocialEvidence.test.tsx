import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import SocialEvidence from './SocialEvidence'
import type { SocialEvidenceReport } from '../lib/types'

function evidence(): SocialEvidenceReport {
  return {
    version: '9.0.2',
    metrics: { pp1: {
      U: 1, T: 1, M: 2, status: 'complete', completeness: { U: false, T: true, M: true },
      unknownAuthorMentions: 1, uncertainIdentityMentions: 0, ambiguousConfirmations: 0, rejectedAssociations: 0,
      reviewedComments: 2, totalComments: 2,
    } },
    manifest: { version: '9.0.2', contexts: [{ contextId: 'ctx', platform: 'reddit', containerId: 'p1', title: 'Meals', transmittedText: 'Meals' }], records: [{
      recordId: 'r1', platform: 'reddit', contextId: 'ctx', containerId: 'p1', sourceCommentId: 'c1', identityStatus: 'original',
      authorIdentityType: 'unknown', authorStatus: 'deleted', text: 'A real problem with meals.', transmittedText: 'A real problem with meals.', truncated: true,
      possibleCopy: false, commentUrl: 'https://www.reddit.com/r/camping/comments/p1/meals/c1/', commentUrlOrigin: 'received',
    }] },
    associations: [{ painPointId: 'pp1', recordId: 'r1', supportType: 'direct', quote: 'A real problem with meals.', contextRecordIds: [] }],
  }
}

test('rendering: conteggi, autori sconosciuti, link sorgente e troncamento', () => {
  const report = evidence()
  const before = JSON.stringify(report)
  const html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /U: 1 · T: 1 · M: 2/)
  assert.match(html, /menzioni con autore sconosciuto/)
  assert.match(html, /Testimonianze e provenienza/)
  assert.match(html, /https:\/\/www.reddit.com\/r\/camping\/comments\/p1\/meals\/c1\//)
  assert.match(html, /Autore: cancellato/)
  assert.match(html, /troncato a 300/)
  assert.match(html, /precedono la nuova verifica di pertinenza/)
  assert.equal(JSON.stringify(report), before)
})

test('legacy e fallimenti mostrano N/D; zero valido e attribuzione parziale restano distinti', () => {
  assert.match(renderToStaticMarkup(<SocialEvidence />), /U\/T\/M non disponibili/)
  const report = evidence()
  Object.assign(report.metrics.pp1, { U: null, T: null, M: null, status: 'failed' })
  let html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /attribuzione non riuscita/)
  assert.ok(!html.includes('M: 0'))
  Object.assign(report.metrics.pp1, { U: 0, T: 0, M: 0, status: 'partial', reviewedComments: 1 })
  html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /U: 0 · T: 0 · M: 0/)
  assert.match(html, /Attribuzione parziale: 1\/2/)
  assert.match(html, /Nessun supporto validato/)
})

test('nessun link attivo per URL arbitrari in report importati', () => {
  const report = evidence()
  report.manifest.records[0].commentUrl = 'javascript:alert(1)'
  const html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.ok(!html.includes('href='))
})

test('budget esaurito e distinto da un guasto quando nessun risultato e disponibile', () => {
  const report = evidence()
  Object.assign(report.metrics.pp1, { U: null, T: null, M: null, status: 'not_run' })
  report.processing = { budgetExhausted: true, attemptedRecordIds: [], unstartedRecordIds: ['r1'], failures: [] }
  const html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /tempo di analisi esaurito/)
  assert.ok(!html.includes('attribuzione non riuscita'))
})

test('gli incerti sono consultabili e distinti dai record senza decisione valida', () => {
  const report = evidence()
  Object.assign(report.metrics.pp1, { U: null, T: null, M: null, status: 'partial', uncertainComments: 1 })
  report.uncertainRecordIds = { pp1: ['r1'] }
  let html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /pertinenza o contesto incerti/)
  assert.match(html, /A real problem with meals/)
  assert.ok(!html.includes('M: 0'))
  report.uncertainRecordIds = { pp1: [] }
  report.unresolvedRecordIds = { pp1: ['r1'] }
  html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /Commenti senza una decisione valida: 1/)
})

test('verifica del tema: revisione automatica, esclusioni e incertezza visibili senza richiesta di conferma', () => {
  const report = evidence()
  report.verification = { version: 'topic-problem-support-v4', topic: 'balcony gardening', decisions: [
    { recordId: 'r2', painPointId: 'pp1', verdict: 'unsupported', reason: 'out_of_topic', topicRelevance: 'no', problemExpressed: 'yes', referentIdentified: 'yes' },
    { recordId: 'r1', painPointId: 'pp1', verdict: 'unclear', reason: 'unclear_topic', topicRelevance: 'unclear', problemExpressed: 'yes', referentIdentified: 'yes', evidenceKind: 'hypothesis' },
  ] }
  report.uncertainRecordIds = { pp1: ['r1'] }
  let html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /Verifica automatica/)
  assert.match(html, /altro argomento: 1/)
  assert.match(html, /Collegamento con l’argomento iniziale non dimostrato/)
  assert.match(html, /Giudizio ipotetico/)
  assert.ok(!html.includes('precedono'))
  Object.assign(report.metrics.pp1, { M: null, U: null, T: null })
  html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /Collegamento con l’argomento iniziale non dimostrato/)
  assert.ok(!html.includes('M: 0'))
  report.verification = { version: 'problem-support-v2', decisions: [] }
  Object.assign(report.metrics.pp1, { M: 2, U: 1, T: 1 })
  html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /precedono il controllo rispetto all’argomento iniziale/)
  report.verification = { version: 'topic-problem-support-v3', decisions: [] }
  html = renderToStaticMarkup(<SocialEvidence painPointId="pp1" evidence={report} />)
  assert.match(html, /precedono il controllo su oggetto del problema e tipo di testimonianza/)
})
