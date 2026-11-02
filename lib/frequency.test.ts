import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { EvidenceIndex } from './evidence'
import { candidateF, computeFrequencyShadow, failedFrequencyShadow, frequencyBase } from './frequency'
import type { EvidenceRecord, EvidenceRef } from './types'

function rec(key: string, thread: string, author: string | null, parentKey: string | null = null): EvidenceRecord {
  return {
    recordKey: key, alias: key, source: 'reddit', type: 'comment', sourceItemId: key,
    threadId: `reddit:${thread}`, authorKey: author ? `reddit_user:${author}` : null, parentKey, text: 't', truncated: false,
  }
}
/** Indice con statistiche fissate: D, K e quota autori noti non dipendono dai record del test. */
function index(records: EvidenceRecord[], stats = { D: 99, K: 4, authorKnownRate: 0.95 }): EvidenceIndex {
  return {
    records,
    stats: {
      reddit: { records: records.length, ...stats },
      youtube: { records: 0, D: 0, K: 0, authorKnownRate: null },
    },
  }
}
const ref = (recordKey: string, relation: EvidenceRef['relation']): EvidenceRef => ({ recordKey, relation })

test('soglie di F_base', () => {
  const cases: Array<[number, number]> = [[0.99, 1], [1, 2], [1.99, 2], [2, 3], [3.99, 3], [4, 4], [5.99, 4], [6, 5],
    [8.99, 5], [9, 6], [12.99, 6], [13, 7], [17.99, 7], [18, 8], [24.99, 8], [25, 9], [34.99, 9], [35, 10], [100, 10]]
  for (const [pct, f] of cases) assert.equal(frequencyBase(pct), f, `pct ${pct}`)
})

test('regressione pilota D=99, K=4 (U,T → F)', () => {
  const pilot: Array<[number, number, number]> = [[11, 4, 7], [10, 2, 6], [7, 2, 5], [5, 3, 5], [4, 3, 5],
    [3, 3, 4], [3, 2, 3], [2, 1, 3], [1, 1, 2]]
  for (const [U, T, F] of pilot) assert.equal(candidateF(U, T, 99, 4), F, `U=${U} T=${T}`)
  assert.equal(candidateF(99, 4, 99, 4), 10, 'tetto 10')
})

test('U solo da problem/request; conferme e obiezioni fuori dalla U principale', () => {
  const records = [
    rec('p1', 'a', 'alice'), rec('p2', 'b', 'bob'), rec('p3', 'b', 'alice'), // alice due volte → U=2
    rec('o1', 'c', 'olga'),
    rec('k1', 'a', 'carl', 'p1'), // conferma valida
    rec('x1', 'd', 'dora'),       // solo contesto
  ]
  const s = computeFrequencyShadow({
    source: 'reddit', index: index(records), F_legacy: 6,
    refs: [ref('p1', 'problem'), ref('p2', 'request'), ref('p3', 'problem'), ref('o1', 'objection'),
      ref('k1', 'contextual_confirmation'), ref('x1', 'context')],
  })
  assert.equal(s.U, 2)
  assert.equal(s.U_withConfirmations, 3)
  assert.equal(s.M, 5, 'tutti tranne il solo contesto')
  assert.equal(s.T, 3, 'thread a, b, c: la discussione contestata conta; d (solo contesto) no')
  assert.equal(s.F_legacy, 6, 'F legacy conservato invariato')
  assert.equal(s.status, 'ok')
  assert.equal(s.F_candidate, candidateF(2, 3, 99, 4))
})

test('conferme: genitore trasmesso e associato allo stesso pain point con relazione diversa da context', () => {
  const records = [
    rec('p1', 'a', 'alice'), rec('c1', 'a', 'ctx'), rec('o1', 'a', 'olga'),
    rec('k_ok', 'a', 'u1', 'p1'),
    rec('k_obj', 'a', 'u2', 'o1'),         // risponde a un'obiezione: parla del problema
    rec('k_ctx', 'a', 'u3', 'c1'),         // genitore solo contesto → non valida
    rec('k_unlinked', 'a', 'u4', 'z9'),    // genitore non trasmesso → non valida
    rec('k_none', 'a', 'u5', null),        // genitore ignoto (es. dati pre-sonda) → non valida
    rec('k_notref', 'a', 'u6', 'q1'), rec('q1', 'a', 'quinn'), // genitore trasmesso ma non associato
    rec('k_chain', 'a', 'u7', 'k_ok'),     // conferma di una conferma valida
    rec('k_chain_bad', 'a', 'u8', 'k_ctx'),
  ]
  const s = computeFrequencyShadow({
    source: 'reddit', index: index(records), F_legacy: 3,
    refs: [ref('p1', 'problem'), ref('c1', 'context'), ref('o1', 'objection'),
      ...['k_ok', 'k_obj', 'k_ctx', 'k_unlinked', 'k_none', 'k_notref', 'k_chain', 'k_chain_bad']
        .map(k => ref(k, 'contextual_confirmation'))],
  })
  assert.equal(s.U, 1)
  assert.equal(s.U_withConfirmations, 4, 'alice + u1, u2, u7')
  assert.ok(s.limitations.includes('unverified_confirmations:5'))
})

test('cicli fra conferme non sono validi e non bloccano il calcolo', () => {
  const records = [rec('p1', 'a', 'alice'), rec('k1', 'a', 'u1', 'k2'), rec('k2', 'a', 'u2', 'k1')]
  const s = computeFrequencyShadow({
    source: 'reddit', index: index(records), F_legacy: 3,
    refs: [ref('p1', 'problem'), ref('k1', 'contextual_confirmation'), ref('k2', 'contextual_confirmation')],
  })
  assert.equal(s.U_withConfirmations, 1)
})

test('riferimenti non validi scartati: record inesistente, altra piattaforma, relazione ignota', () => {
  const yt: EvidenceRecord = { ...rec('y1', 'v', 'yuri'), source: 'youtube' }
  const records = [rec('p1', 'a', 'alice'), yt]
  const s = computeFrequencyShadow({
    source: 'reddit', index: index(records), F_legacy: 3,
    refs: [ref('p1', 'problem'), ref('nope', 'problem'), ref('y1', 'problem'),
      { recordKey: 'p1', relation: 'invented' as EvidenceRef['relation'] }],
  })
  assert.equal(s.U, 1)
  assert.ok(s.limitations.includes('invalid_refs:3'))
})

test('M_anon: record senza autore contano in M ma non in U', () => {
  const s = computeFrequencyShadow({
    source: 'reddit', index: index([rec('p1', 'a', null), rec('p2', 'b', 'bob')]), F_legacy: 3,
    refs: [ref('p1', 'problem'), ref('p2', 'problem')],
  })
  assert.equal(s.U, 1)
  assert.equal(s.M, 2)
  assert.equal(s.M_anon, 1)
})

test('non calcolabile: U=0, D<50, K<3, quota autori noti < 0,9', () => {
  const base = { source: 'reddit' as const, F_legacy: 4, refs: [ref('p1', 'problem')] }
  const cases: Array<[EvidenceIndex, string]> = [
    [index([rec('p1', 'a', null)]), 'no_known_authors'],
    [index([rec('p1', 'a', 'alice')], { D: 49, K: 4, authorKnownRate: 1 }), 'D_below_50'],
    [index([rec('p1', 'a', 'alice')], { D: 99, K: 2, authorKnownRate: 1 }), 'K_below_3'],
    [index([rec('p1', 'a', 'alice')], { D: 99, K: 4, authorKnownRate: 0.89 }), 'author_known_rate_below_0.9'],
  ]
  for (const [idx, reason] of cases) {
    const s = computeFrequencyShadow({ ...base, index: idx })
    assert.equal(s.calculable, false, reason)
    assert.equal(s.status, 'not_calculable')
    assert.equal(s.F_candidate, null)
    assert.equal(s.F_candidate_capped, null)
    assert.ok(s.limitations.includes(reason), reason)
  }
  // Ai confini le soglie sono incluse.
  const edge = computeFrequencyShadow({ ...base, index: index([rec('p1', 'a', 'alice')], { D: 50, K: 3, authorKnownRate: 0.9 }) })
  assert.equal(edge.calculable, true)
})

test('D2: F_candidate senza cap e F_candidate_capped <= 4 con un solo thread', () => {
  const records = Array.from({ length: 30 }, (_, i) => rec(`p${i}`, 'only', `user${i}`))
  const s = computeFrequencyShadow({
    source: 'reddit', index: index(records), F_legacy: 8, refs: records.map(r => ref(r.recordKey, 'problem')),
  })
  assert.equal(s.T, 1)
  assert.equal(s.F_candidate, 9, '30/99 = 30,3% → 9, spread 0')
  assert.equal(s.F_candidate_capped, 4)
})

test('passata fallita: stato failed senza numeri inventati', () => {
  const s = failedFrequencyShadow(5, 'timeout')
  assert.equal(s.status, 'failed')
  assert.equal(s.F_legacy, 5)
  assert.equal(s.U, null)
  assert.equal(s.F_candidate, null)
  assert.deepEqual(s.limitations, ['attribution_failed:timeout'])
})
